import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { IngestionService } from "./ingestion.service";
import { Injectable, Logger } from "@nestjs/common";
import { StemPubSubPublisher, StemSeparateMessage } from "./stem-pubsub.publisher";

@Processor("stems", { concurrency: 1 })
@Injectable()
export class StemsProcessor extends WorkerHost {
    private readonly logger = new Logger(StemsProcessor.name);

    constructor(
        private readonly ingestionService: IngestionService,
        private readonly stemPublisher: StemPubSubPublisher,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        const mode = process.env.STEM_PROCESSING_MODE || "pubsub";

        if (mode === "sync") {
            // Legacy Phase 1 synchronous flow — blocks until worker responds
            this.logger.log(`[StemsProcessor] (sync mode) Starting job ${job.id} for release ${job.data.releaseId}`);
            try {
                await this.ingestionService.processStemsJob(job.data);
                this.logger.log(`[StemsProcessor] (sync mode) Completed job ${job.id}`);
            } catch (error: any) {
                this.logger.error(`[StemsProcessor] (sync mode) Job ${job.id} failed: ${error?.message || error}`);
                throw error;
            }
            return;
        }

        // Phase 2 — Pub/Sub event-driven: publish and return immediately
        this.logger.log(`[StemsProcessor] (pubsub mode) Publishing jobs for release ${job.data.releaseId}`);

        const { releaseId, artistId, tracks } = job.data;

        for (const track of tracks) {
            const originalStem = track.stems?.[0];
            if (!originalStem) {
                this.logger.warn(`[StemsProcessor] Track ${track.id} has no stems, skipping`);
                continue;
            }

            // If the original stem has inline data but no URI, we need to upload it first
            // so the worker can download it from GCS
            let originalStemUri = originalStem.uri;
            if (!originalStemUri || originalStemUri.includes("localhost:3000")) {
                if (originalStem.data) {
                    const buffer = originalStem.data instanceof Buffer
                        ? originalStem.data
                        : Buffer.from(originalStem.data);
                    const storage = await this.ingestionService.uploadToStorage(
                        buffer,
                        `original_${track.id}.mp3`,
                        originalStem.mimeType || "audio/mpeg",
                    );
                    originalStemUri = storage.uri;
                    this.logger.log(`[StemsProcessor] Uploaded original to storage: ${originalStemUri}`);
                } else {
                    this.logger.warn(`[StemsProcessor] Track ${track.id} has no data or URI, skipping`);
                    continue;
                }
            }

            const message: StemSeparateMessage = {
                jobId: `sep_${releaseId}_${track.id}`,
                releaseId,
                artistId,
                trackId: track.id,
                trackTitle: track.title,
                trackPosition: track.position,
                originalStemUri,
                mimeType: originalStem.mimeType || "audio/mpeg",
                originalStemMeta: {
                    id: originalStem.id,
                    durationSeconds: originalStem.durationSeconds,
                    storageProvider: originalStem.storageProvider,
                },
            };

            await this.stemPublisher.publishSeparationJob(message);
        }

        this.logger.log(`[StemsProcessor] Published ${tracks.length} track(s) for release ${releaseId}`);
    }
}
