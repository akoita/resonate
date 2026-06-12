import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PubSub, Topic } from "@google-cloud/pubsub";
import { GoogleAuth } from "google-auth-library";
import { resolvePubSubRuntimeConfig } from "./pubsub-runtime";

/**
 * Message published to the `stem-separate` topic.
 * The worker pulls this, runs Demucs, and publishes results.
 */
export interface StemSeparateMessage {
  jobId: string;
  releaseId: string;
  artistId: string;
  trackId: string;
  trackTitle?: string;
  trackPosition?: number;
  originalStemUri: string;
  mimeType: string;
  /** Backend URL for progress HTTP callbacks during processing */
  callbackUrl?: string;
  /** Original stem metadata for re-assembly after separation */
  originalStemMeta?: {
    id?: string;
    uri?: string;
    durationSeconds?: number;
    storageProvider?: string;
  };
}

/**
 * Message published to the `stem-results` topic by the worker.
 * The backend subscribes and runs encryption + persistence.
 */
export interface StemResultMessage {
  jobId: string;
  releaseId: string;
  artistId: string;
  trackId: string;
  trackTitle?: string;
  trackPosition?: number;
  status: "completed" | "failed";
  /** GCS URIs for each separated stem type */
  stems?: Record<string, string>;
  /**
   * Measured musical features per stem type (#1184). Optional for rollout
   * compatibility: old workers omit it, and a per-stem extraction failure
   * sends null for that stem.
   */
  stemFeatures?: Record<string, unknown | null>;
  error?: string;
  /** Passed through from the original job */
  originalStemMeta?: {
    id?: string;
    uri?: string;
    durationSeconds?: number;
    storageProvider?: string;
  };
}

const TOPIC_SEPARATE = "stem-separate";
const TOPIC_RESULTS = "stem-results";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

@Injectable()
export class StemPubSubPublisher implements OnModuleInit {
  private readonly logger = new Logger(StemPubSubPublisher.name);
  private pubsub!: PubSub;
  private separateTopic!: Topic;
  private resultsTopic!: Topic;

  async onModuleInit() {
    const runtime = await resolvePubSubRuntimeConfig();
    if (!runtime.enabled) {
      this.logger.warn(`Pub/Sub publisher disabled. ${runtime.reason || "No runtime config available."}`);
      return;
    }

    const projectId = runtime.projectId;
    this.pubsub = projectId ? new PubSub({ projectId }) : new PubSub();
    this.logger.log(
      `PubSub initialized with project: ${projectId || "ADC default"}, emulator: ${process.env.PUBSUB_EMULATOR_HOST || 'NOT SET'}`,
    );
    this.separateTopic = this.pubsub.topic(TOPIC_SEPARATE);
    this.resultsTopic = this.pubsub.topic(TOPIC_RESULTS);

    // Ensure topics exist (idempotent)
    try {
      const [sepExists] = await this.separateTopic.exists();
      if (!sepExists) {
        await this.pubsub.createTopic(TOPIC_SEPARATE);
        this.logger.log(`Created Pub/Sub topic: ${TOPIC_SEPARATE}`);
      }

      const [resExists] = await this.resultsTopic.exists();
      if (!resExists) {
        await this.pubsub.createTopic(TOPIC_RESULTS);
        this.logger.log(`Created Pub/Sub topic: ${TOPIC_RESULTS}`);
      }

      // Ensure the worker subscription exists on the separate topic
      const workerSubName = 'stem-separate-worker';
      const workerSub = this.pubsub.subscription(workerSubName);
      const [workerSubExists] = await workerSub.exists();
      if (!workerSubExists) {
        await this.separateTopic.createSubscription(workerSubName, {
          ackDeadlineSeconds: 600,  // 10min — stem separation is slow
        });
        this.logger.log(`Created Pub/Sub subscription: ${workerSubName}`);
      }
    } catch (err) {
      // In emulator mode or if topics already exist, this is expected
      this.logger.warn(`Pub/Sub topic init (may be expected in emulator): ${err}`);
    }

    this.logger.log("StemPubSubPublisher initialized");
  }

  private cloudRunJobConfig() {
    const projectId = process.env.DEMUCS_CLOUD_RUN_JOB_PROJECT || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    const region = process.env.DEMUCS_CLOUD_RUN_JOB_REGION;
    const jobName = process.env.DEMUCS_CLOUD_RUN_JOB_NAME;

    if (!projectId || !region || !jobName) {
      return null;
    }

    return { projectId, region, jobName };
  }

  private normalizeAuthHeaders(headers: unknown): Record<string, string> {
    const normalized: Record<string, string> = {};
    if (headers && typeof (headers as any).forEach === "function") {
      (headers as any).forEach((value: string, key: string) => {
        normalized[key] = value;
      });
      return normalized;
    }

    for (const [key, value] of Object.entries((headers ?? {}) as Record<string, unknown>)) {
      normalized[key] = String(value);
    }
    return normalized;
  }

  private async triggerCloudRunJob(jobId: string) {
    const config = this.cloudRunJobConfig();
    if (!config) {
      return;
    }

    const endpoint =
      `https://run.googleapis.com/v2/projects/${encodeURIComponent(config.projectId)}` +
      `/locations/${encodeURIComponent(config.region)}` +
      `/jobs/${encodeURIComponent(config.jobName)}:run`;

    const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
    const client = await auth.getClient();
    const authHeaders = this.normalizeAuthHeaders(await client.getRequestHeaders(endpoint));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: "{}",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Cloud Run Job ${config.jobName} execution failed for ${jobId}: HTTP ${response.status} ${body}`);
    }

    this.logger.log(`Triggered Demucs Cloud Run Job ${config.jobName} for ${jobId}`);
  }

  /**
   * Publish a stem separation job to the `stem-separate` topic.
   * Returns immediately — worker picks it up asynchronously.
   */
  async publishSeparationJob(message: StemSeparateMessage): Promise<string> {
    if (!this.separateTopic) {
      const error =
        "Stem separation worker path unavailable: Pub/Sub publisher is not initialized. " +
        "Set PUBSUB_EMULATOR_HOST for local dev, or provide Application Default Credentials " +
        "via an attached Cloud Run service account, GOOGLE_APPLICATION_CREDENTIALS, " +
        "or `gcloud auth application-default login`.";
      this.logger.error(error);
      throw new Error(error);
    }
    const data = Buffer.from(JSON.stringify(message));
    const messageId = await this.separateTopic.publishMessage({
      data,
      attributes: {
        jobId: message.jobId,
        releaseId: message.releaseId,
        trackId: message.trackId,
      },
    });
    this.logger.log(
      `Published separation job ${message.jobId} (messageId=${messageId}) for track ${message.trackId}`
    );
    await this.triggerCloudRunJob(message.jobId);
    return messageId;
  }
}
