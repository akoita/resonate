import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventBus } from '../shared/event_bus';
import { StorageProvider } from '../storage/storage_provider';
import { CatalogService } from '../catalog/catalog.service';
import { LyriaClient } from './lyria.client';
import { CreateGenerationDto, GenerationStatusResponse, GenerationMetadata, ALL_STEM_TYPES, StemAnalysisResult, PublishGenerationDto, SupportedGenerationDuration } from './generation.dto';
import { prisma } from '../../db/prisma';
import { GenerationCreditsService } from '../credits/generation-credits.service';
import { randomUUID } from 'crypto';
import { UPLOAD_RIGHTS_POLICY_VERSION } from '../rights/upload-rights-policy';
import type { Prisma } from '@prisma/client';

const COST_PER_30_SECONDS = 0.06; // Estimated cost baseline for 30 seconds of generated audio
const DEFAULT_RATE_LIMIT = 50; // max generations per hour per user
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AI_GENERATION_RIGHTS_SOURCE = 'ai_generation';
const AI_GENERATION_RIGHTS_ACTOR = 'system:ai-generation';
const AI_GENERATION_RIGHTS_REASON =
  'Resonate generated this release and recorded system provenance automatically. Marketplace access uses the platform AI-generated-work policy rather than creator proof-of-control evidence.';

interface RateLimitEntry {
  timestamps: number[];
}

export interface GenerationJobResult {
  trackId: string;
  releaseId: string;
}

/**
 * Google GenAI SDK surfaces API errors by stringifying the full response body
 * into Error.message, including provider URLs and quota metric names. Strip
 * that for user-facing events so the /create page doesn't render raw JSON.
 * The original message is still logged server-side for debugging.
 */
export function normalizeGenerationErrorMessage(error: unknown): string {
  const raw = typeof error === 'string' ? error : (error as { message?: string } | null)?.message ?? '';
  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const status = parsed?.error?.status;
      const code = parsed?.error?.code;
      if (status === 'RESOURCE_EXHAUSTED' || code === 429) {
        return 'Generation is temporarily rate-limited. Please try again in a few minutes.';
      }
      if (status === 'INVALID_ARGUMENT' || code === 400) {
        return 'The prompt was rejected by the generation provider. Try rephrasing it.';
      }
      if (
        status === 'PERMISSION_DENIED' ||
        status === 'UNAUTHENTICATED' ||
        status === 'NOT_FOUND' ||
        status === 'FAILED_PRECONDITION' ||
        code === 401 ||
        code === 403 ||
        code === 404
      ) {
        return 'The generation provider is not available. Please check the Lyria configuration and try again.';
      }
      return 'Generation failed. Please try again.';
    } catch {
      // Not JSON — fall through to the raw message.
    }
  }
  return raw || 'Generation failed. Please try again.';
}

/**
 * Appends a RIFF LIST INFO chunk to a standard WAV buffer,
 * and repairs any truncated chunk size declarations (e.g. from Lyria).
 */
function appendRiffInfoChunk(wavBuffer: Buffer, metadata: Record<string, string>): Buffer {
  if (wavBuffer.length < 12 || wavBuffer.toString('utf8', 0, 4) !== 'RIFF' || wavBuffer.toString('utf8', 8, 12) !== 'WAVE') {
    return wavBuffer;
  }

  // First, repair the data chunk size if it's incorrect.
  // Many AI generators allocate a huge buffer and forget to rewrite the size headers.
  let offset = 12;
  let dataChunkOffset = -1;
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('utf8', offset, offset + 4);
    let chunkSize = wavBuffer.readUInt32LE(offset + 4);
    
    if (chunkId === 'data') {
      dataChunkOffset = offset;
      // If the data chunk extends beyond EOF, fix it to match actual EOF
      const actualDataSize = wavBuffer.length - offset - 8;
      if (chunkSize > actualDataSize) {
        wavBuffer.writeUInt32LE(actualDataSize, offset + 4);
      }
      break; 
    }
    
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }

  // Now build the LIST INFO chunk
  const chunks: Buffer[] = [];
  
  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue;
    const infoMap: Record<string, string> = {
      title: 'INAM',
      artist: 'IART',
      album: 'IPRD',
      composer: 'ICMT',
    };
    const chunkId = infoMap[key];
    if (!chunkId) continue;

    const dataBuf = Buffer.from(value + '\0', 'utf8');
    const isOdd = dataBuf.length % 2 !== 0;
    const paddedBuf = isOdd ? Buffer.concat([dataBuf, Buffer.alloc(1)]) : dataBuf;

    const header = Buffer.alloc(8);
    header.write(chunkId, 0);
    header.writeUInt32LE(dataBuf.length, 4);

    chunks.push(header, paddedBuf);
  }

  let newWav = wavBuffer;
  if (chunks.length > 0) {
    const listData = Buffer.concat(chunks);
    const listHeader = Buffer.alloc(12);
    listHeader.write('LIST', 0);
    listHeader.writeUInt32LE(listData.length + 4, 4);
    listHeader.write('INFO', 8);

    const infoChunk = Buffer.concat([listHeader, listData]);
    newWav = Buffer.concat([wavBuffer, infoChunk]);
  }

  // Finally, rewrite the exact RIFF size for the entire repaired + tagged file
  newWav.writeUInt32LE(newWav.length - 8, 4);

  return newWav;
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
    private readonly configService: ConfigService,
    @InjectQueue('generation') private readonly generationQueue: Queue,
    private readonly credits: GenerationCreditsService,
  ) {
    // Try STRIKE_RATE_LIMIT first (parsed as number), fallback to DEFAULT_RATE_LIMIT
    const limit = this.configService.get<string | number>('STRIKE_RATE_LIMIT', DEFAULT_RATE_LIMIT);
    this.maxPerHour = typeof limit === 'string' ? parseInt(limit, 10) : limit;
  }

  /**
   * Create a new generation job. Validates rate limit, enqueues BullMQ job, returns jobId.
   */
  async createGeneration(dto: CreateGenerationDto, userId: string): Promise<{ jobId: string }> {
    // Check rate limit
    this.enforceRateLimit(userId);

    const jobId = randomUUID();
    const durationSeconds = dto.durationSeconds ?? 30;

    // #1334 generation-credit meter: charge the user's prepaid balance before
    // the job is enqueued. A zero/insufficient balance throws
    // InsufficientCreditsException (HTTP 402) here, so the generation never
    // starts. The debit runs after the rate-limit check so an over-limit
    // request is never charged.
    const costCents = this.credits.costForDurationCents(durationSeconds);
    await this.credits.debit(userId, costCents, 'lyria_generation', jobId, 'lyria');

    try {
      await this.generationQueue.add('generate', {
        jobId,
        userId,
        artistId: dto.artistId,
        prompt: dto.prompt,
        negativePrompt: dto.negativePrompt,
        seed: dto.seed,
        durationSeconds,
      }, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    } catch (enqueueError) {
      // The charge is only justified once the work is queued; a failed enqueue
      // returns the credits so the user is never charged for a no-op.
      await this.credits
        .refund(userId, costCents, 'enqueue_failed_refund', jobId)
        .catch((refundError) =>
          this.logger.error(
            `Failed to refund ${costCents}¢ after enqueue failure for job ${jobId}: ${refundError?.message ?? refundError}`,
          ),
        );
      throw enqueueError;
    }

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
   * #1334: return the debited credits when a generation job terminally fails
   * (all BullMQ retries exhausted). Idempotent per jobId, so a re-delivery or a
   * double-call never double-refunds. Called by the GenerationProcessor on the
   * final failed attempt. Best-effort: a refund failure is logged, not thrown,
   * so it never masks the original job error.
   */
  async refundFailedGenerationJob(data: {
    jobId?: string;
    userId?: string;
    durationSeconds?: number;
  }): Promise<void> {
    if (!data?.userId || !data?.jobId) {
      return;
    }
    const costCents = this.credits.costForDurationCents(data.durationSeconds ?? 30);
    try {
      await this.credits.refund(data.userId, costCents, 'job_failed_refund', data.jobId);
    } catch (error: any) {
      this.logger.error(
        `Failed to refund ${costCents}¢ for terminally failed job ${data.jobId}: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * Process a generation job: call Lyria → store audio → create DB records → broadcast.
   * Called by the GenerationProcessor.
   */
  async processGenerationJob(data: {
    jobId: string;
    userId: string;
    artistId?: string;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
    durationSeconds?: SupportedGenerationDuration;
  }): Promise<GenerationJobResult> {
    const { jobId, userId, prompt, negativePrompt, seed, durationSeconds = 30 } = data;
    let { artistId } = data;

    // Auto-resolve artistId from userId if not provided
    if (!artistId) {
      let artist = await prisma.artist.findFirst({ where: { userId } });
      if (!artist) {
        artist = await prisma.artist.create({
          data: { userId, displayName: 'AI Creator', payoutAddress: userId },
        });
        this.logger.log(`[Generation] Auto-created artist ${artist.id} for user ${userId}`);
      }
      artistId = artist.id;
    }

    try {
      // Phase 1: Generate audio
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'generating',
      });

      const result = await this.lyriaClient.generate({ prompt, negativePrompt, seed, durationSeconds });

      // Phase 2: Store audio
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'storing',
      });

      const audioMimeType = result.mimeType || 'audio/mpeg';
      let finalAudioBytes = result.audioBytes;
      if (audioMimeType === 'audio/wav') {
        try {
          finalAudioBytes = appendRiffInfoChunk(result.audioBytes, {
            title: prompt.substring(0, 120),
            artist: 'AI (Lyria)',
            album: 'Resonate',
            composer: userId, // track provenance
          });
        } catch (tagError) {
          this.logger.warn(`Failed to inject RIFF chunks into WAV for job ${jobId}: ${tagError}`);
        }
      }

      const filename = `generated-${jobId}${this.audioExtensionForMimeType(audioMimeType)}`;
      const storageResult = await this.storageProvider.upload(finalAudioBytes, filename, audioMimeType);

      // Phase 3: Create DB records
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'finalizing',
      });

      const generationMetadata: GenerationMetadata = {
        jobId,
        provider: result.provider,
        prompt,
        negativePrompt,
        seed: result.seed,
        generatedAt: new Date().toISOString(),
        synthIdPresent: result.synthIdPresent,
        durationSeconds: result.durationSeconds,
        sampleRate: result.sampleRate,
        cost: this.calculateGenerationCost(result.durationSeconds),
      };

      // Create Release + Track via Prisma
      const release = await prisma.$transaction(async (tx) => {
        const createdRelease = await tx.release.create({
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
                rightsRoute: 'STANDARD_ESCROW',
                rightsFlags: [],
                rightsReason: AI_GENERATION_RIGHTS_REASON,
                rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
                rightsEvaluatedAt: new Date(),
                stems: {
                  create: {
                    type: 'master',
                    uri: storageResult.uri,
                    storageProvider: storageResult.provider,
                    data: storageResult.provider === 'local' ? finalAudioBytes : undefined,
                    durationSeconds: result.durationSeconds,
                    mimeType: audioMimeType,
                  },
                },
              },
            },
            rightsRoute: 'STANDARD_ESCROW',
            rightsFlags: [],
            rightsReason: AI_GENERATION_RIGHTS_REASON,
            rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
            rightsSourceType: AI_GENERATION_RIGHTS_SOURCE,
            rightsEvaluatedAt: new Date(),
          },
          include: { tracks: true },
        });

        await this.recordAiGenerationRightsProvenance(tx, {
          releaseId: createdRelease.id,
          artistId,
          trackId: createdRelease.tracks[0].id,
          title: createdRelease.tracks[0].title,
          prompt,
          provider: generationMetadata.provider,
          generatedAt: generationMetadata.generatedAt,
          synthIdPresent: generationMetadata.synthIdPresent,
          seed: generationMetadata.seed,
          durationSeconds: generationMetadata.durationSeconds,
          userId,
        });

        return createdRelease;
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
      return { trackId, releaseId: release.id };
    } catch (error: any) {
      this.logger.error(`Generation job ${jobId} failed: ${error?.message || error}`);

      this.eventBus.publish({
        eventName: 'generation.failed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        userId,
        error: normalizeGenerationErrorMessage(error),
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
      // Job may have been cleaned up by BullMQ after completion — check DB
      const completed = await this.findGeneratedReleaseForJob(jobId);
      if (completed) {
        return {
          jobId,
          status: 'completed',
          trackId: completed.trackId,
          releaseId: completed.releaseId,
        };
      }

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

    if (state === 'completed') {
      const returned = job.returnvalue as Partial<GenerationJobResult> | undefined;
      if (returned?.trackId && returned?.releaseId) {
        response.trackId = returned.trackId;
        response.releaseId = returned.releaseId;
      } else {
        const completed = await this.findGeneratedReleaseForJob(jobId);
        if (completed) {
          response.trackId = completed.trackId;
          response.releaseId = completed.releaseId;
        }
      }
    }

    if (state === 'failed') {
      response.error = normalizeGenerationErrorMessage(job.failedReason || 'Unknown error');
    }

    return response;
  }

  private async findGeneratedReleaseForJob(jobId: string): Promise<GenerationJobResult | null> {
    const release = await prisma.release.findFirst({
      where: {
        type: 'ai_generated',
        tracks: { some: { generationMetadata: { path: ['jobId'], equals: jobId } } },
      },
      include: { tracks: { select: { id: true } } },
    }).catch(() => null);

    if (!release || release.tracks.length === 0) {
      return null;
    }

    return {
      trackId: release.tracks[0].id,
      releaseId: release.id,
    };
  }

  /**
   * List AI-generated tracks for the given user.
   */
  async listUserGenerations(userId: string, limit = 50, offset = 0) {
    // Find the user's artist(s)
    const artist = await prisma.artist.findFirst({ where: { userId } });
    if (!artist) return [];

    const releases = await prisma.release.findMany({
      where: { artistId: artist.id, type: 'ai_generated' },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        tracks: {
          include: {
            stems: { where: { type: 'master' }, take: 1 },
          },
        },
      },
    });

    return releases.flatMap((release) =>
      release.tracks.map((track) => {
        const meta = (track.generationMetadata as any) || {};
        return {
          releaseId: release.id,
          trackId: track.id,
          artistId: artist.id,
          title: track.title,
          prompt: meta.prompt || track.title,
          negativePrompt: meta.negativePrompt || null,
          seed: meta.seed ?? null,
          provider: meta.provider || 'lyria-002',
          generatedAt: meta.generatedAt || release.createdAt.toISOString(),
          durationSeconds: meta.durationSeconds || 30,
          cost: meta.cost || this.calculateGenerationCost(meta.durationSeconds || 30),
          audioUri: `/catalog/releases/${release.id}/tracks/${track.id}/stream`,
        };
      }),
    );
  }

  /**
   * Get analytics & rate limit status for a user.
   */
  async getAnalytics(userId: string) {
    // ---- total generations & cost ----
    const artist = await prisma.artist.findFirst({ where: { userId } });
    let totalGenerations = 0;
    let totalCost = 0;

    if (artist) {
      const releases = await prisma.release.findMany({
        where: { artistId: artist.id, type: 'ai_generated' },
        include: {
          tracks: {
            select: {
              generationMetadata: true,
            },
          },
        },
      });

      totalGenerations = releases.length;
      totalCost = +releases
        .flatMap((release) => release.tracks)
        .reduce((sum, track) => {
          const meta = (track.generationMetadata as any) || {};
          return sum + (meta.cost || this.calculateGenerationCost(meta.durationSeconds || 30));
        }, 0)
        .toFixed(2);
    }

    // ---- rate limit state ----
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    let used = 0;
    let resetsAt: string | null = null;

    if (entry) {
      const activeTimestamps = entry.timestamps.filter(
        (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
      );
      used = activeTimestamps.length;
      if (activeTimestamps.length > 0) {
        resetsAt = new Date(
          Math.min(...activeTimestamps) + RATE_LIMIT_WINDOW_MS,
        ).toISOString();
      }
    }

    return {
      totalGenerations,
      totalCost,
      rateLimit: {
        remaining: Math.max(0, this.maxPerHour - used),
        limit: this.maxPerHour,
        resetsAt,
      },
    };
  }

  /**
   * Peek at the per-user rate-limit window WITHOUT recording a hit (#1422).
   *
   * Reads the same in-memory sliding-window state `enforceRateLimit` mutates,
   * but only prunes/reads locally — it never writes back, so calling it is
   * side-effect free and safe to expose to the Usage & Billing aggregation.
   * Mirrors the shape produced inline by `getAnalytics`, but returns `resetsAt`
   * as a Date (the aggregator serialises to ISO).
   */
  getGenerationRateLimitStatus(userId: string): {
    remaining: number;
    limit: number;
    windowMs: number;
    resetsAt: Date | null;
  } {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    let used = 0;
    let resetsAt: Date | null = null;

    if (entry) {
      const activeTimestamps = entry.timestamps.filter(
        (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
      );
      used = activeTimestamps.length;
      if (activeTimestamps.length > 0) {
        resetsAt = new Date(Math.min(...activeTimestamps) + RATE_LIMIT_WINDOW_MS);
      }
    }

    return {
      remaining: Math.max(0, this.maxPerHour - used),
      limit: this.maxPerHour,
      windowMs: RATE_LIMIT_WINDOW_MS,
      resetsAt,
    };
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

  // ---------------------------------------------------------------------------
  // Stem-Aware Generation — #336 subset
  // ---------------------------------------------------------------------------

  /**
   * Analyze a track's existing stems and determine which types are missing.
   * Returns suggested prompt + negative prompt for complementary generation.
   */
  async analyzeTrackStems(trackId: string): Promise<StemAnalysisResult> {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        stems: { select: { type: true } },
        release: { select: { title: true, genre: true } },
      },
    });

    if (!track) {
      throw new BadRequestException(`Track not found: ${trackId}`);
    }

    // Normalize stem types to lowercase; exclude 'original' which is the full track
    const presentTypes = [...new Set(
      track.stems
        .map(s => s.type.toLowerCase())
        .filter(t => t !== 'original'),
    )];

    const missingTypes = ALL_STEM_TYPES.filter(t => !presentTypes.includes(t));
    const genre = track.release?.genre || 'music';

    // Build a suggested prompt for the first missing stem
    const targetStem = missingTypes[0] || 'other';
    const suggestedPrompt = `${targetStem} stem, ${genre} style, complements existing ${presentTypes.join(', ')} stems`;

    // Negative prompt excludes what's already present
    const negativePrompt = presentTypes.length > 0
      ? presentTypes.map(t => `no ${t}`).join(', ')
      : '';

    return {
      trackId,
      trackTitle: track.title,
      releaseGenre: genre,
      presentTypes,
      missingTypes,
      suggestedPrompt,
      negativePrompt,
    };
  }

  /**
   * Generate a complementary stem for a track.
   * Auto-derives the prompt and negative prompt from existing stems.
   */
  async generateComplementaryStem(
    trackId: string,
    stemType: string,
    userId: string,
  ): Promise<{ jobId: string }> {
    const analysis = await this.analyzeTrackStems(trackId);

    // Validate the requested stem type is actually missing
    if (!analysis.missingTypes.includes(stemType)) {
      throw new BadRequestException(
        `Stem type '${stemType}' already present on track '${analysis.trackTitle}'. ` +
        `Missing types: ${analysis.missingTypes.join(', ') || 'none'}`,
      );
    }

    const genre = analysis.releaseGenre || 'music';
    const prompt = `${stemType} stem, ${genre} style, complements existing ${analysis.presentTypes.join(', ')} stems`;

    // Negative prompt: exclude existing stem types so Lyria doesn't duplicate them
    const negativePrompt = analysis.presentTypes.length > 0
      ? analysis.presentTypes.map(t => `no ${t}`).join(', ')
      : undefined;

    this.logger.log(
      `Generating complementary ${stemType} for track ${trackId} — ` +
      `prompt: "${prompt}", negativePrompt: "${negativePrompt}"`,
    );

    // Use the agent artist ID for complementary generations
    const artistId = process.env.AGENT_ARTIST_ID || 'agent';

    return this.createGeneration(
      { prompt, negativePrompt, artistId, durationSeconds: 30 },
      userId,
    );
  }

  private calculateGenerationCost(durationSeconds: number): number {
    return +((durationSeconds / 30) * COST_PER_30_SECONDS).toFixed(2);
  }

  private audioExtensionForMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'audio/wav':
        return '.wav';
      case 'audio/mpeg':
        return '.mp3';
      default:
        return '.bin';
    }
  }

  async publishGeneration(
    trackId: string,
    dto: PublishGenerationDto,
    userId: string,
    artworkFile?: Express.Multer.File,
  ) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: { release: true },
    });

    if (!track) {
      throw new NotFoundException('Track not found');
    }

    const artist = await prisma.artist.findUnique({ where: { userId } });
    if (!artist || track.release.artistId !== artist.id) {
      throw new UnauthorizedException('Not authorized to publish this track');
    }

    await prisma.release.update({
      where: { id: track.releaseId },
      data: {
        title: dto.title,
        primaryArtist: dto.artist,
        genre: dto.genre,
        label: dto.label,
        featuredArtists: dto.featuredArtists,
        releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : undefined,
        status: 'published',
        ...(artworkFile && {
          artworkData: artworkFile.buffer,
          artworkMimeType: artworkFile.mimetype,
        }),
      },
    });

    await prisma.track.update({
      where: { id: trackId },
      data: {
        title: dto.title,
        artist: dto.artist,
      },
    });

    await this.ensureAiGenerationRightsProvenance(track.releaseId);

    return { success: true, releaseId: track.releaseId };
  }

  private async ensureAiGenerationRightsProvenance(releaseId: string) {
    await prisma.$transaction(async (tx) => {
      const release = await tx.release.findUnique({
        where: { id: releaseId },
        include: {
          artist: { select: { id: true, userId: true } },
          tracks: {
            select: {
              id: true,
              title: true,
              generationMetadata: true,
            },
          },
        },
      });

      if (!release || release.type !== 'ai_generated') {
        return;
      }

      const generatedTrackIds = release.tracks
        .filter((candidate) => candidate.generationMetadata)
        .map((candidate) => candidate.id);
      const generatedTrack = release.tracks.find((candidate) => candidate.generationMetadata);
      if (!generatedTrack) {
        return;
      }

      const metadata = (generatedTrack.generationMetadata as GenerationMetadata | null) || null;

      await tx.release.update({
        where: { id: release.id },
        data: {
          rightsRoute: 'STANDARD_ESCROW',
          rightsFlags: [],
          rightsReason: AI_GENERATION_RIGHTS_REASON,
          rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
          rightsSourceType: AI_GENERATION_RIGHTS_SOURCE,
          rightsEvaluatedAt: new Date(),
        },
      });

      await tx.track.updateMany({
        where: {
          releaseId: release.id,
          id: { in: generatedTrackIds },
        },
        data: {
          rightsRoute: 'STANDARD_ESCROW',
          rightsFlags: [],
          rightsReason: AI_GENERATION_RIGHTS_REASON,
          rightsPolicyVersion: UPLOAD_RIGHTS_POLICY_VERSION,
          rightsEvaluatedAt: new Date(),
        },
      });

      if (!release.artist.userId) {
        throw new BadRequestException('Generated release manager profile is not attached to a user');
      }

      await this.recordAiGenerationRightsProvenance(tx, {
        releaseId: release.id,
        artistId: release.artist.id,
        trackId: generatedTrack.id,
        title: generatedTrack.title,
        prompt: metadata?.prompt || generatedTrack.title,
        provider: metadata?.provider || 'unknown',
        generatedAt: metadata?.generatedAt || release.createdAt.toISOString(),
        synthIdPresent: Boolean(metadata?.synthIdPresent),
        seed: metadata?.seed,
        durationSeconds: metadata?.durationSeconds,
        userId: release.artist.userId,
      });
    });
  }

  private async recordAiGenerationRightsProvenance(
    tx: Prisma.TransactionClient,
    input: {
      releaseId: string;
      artistId: string;
      trackId: string;
      title: string;
      prompt: string;
      provider: string;
      generatedAt: string;
      synthIdPresent?: boolean;
      seed?: number | null;
      durationSeconds?: number | null;
      userId: string;
    },
  ) {
    const latestRequest = await tx.releaseRightsUpgradeRequest.findFirst({
      where: {
        releaseId: input.releaseId,
      },
      orderBy: { createdAt: 'desc' },
      include: { evidenceBundles: true },
    });
    const existingRequest =
      latestRequest?.requestedByAddress === AI_GENERATION_RIGHTS_ACTOR ? latestRequest : null;

    const request = existingRequest
      ? await tx.releaseRightsUpgradeRequest.update({
          where: { id: existingRequest.id },
          data: {
            status: 'approved_standard_escrow',
            requestedRoute: 'STANDARD_ESCROW',
            currentRouteAtSubmission: 'STANDARD_ESCROW',
            summary: AI_GENERATION_RIGHTS_REASON,
            decisionReason: AI_GENERATION_RIGHTS_REASON,
            reviewedBy: AI_GENERATION_RIGHTS_ACTOR,
            reviewedAt: new Date(),
          },
          include: { evidenceBundles: true },
        })
      : await tx.releaseRightsUpgradeRequest.create({
          data: {
            releaseId: input.releaseId,
            artistId: input.artistId,
            requestedByAddress: AI_GENERATION_RIGHTS_ACTOR,
            status: 'approved_standard_escrow',
            requestedRoute: 'STANDARD_ESCROW',
            currentRouteAtSubmission: 'STANDARD_ESCROW',
            summary: AI_GENERATION_RIGHTS_REASON,
            decisionReason: AI_GENERATION_RIGHTS_REASON,
            reviewedBy: AI_GENERATION_RIGHTS_ACTOR,
            reviewedAt: new Date(),
          },
          include: { evidenceBundles: true },
        });

    if (request.evidenceBundles.some((bundle) => bundle.purpose === 'ops_review')) {
      return;
    }

    await tx.rightsEvidenceBundle.create({
      data: {
        rightsUpgradeRequestId: request.id,
        subjectType: 'release',
        subjectId: input.releaseId,
        submittedByRole: 'system',
        submittedByAddress: AI_GENERATION_RIGHTS_ACTOR,
        purpose: 'ops_review',
        summary: AI_GENERATION_RIGHTS_REASON,
        evidences: {
          create: [
            {
              subjectType: 'release',
              subjectId: input.releaseId,
              submittedByRole: 'system',
              submittedByAddress: AI_GENERATION_RIGHTS_ACTOR,
              kind: 'rights_metadata',
              title: 'Resonate AI generation provenance',
              description:
                `Track "${input.title}" was generated by ${input.provider} through Resonate on ${input.generatedAt}.`,
              sourceLabel: 'Resonate generation service',
              claimedRightsholder: 'Resonate AI generation policy',
              releaseTitle: input.title,
              strength: 'very_high',
              verificationStatus: 'system_generated',
              metadata: {
                source: AI_GENERATION_RIGHTS_SOURCE,
                trackId: input.trackId,
                userId: input.userId,
                prompt: input.prompt,
                provider: input.provider,
                generatedAt: input.generatedAt,
                synthIdPresent: Boolean(input.synthIdPresent),
                seed: input.seed ?? null,
                durationSeconds: input.durationSeconds ?? null,
              },
            },
          ],
        },
      },
    });
  }

  /**
   * Generate cover artwork from a text prompt using Gemini's image generation.
   * Uses the existing GOOGLE_AI_API_KEY.
   */
  async generateArtwork(prompt: string): Promise<{ imageData: string; mimeType: string }> {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Image generation not configured — GOOGLE_AI_API_KEY missing');
    }

    const artworkPrompt = `Generate album cover artwork for a music release. Style: modern, vibrant, high quality digital art suitable for a square album cover. Description: ${prompt}`;

    // Use the image-generation-capable model
    const model = 'gemini-2.5-flash-image';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    this.logger.log(`[Artwork] Calling Gemini ${model} with prompt: "${prompt}"`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: artworkPrompt }],
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Gemini image generation failed: ${response.status} ${errText}`);
      throw new BadRequestException(`Image generation failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    // Extract the inline image data from the response
    const candidates = data?.candidates;
    if (!candidates?.length) {
      throw new BadRequestException('No image was generated — try a different prompt');
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts?.length) {
      throw new BadRequestException('No image was generated — try a different prompt');
    }

    // Find the image part (inlineData with mimeType starting with "image/")
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imagePart) {
      throw new BadRequestException('No image was generated — try rephrasing your prompt');
    }

    return {
      imageData: imagePart.inlineData.data,  // base64 encoded
      mimeType: imagePart.inlineData.mimeType,
    };
  }
}
