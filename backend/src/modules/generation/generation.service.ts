import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventBus } from '../shared/event_bus';
import { StorageProvider } from '../storage/storage_provider';
import { CatalogService } from '../catalog/catalog.service';
import { LyriaClient } from './lyria.client';
import { CreateGenerationDto, GenerationStatusResponse, GenerationMetadata, ALL_STEM_TYPES, StemAnalysisResult, PublishGenerationDto } from './generation.dto';
import { prisma } from '../../db/prisma';
import { randomUUID } from 'crypto';

const COST_PER_GENERATION = 0.06; // $0.06 per 30-second clip
const DEFAULT_RATE_LIMIT = 5; // max generations per hour per user
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitEntry {
  timestamps: number[];
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
    artistId?: string;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
  }): Promise<void> {
    const { jobId, userId, prompt, negativePrompt, seed } = data;
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

      const result = await this.lyriaClient.generate({ prompt, negativePrompt, seed });

      // Phase 2: Store audio
      this.eventBus.publish({
        eventName: 'generation.progress',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        jobId,
        phase: 'storing',
      });

      let finalAudioBytes = result.audioBytes;
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

      const filename = `generated-${jobId}.wav`;
      const storageResult = await this.storageProvider.upload(finalAudioBytes, filename, 'audio/wav');

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
      // Job may have been cleaned up by BullMQ after completion — check DB
      const release = await prisma.release.findFirst({
        where: {
          type: 'ai_generated',
          tracks: { some: { generationMetadata: { path: ['jobId'], equals: jobId } } },
        },
        include: { tracks: { select: { id: true } } },
      }).catch(() => null);

      if (release && release.tracks.length > 0) {
        return {
          jobId,
          status: 'completed',
          trackId: release.tracks[0].id,
          releaseId: release.id,
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
          title: track.title,
          prompt: meta.prompt || track.title,
          negativePrompt: meta.negativePrompt || null,
          seed: meta.seed ?? null,
          provider: meta.provider || 'lyria-002',
          generatedAt: meta.generatedAt || release.createdAt.toISOString(),
          durationSeconds: meta.durationSeconds || 30,
          cost: meta.cost || 0.06,
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
      totalGenerations = await prisma.release.count({
        where: { artistId: artist.id, type: 'ai_generated' },
      });
      totalCost = +(totalGenerations * COST_PER_GENERATION).toFixed(2);
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
      { prompt, negativePrompt, artistId },
      userId,
    );
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

    return { success: true, releaseId: track.releaseId };
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
