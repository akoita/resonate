import { Logger } from "@nestjs/common";
import { logDegradedFallback } from "../shared/degraded_fallback";
import {
  TRACK_EMBEDDING_DIMENSION,
  VERTEX_EMBEDDING_BATCH_SIZE,
  VERTEX_EMBEDDING_TIMEOUT_MS,
} from "./embedding.config";

export type VertexEmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface VertexEmbeddingTarget {
  projectId: string;
  location: string;
  model: string;
}

interface VertexPredictResponse {
  predictions?: Array<{ embeddings?: { values?: unknown } }>;
}

/**
 * Minimal Vertex AI text-embedding client over REST + Application Default
 * Credentials (same auth pattern as the SynthID client).
 *
 * `embed` returns `null` on ANY failure (auth, HTTP error, timeout, malformed
 * response). It never throws: callers fall back deterministically.
 */
export class VertexEmbeddingClient {
  private readonly logger = new Logger(VertexEmbeddingClient.name);

  async embed(
    target: VertexEmbeddingTarget,
    texts: string[],
    taskType: VertexEmbeddingTaskType,
  ): Promise<number[][] | null> {
    if (texts.length === 0) return [];
    try {
      const accessToken = await this.accessToken();
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += VERTEX_EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(i, i + VERTEX_EMBEDDING_BATCH_SIZE);
        const batchVectors = await this.predict(
          target,
          accessToken,
          batch,
          taskType,
        );
        if (!batchVectors) return null;
        vectors.push(...batchVectors);
      }
      return vectors;
    } catch (error) {
      logDegradedFallback({
        component: "embeddings.vertex",
        reason:
          error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "request_failed",
        error,
      });
      this.logger.warn(
        `Vertex embedding request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async accessToken(): Promise<string> {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = (await client.getAccessToken()).token;
    if (!token) {
      throw new Error("No GCP access token available for Vertex embeddings");
    }
    return token;
  }

  private async predict(
    target: VertexEmbeddingTarget,
    accessToken: string,
    texts: string[],
    taskType: VertexEmbeddingTaskType,
  ): Promise<number[][] | null> {
    const endpoint =
      `https://${target.location}-aiplatform.googleapis.com/v1/projects/${target.projectId}` +
      `/locations/${target.location}/publishers/google/models/${target.model}:predict`;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      VERTEX_EMBEDDING_TIMEOUT_MS,
    );
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instances: texts.map((content) => ({ content, task_type: taskType })),
          parameters: {
            outputDimensionality: TRACK_EMBEDDING_DIMENSION,
            autoTruncate: true,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        logDegradedFallback({
          component: "embeddings.vertex",
          reason:
            response.status === 429
              ? "rate_limited"
              : response.status >= 500
              ? "upstream_unavailable"
              : "http_error",
        });
        this.logger.warn(`Vertex embedding API returned HTTP ${response.status}`);
        return null;
      }
      return this.parse(
        (await response.json()) as VertexPredictResponse,
        texts.length,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(
    body: VertexPredictResponse,
    expected: number,
  ): number[][] | null {
    const predictions = body.predictions;
    if (!Array.isArray(predictions) || predictions.length !== expected) {
      logDegradedFallback({
        component: "embeddings.vertex",
        reason: "malformed_response",
      });
      this.logger.warn(
        "Vertex embedding response had an unexpected prediction count",
      );
      return null;
    }
    const vectors: number[][] = [];
    for (const prediction of predictions) {
      const values = prediction?.embeddings?.values;
      if (
        !Array.isArray(values) ||
        values.length !== TRACK_EMBEDDING_DIMENSION ||
        values.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      ) {
        logDegradedFallback({
          component: "embeddings.vertex",
          reason: "malformed_response",
        });
        this.logger.warn("Vertex embedding response had a malformed vector");
        return null;
      }
      vectors.push(values as number[]);
    }
    return vectors;
  }
}
