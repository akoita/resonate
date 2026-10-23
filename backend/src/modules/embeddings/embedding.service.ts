import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  EmbeddingProviderConfig,
  resolveEmbeddingProviderConfig,
} from "./embedding.config";
import { logDegradedFallback } from "../shared/degraded_fallback";
import { HashEmbedder } from "./hash_embedder";
import { VertexEmbeddingClient } from "./vertex_embedding.client";

/** How long a query vector is reused. A session's picks all fall inside this. */
const QUERY_VECTOR_TTL_MS = 30 * 60_000;
const QUERY_VECTOR_MAX_ENTRIES = 256;

/**
 * Text embedding provider facade (#1452, WS-5).
 *
 * `null` from `embedDocuments` / `embedQuery` means "no vector available"
 * (provider disabled, or the model call failed). Callers must fall back to
 * their deterministic path; this service never throws on provider problems.
 * The provider is resolved from the environment on each call so a deploy-time
 * switch needs no code change and tests can flip it.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly hashEmbedder = new HashEmbedder();
  private readonly vertex = new VertexEmbeddingClient();
  /**
   * Query vectors by (model, text hash), in memory only (#2241). A session's
   * semantic query is the same text on every pick, so the provider is called
   * once at session start and the picks reuse the vector. Only the hash and the
   * vector are held: never the text, and nothing is written anywhere.
   */
  private readonly queryVectors = new Map<string, { vector: number[]; at: number }>();

  config(): EmbeddingProviderConfig {
    return resolveEmbeddingProviderConfig();
  }

  /** Model id vectors are stored under, or `null` when embeddings are off. */
  get modelId(): string | null {
    return this.config().model;
  }

  isEnabled(): boolean {
    return this.config().mode !== "disabled";
  }

  async embedDocuments(texts: string[]): Promise<number[][] | null> {
    return this.embed(texts, "RETRIEVAL_DOCUMENT");
  }

  async embedQuery(text: string): Promise<number[] | null> {
    if (!text.trim()) return null;
    const config = this.config();
    if (config.mode === "disabled") return null;
    const key = createHash("sha256")
      .update(`${config.mode}\0${config.model ?? ""}\0${text}`)
      .digest("hex");
    const cached = this.queryVectors.get(key);
    if (cached && Date.now() - cached.at < QUERY_VECTOR_TTL_MS) return cached.vector;
    const vectors = await this.embed([text], "RETRIEVAL_QUERY");
    const vector = vectors?.[0] ?? null;
    // A failure is not remembered: the next call tries the provider again.
    if (vector) {
      this.queryVectors.delete(key);
      this.queryVectors.set(key, { vector, at: Date.now() });
      if (this.queryVectors.size > QUERY_VECTOR_MAX_ENTRIES) {
        this.queryVectors.delete(this.queryVectors.keys().next().value as string);
      }
    }
    return vector;
  }

  private async embed(
    texts: string[],
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  ): Promise<number[][] | null> {
    const config = this.config();
    if (config.mode === "disabled") return null;
    if (texts.length === 0) return [];
    try {
      if (config.mode === "hash") {
        return texts.map((text) => this.hashEmbedder.embed(text));
      }
      return await this.vertex.embed(config, texts, taskType);
    } catch (error) {
      logDegradedFallback({
        component: "embeddings.provider",
        reason: "error",
        error,
      });
      this.logger.warn(
        `Embedding provider "${config.mode}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
