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
            // so the worker can download it.
            // In local dev, the URI may be a localhost URL — that's fine, the worker
            // handles it via HTTP download with host.docker.internal mapping.
            let originalStemUri = originalStem.uri;
            if (!originalStemUri) {
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
                // Resolve relative URIs for the Docker worker (BACKEND_URL = host.docker.internal)
                originalStemUri: originalStemUri.startsWith('http')
                    ? originalStemUri
                    : `${process.env.BACKEND_URL || 'http://host.docker.internal:3000'}${originalStemUri}`,
                mimeType: originalStem.mimeType || "audio/mpeg",
                callbackUrl: process.env.BACKEND_URL || 'http://host.docker.internal:3000',
                originalStemMeta: {
                    id: originalStem.id,
                    durationSeconds: originalStem.durationSeconds,
                    storageProvider: originalStem.storageProvider,
                },
            };

            await this.stemPublisher.publishSeparationJob(message);
        }

        this.logger.log(`[StemsProcessor] Published ${tracks.length} track(s) for release ${releaseId}`);

        // Update DB status so the API returns the correct state immediately.
        // WebSocket events are ephemeral and can be missed if the client connects late.
        // RACE CONDITION FIX: The CatalogService creates the release record asynchronously
        // via the EventBus 'stems.uploaded' subscriber. The BullMQ job can execute before
        // that upsert completes, so we poll until the record exists.
        try {
            const { prisma } = await import("../../db/prisma");
            const MAX_RETRIES = 10;
            const RETRY_DELAY = 300; // ms
            let releaseFound = false;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const existing = await prisma.release.findUnique({
                    where: { id: releaseId },
                    select: { id: true },
                });
                if (existing) {
                    await prisma.release.update({
                        where: { id: releaseId },
                        data: { status: "processing" },
                    });
                    releaseFound = true;
                    break;
                }
                this.logger.warn(
                    `[StemsProcessor] Release ${releaseId} not in DB yet (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY}ms...`,
                );
                await new Promise((r) => setTimeout(r, RETRY_DELAY));
            }

            if (!releaseFound) {
                this.logger.warn(
                    `[StemsProcessor] Release ${releaseId} never appeared in DB after ${MAX_RETRIES} attempts — status not updated`,
                );
            }

            for (const track of tracks) {
                await prisma.track.updateMany({
                    where: { id: track.id },
                    data: { processingStatus: "separating" },
                });
            }
            if (releaseFound) {
                this.logger.log(`[StemsProcessor] Updated release ${releaseId} to 'processing' and tracks to 'separating'`);
            }
        } catch (err: any) {
            this.logger.warn(`[StemsProcessor] Failed to update DB status: ${err?.message}`);
        }
    }
}
