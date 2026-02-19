import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventBus } from '../shared/event_bus';
import { StorageProvider } from '../storage/storage_provider';
import { CatalogService } from '../catalog/catalog.service';
import { LyriaClient } from './lyria.client';
import { CreateGenerationDto, GenerationStatusResponse, GenerationMetadata } from './generation.dto';
import { prisma } from '../../db/prisma';
import { randomUUID } from 'crypto';

const COST_PER_GENERATION = 0.06; // $0.06 per 30-second clip
const DEFAULT_RATE_LIMIT = 5; // max generations per hour per user
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitEntry {
  timestamps: number[];
}

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly rateLimits = new Map<string, RateLimitEntry>();
  private readonly maxPerHour: number;

  constructor(
    private readonly eventBus: EventBus,
    private readonly storageProvider: StorageProvider,
    private readonly catalogService: CatalogService,
    private readonly lyriaClient: LyriaClient,
    @InjectQueue('generation') private readonly generationQueue: Queue,
  ) {
    this.maxPerHour = DEFAULT_RATE_LIMIT;
  }

  /**
   * Create a new generation job. Validates rate limit, enqueues BullMQ job, returns jobId.
   */
  async createGeneration(dto: CreateGenerationDto, userId: string): Promise<{ jobId: string }> {
    // Check rate limit
    this.enforceRateLimit(userId);

    const jobId = randomUUID();

    await this.generationQueue.add('generate', {
      jobId,
      userId,
      artistId: dto.artistId,
      prompt: dto.prompt,
      negativePrompt: dto.negativePrompt,
      seed: dto.seed,
    }, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    this.eventBus.publish({
      eventName: 'generation.started',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      jobId,
      userId,
      prompt: dto.prompt,
    });

    this.logger.log(`Generation job ${jobId} enqueued for user ${userId}`);
    return { jobId };
  }

  /**
   * Process a generation job: call Lyria → store audio → create DB records → broadcast.
   * Called by the GenerationProcessor.
   */
  async processGenerationJob(data: {
    jobId: string;
    userId: string;
    artistId: string;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
  }): Promise<void> {
    const { jobId, userId, artistId, prompt, negativePrompt, seed } = data;

    try {
      // Phase 1: Generate audio
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'generating',
      });

      const result = await this.lyriaClient.generate({ prompt, negativePrompt, seed });

      // Phase 2: Store audio
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'storing',
      });

      const filename = `generated-${jobId}.wav`;
      const storageResult = await this.storageProvider.upload(result.audioBytes, filename, 'audio/wav');

      // Phase 3: Create DB records
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'finalizing',
      });

      const generationMetadata: GenerationMetadata = {
        provider: 'lyria-002',
        prompt,
        negativePrompt,
        seed: result.seed,
        generatedAt: new Date().toISOString(),
        synthIdPresent: result.synthIdPresent,
        durationSeconds: 30,
        sampleRate: 48000,
        cost: COST_PER_GENERATION,
      };

      // Create Release + Track via Prisma
      const release = await prisma.release.create({
        data: {
          artistId,
          title: `AI Generated: ${prompt.substring(0, 80)}`,
          status: 'ready',
          type: 'ai_generated',
          tracks: {
            create: {
              title: prompt.substring(0, 120),
              processingStatus: 'complete',
              generationMetadata: generationMetadata as any,
              stems: {
                create: {
                  type: 'master',
                  uri: storageResult.uri,
                  storageProvider: storageResult.provider,
                  durationSeconds: 30,
                  mimeType: 'audio/wav',
                },
              },
            },
          },
        },
        include: { tracks: true },
      });

      const trackId = release.tracks[0].id;

      // Phase 4: Broadcast completion
      this.eventBus.publish({
        eventName: 'generation.completed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        userId,
        trackId,
        releaseId: release.id,
      });

      this.logger.log(`Generation job ${jobId} completed: track=${trackId}, release=${release.id}`);
    } catch (error: any) {
      this.logger.error(`Generation job ${jobId} failed: ${error?.message || error}`);

      this.eventBus.publish({
        eventName: 'generation.failed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        userId,
        error: error?.message || 'Unknown generation error',
      });

      throw error; // Let BullMQ handle retries
    }
  }

  /**
   * Get the status of a generation job from BullMQ.
   */
  async getStatus(jobId: string): Promise<GenerationStatusResponse> {
    const job = await this.generationQueue.getJob(jobId);

    if (!job) {
      return { jobId, status: 'failed', error: 'Job not found' };
    }

    const state = await job.getState();

    const statusMap: Record<string, GenerationStatusResponse['status']> = {
      waiting: 'queued',
      delayed: 'queued',
      active: 'generating',
      completed: 'completed',
      failed: 'failed',
    };

    const status = statusMap[state] || 'queued';
    const response: GenerationStatusResponse = {
      jobId,
      status,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : undefined,
    };

    if (state === 'completed' && job.returnvalue) {
      response.trackId = job.returnvalue.trackId;
      response.releaseId = job.returnvalue.releaseId;
    }

    if (state === 'failed') {
      response.error = job.failedReason || 'Unknown error';
    }

    return response;
  }

  /**
   * Enforce per-user rate limiting (sliding window).
   */
  private enforceRateLimit(userId: string): void {
    const now = Date.now();
    let entry = this.rateLimits.get(userId);

    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(userId, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (entry.timestamps.length >= this.maxPerHour) {
      throw new BadRequestException(
        `Rate limit exceeded: maximum ${this.maxPerHour} generations per hour. Try again later.`,
      );
    }

    entry.timestamps.push(now);
  }
}
