import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PubSub, Subscription, Message } from "@google-cloud/pubsub";
import { EventBus } from "../shared/event_bus";
import { StorageProvider } from "../storage/storage_provider";
import { EncryptionService } from "../encryption/encryption.service";
import { ArtistService } from "../artist/artist.service";
import { prisma } from "../../db/prisma";
import type { StemResultMessage } from "./stem-pubsub.publisher";

const TOPIC_RESULTS = "stem-results";
const SUBSCRIPTION_RESULTS = "stem-results-backend";

@Injectable()
export class StemResultSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StemResultSubscriber.name);
  private pubsub!: PubSub;
  private subscription!: Subscription;
  private isShuttingDown = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
    private readonly artistService: ArtistService,
  ) {}

  async onModuleInit() {
    // Skip in sync mode
    if (process.env.STEM_PROCESSING_MODE === "sync") {
      this.logger.log("STEM_PROCESSING_MODE=sync — skipping Pub/Sub result subscriber");
      return;
    }

    this.pubsub = new PubSub();

    // Ensure subscription exists (idempotent)
    try {
      const topic = this.pubsub.topic(TOPIC_RESULTS);
      const [topicExists] = await topic.exists();
      if (!topicExists) {
        await this.pubsub.createTopic(TOPIC_RESULTS);
      }

      this.subscription = this.pubsub.subscription(SUBSCRIPTION_RESULTS);
      const [subExists] = await this.subscription.exists();
      if (!subExists) {
        [this.subscription] = await topic.createSubscription(SUBSCRIPTION_RESULTS, {
          ackDeadlineSeconds: 120,
        });
        this.logger.log(`Created Pub/Sub subscription: ${SUBSCRIPTION_RESULTS}`);
      }
    } catch (err) {
      this.logger.warn(`Pub/Sub subscription init (may be expected in emulator): ${err}`);
      this.subscription = this.pubsub.subscription(SUBSCRIPTION_RESULTS);
    }

    // Start listening
    this.subscription.on("message", (message: Message) => this.handleMessage(message));
    this.subscription.on("error", (err) => {
      if (!this.isShuttingDown) {
        this.logger.error(`Pub/Sub subscription error: ${err}`);
      }
    });

    this.logger.log("StemResultSubscriber listening on " + SUBSCRIPTION_RESULTS);
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.subscription) {
      this.subscription.removeAllListeners();
      await this.subscription.close();
    }
  }

  private async handleMessage(message: Message) {
    let result: StemResultMessage;
    try {
      result = JSON.parse(message.data.toString());
    } catch (err) {
      this.logger.error(`Failed to parse Pub/Sub message: ${err}`);
      message.ack(); // Don't retry malformed messages
      return;
    }

    this.logger.log(
      `Received result for job ${result.jobId}: status=${result.status}`
    );

    try {
      if (result.status === "completed" && result.stems) {
        await this.processCompletedSeparation(result);
      } else if (result.status === "failed") {
        await this.processFailedSeparation(result);
      }
      message.ack();
    } catch (err: any) {
      this.logger.error(
        `Failed to process result for job ${result.jobId}: ${err?.message || err}`
      );
      // nack = Pub/Sub will retry with backoff
      message.nack();
    }
  }

  /**
   * Process completed stem separation:
   * 1. Download each stem from GCS
   * 2. Encrypt
   * 3. Re-upload encrypted version
   * 4. Persist to Prisma
   * 5. Publish stems.processed event
   */
  private async processCompletedSeparation(result: StemResultMessage) {
    this.logger.log(`Processing completed separation for release ${result.releaseId}, track ${result.trackId}`);

    // Get encryption address from artist profile
    const artistProfile = await this.artistService.findById(result.artistId);
    const encryptionAddress = artistProfile?.payoutAddress || result.artistId;

    const stems: any[] = [];

    // Re-include the original stem metadata if passed through
    if (result.originalStemMeta) {
      stems.push({
        id: result.originalStemMeta.id,
        uri: result.originalStemMeta.uri,
        type: "original",
        mimeType: "audio/mpeg",
        durationSeconds: result.originalStemMeta.durationSeconds,
        isEncrypted: false,
        storageProvider: result.originalStemMeta.storageProvider || "gcs",
      });
    }

    // Emit 'encrypting' stage
    await this.emitTrackStage(result.releaseId, result.trackId, "encrypting");

    // Process each AI-generated stem
    for (const [type, stemUri] of Object.entries(result.stems!)) {
      try {
        // Download stem from GCS
        let data: Buffer | null = null;
        if (stemUri.startsWith("http://") || stemUri.startsWith("https://")) {
          const response = await fetch(stemUri, { signal: AbortSignal.timeout(120_000) });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            data = Buffer.from(new Uint8Array(arrayBuffer));
          } else {
            this.logger.error(`Failed to download stem ${type}: HTTP ${response.status}`);
            continue;
          }
        } else {
          // Local/GCS storage provider download
          data = await this.storageProvider.download(stemUri);
        }

        if (!data) {
          this.logger.warn(`No data for stem ${type}, skipping`);
          continue;
        }

        const stemId = this.generateId("stem");
        let isEncrypted = false;
        let encryptionMetadata: string | null = null;

        // Encrypt
        try {
          const encrypted = await this.encryptionService.encrypt(data, {
            contentId: stemId,
            ownerAddress: encryptionAddress,
            allowedAddresses: [],
          });
          if (encrypted) {
            data = Buffer.from(encrypted.encryptedData);
            encryptionMetadata = encrypted.metadata;
            isEncrypted = true;
            this.logger.log(`Encrypted stem ${stemId} (${type})`);
          }
        } catch (encErr) {
          this.logger.warn(`Encryption failed for ${type}, using plaintext: ${encErr}`);
        }

        // Upload encrypted stem
        const storage = await this.storageProvider.upload(data, `${stemId}.mp3`, "audio/mpeg");

        stems.push({
          id: stemId,
          uri: storage.uri,
          type,
          data,
          mimeType: "audio/mpeg",
          durationSeconds: result.originalStemMeta?.durationSeconds,
          isEncrypted,
          encryptionMetadata,
          storageProvider: storage.provider,
        });
      } catch (err) {
        this.logger.error(`Failed to process stem ${type}: ${err}`);
      }
    }

    // Emit 'complete' stage
    await this.emitTrackStage(result.releaseId, result.trackId, "complete");

    // Publish stems.processed event
    this.eventBus.publish({
      eventName: "stems.processed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: result.releaseId,
      artistId: result.artistId,
      modelVersion: "demucs-htdemucs-6s",
      tracks: [
        {
          id: result.trackId,
          title: result.trackTitle || result.trackId,
          position: result.trackPosition || 0,
          stems,
        },
      ] as any,
    });

    this.logger.log(`Published stems.processed for release ${result.releaseId}`);
  }

  private async processFailedSeparation(result: StemResultMessage) {
    this.logger.error(
      `Separation failed for job ${result.jobId}: ${result.error}`
    );

    await this.emitTrackStage(result.releaseId, result.trackId, "failed");

    this.eventBus.publish({
      eventName: "stems.failed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: result.releaseId,
      artistId: result.artistId,
      error: result.error || "Unknown worker error",
    });
  }

  private async emitTrackStage(
    releaseId: string,
    trackId: string,
    stage: "pending" | "separating" | "encrypting" | "storing" | "complete" | "failed"
  ) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await prisma.track.update({
          where: { id: trackId },
          data: { processingStatus: stage },
        });
        break;
      } catch (err: any) {
        if (err?.code === "P2025" && attempt < MAX_RETRIES) {
          this.logger.warn(
            `Track ${trackId} not found (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms...`
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
        } else {
          this.logger.error(`Failed to update track ${trackId} status to ${stage}: ${err}`);
          break;
        }
      }
    }
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
