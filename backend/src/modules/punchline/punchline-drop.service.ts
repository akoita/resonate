import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { PunchlineDropPublishedEvent } from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import {
  PunchlineClipException,
  PunchlineClipService,
} from "./punchline-clip.service";
import { resolvePunchlineClipBounds } from "./punchline-clip.config";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";
import {
  PUNCHLINE_RIGHTS_LABEL,
  PUNCHLINE_RIGHTS_SUMMARY,
  PUNCHLINE_SOURCE_STEM_TYPE,
} from "./punchline-rights";

/**
 * Draft + publish APIs for Punchline Drops (#482).
 *
 * This is the last backend slice before the UI (#483+). An artist creates a
 * draft drop on an owned, eligible track, curates collectible moments, and
 * publishes — at which point the #480 rights/eligibility gate re-runs and each
 * moment's MP3 clip is extracted via the #481 primitive and persisted.
 *
 * Design boundaries this service enforces:
 *   - Every mutation is owner-scoped (only the track's / drop's artist) and
 *     draft-only. Ownership failures are 403; missing resources are 404.
 *   - There is no global ValidationPipe in this app, so ALL input validation
 *     lives here and throws BadRequestException. Bodies arrive as plain object
 *     literals from the controller.
 *   - Moment ranges are validated against the SAME clip length bounds the #481
 *     clip service enforces (`resolvePunchlineClipBounds`), so publish can never
 *     fail on a range the draft already accepted.
 *   - Publish orchestration is gate → extract clips → single transaction →
 *     domain event. Clip filenames are deterministic per [trackId,start,end], so
 *     re-publishing after a partial failure is idempotent.
 *
 * Rights posture: every drop/moment is minted under the single restrictive
 * NON_COMMERCIAL_COLLECTIBLE class (see punchline-rights.ts). Purchase /
 * ownership (#485) and unlock (#488) logic are explicitly out of scope here.
 */

const MAX_DROP_TITLE_LEN = 120;
const MAX_DROP_DESCRIPTION_LEN = 2000;
const MAX_MOMENT_TITLE_LEN = 120;
const MAX_MOMENT_LYRIC_LEN = 500;
const MAX_ARTWORK_URL_LEN = 2048;
const MAX_MOMENTS_PER_DROP = 20;
const MAX_EDITION_SIZE = 10_000;
const MAX_PRICE_CENTS = 1_000_000;

const ARTWORK_URL_PATTERN = /^(https?:\/\/|ipfs:\/\/)/i;

export interface CreateDraftInput {
  trackId: string;
  title?: string | null;
  description?: string | null;
}

export interface UpdateDraftInput {
  title?: string | null;
  description?: string | null;
}

/**
 * Moment payload. On add, the required fields must all be present; on update,
 * any omitted field keeps its stored value and the merged moment is validated
 * as a whole (so an edit can never leave the moment in an invalid state).
 */
export interface MomentInput {
  title?: string;
  lyricText?: string;
  artworkUrl?: string | null;
  startMs?: number;
  endMs?: number;
  editionSize?: number;
  priceCents?: number;
}

interface ValidatedMomentFields {
  title: string;
  lyricText: string;
  artworkUrl: string | null;
  startMs: number;
  endMs: number;
  editionSize: number;
  priceCents: number;
}

type DropWithMoments = Awaited<
  ReturnType<PunchlineDropService["loadDropWithMoments"]>
>;

@Injectable()
export class PunchlineDropService {
  private readonly logger = new Logger(PunchlineDropService.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly eligibilityService: PunchlineEligibilityService,
    private readonly clipService: PunchlineClipService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Draft lifecycle (owner + draft-only mutations)
  // ---------------------------------------------------------------------------

  async createDraft(userId: string, input: CreateDraftInput) {
    const trackId = input?.trackId?.trim();
    if (!trackId) {
      throw new BadRequestException("trackId is required");
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, release: { select: { artistId: true } } },
    });
    if (!track) {
      throw new NotFoundException(`Track ${trackId} not found`);
    }

    const artist = await this.requireArtist(userId);
    if (track.release?.artistId !== artist.id) {
      throw new ForbiddenException(
        "You can only create a Punchline Drop on a track you own.",
      );
    }

    // #480 gate on create: ineligible tracks can never start a drop.
    const eligibility = await this.eligibilityService.checkEligibility(trackId);
    if (!eligibility.eligible) {
      throw new BadRequestException({
        code: "track_not_eligible",
        message: "This track is not eligible for a Punchline Drop.",
        reasons: eligibility.reasons,
      });
    }

    const title = this.normalizeOptionalText(
      input.title,
      MAX_DROP_TITLE_LEN,
      "title",
    );
    const description = this.normalizeOptionalText(
      input.description,
      MAX_DROP_DESCRIPTION_LEN,
      "description",
    );

    const drop = await prisma.punchlineDrop.create({
      data: {
        trackId,
        artistId: artist.id,
        status: "draft",
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      },
      select: { id: true },
    });

    return this.buildDropDetail(drop.id);
  }

  async updateDraft(userId: string, dropId: string, input: UpdateDraftInput) {
    const drop = await this.loadOwnedDrop(userId, dropId);
    this.assertDraft(drop);

    const title = this.normalizeOptionalText(
      input.title,
      MAX_DROP_TITLE_LEN,
      "title",
    );
    const description = this.normalizeOptionalText(
      input.description,
      MAX_DROP_DESCRIPTION_LEN,
      "description",
    );

    await prisma.punchlineDrop.update({
      where: { id: drop.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });

    return this.buildDropDetail(drop.id);
  }

  async addMoment(userId: string, dropId: string, input: MomentInput) {
    const drop = await this.loadOwnedDrop(userId, dropId);
    this.assertDraft(drop);

    if (drop.moments.length >= MAX_MOMENTS_PER_DROP) {
      throw new BadRequestException(
        `Moment limit reached: a drop can hold at most ${MAX_MOMENTS_PER_DROP} moments.`,
      );
    }

    const fields = this.validateMomentFields({
      title: input?.title,
      lyricText: input?.lyricText,
      artworkUrl: input?.artworkUrl ?? null,
      startMs: input?.startMs,
      endMs: input?.endMs,
      editionSize: input?.editionSize,
      priceCents: input?.priceCents,
    });

    await prisma.punchlineMoment.create({
      data: {
        dropId: drop.id,
        sourceStemType: PUNCHLINE_SOURCE_STEM_TYPE,
        rightsLabel: PUNCHLINE_RIGHTS_LABEL,
        ...fields,
      },
    });

    return this.buildDropDetail(drop.id);
  }

  async updateMoment(
    userId: string,
    dropId: string,
    momentId: string,
    input: MomentInput,
  ) {
    const drop = await this.loadOwnedDrop(userId, dropId);
    this.assertDraft(drop);

    const existing = drop.moments.find((m) => m.id === momentId);
    if (!existing) {
      throw new NotFoundException(
        `Moment ${momentId} not found in drop ${dropId}`,
      );
    }

    // Merge provided fields over the stored moment, then validate the whole
    // result so a partial edit can never yield an invalid moment.
    const fields = this.validateMomentFields({
      title: input?.title !== undefined ? input.title : existing.title,
      lyricText:
        input?.lyricText !== undefined ? input.lyricText : existing.lyricText,
      artworkUrl:
        input?.artworkUrl !== undefined
          ? input.artworkUrl
          : existing.artworkUrl,
      startMs: input?.startMs !== undefined ? input.startMs : existing.startMs,
      endMs: input?.endMs !== undefined ? input.endMs : existing.endMs,
      editionSize:
        input?.editionSize !== undefined
          ? input.editionSize
          : existing.editionSize,
      priceCents:
        input?.priceCents !== undefined
          ? input.priceCents
          : existing.priceCents,
    });

    await prisma.punchlineMoment.update({
      where: { id: momentId },
      data: fields,
    });

    return this.buildDropDetail(drop.id);
  }

  async removeMoment(userId: string, dropId: string, momentId: string) {
    const drop = await this.loadOwnedDrop(userId, dropId);
    this.assertDraft(drop);

    const existing = drop.moments.find((m) => m.id === momentId);
    if (!existing) {
      throw new NotFoundException(
        `Moment ${momentId} not found in drop ${dropId}`,
      );
    }

    await prisma.punchlineMoment.delete({ where: { id: momentId } });

    return this.buildDropDetail(drop.id);
  }

  // ---------------------------------------------------------------------------
  // Publish: gate → extract clips → transaction → event
  // ---------------------------------------------------------------------------

  async publish(userId: string, dropId: string) {
    const drop = await this.loadOwnedDrop(userId, dropId);
    this.assertDraft(drop);

    if (drop.moments.length === 0) {
      throw new BadRequestException(
        "A drop needs at least one moment to publish.",
      );
    }

    // #480 publish-time re-check: the track may have been quarantined, taken
    // down, or lost its stem since the draft was created.
    const eligibility = await this.eligibilityService.checkEligibility(
      drop.trackId,
    );
    if (!eligibility.eligible) {
      throw new BadRequestException({
        code: "track_not_eligible",
        message:
          "This track is no longer eligible for a Punchline Drop and cannot be published.",
        reasons: eligibility.reasons,
      });
    }

    // Extract each clip sequentially. A PunchlineClipException is already a 400
    // with a stable code; we re-wrap it to name the failing moment so the artist
    // knows which range to fix. Deterministic filenames make a retry idempotent.
    const clipUriByMoment = new Map<string, string>();
    for (const moment of drop.moments) {
      try {
        const clip = await this.clipService.extractClip({
          trackId: drop.trackId,
          startMs: moment.startMs,
          endMs: moment.endMs,
        });
        clipUriByMoment.set(moment.id, clip.clipAssetUri);
      } catch (error) {
        if (error instanceof PunchlineClipException) {
          throw new PunchlineClipException(
            error.code,
            `Clip extraction failed for moment "${moment.title}" (${moment.id}) [${error.code}]. Adjust the clip range and try again.`,
          );
        }
        throw error;
      }
    }

    const publishedAt = new Date();
    await prisma.$transaction([
      ...drop.moments.map((moment) =>
        prisma.punchlineMoment.update({
          where: { id: moment.id },
          data: { clipAssetUri: clipUriByMoment.get(moment.id) },
        }),
      ),
      prisma.punchlineDrop.update({
        where: { id: drop.id },
        data: { status: "published", publishedAt },
      }),
    ]);

    const totalEditions = drop.moments.reduce(
      (sum, moment) => sum + moment.editionSize,
      0,
    );
    const event: PunchlineDropPublishedEvent = {
      eventName: "punchline.drop_published",
      eventVersion: 1,
      occurredAt: publishedAt.toISOString(),
      dropId: drop.id,
      trackId: drop.trackId,
      artistId: drop.artistId,
      momentCount: drop.moments.length,
      totalEditions,
    };
    this.eventBus.publish(event);

    return this.buildDropDetail(drop.id);
  }

  // ---------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------

  /**
   * Drop detail. Published/archived drops are public; a draft is visible ONLY to
   * its owner — an anonymous or non-owner caller gets a 404 so draft existence
   * never leaks.
   */
  async getDropDetail(dropId: string, userId?: string) {
    const drop = await this.loadDropWithCollectCounts(dropId);
    if (!drop) {
      throw new NotFoundException(`Punchline Drop ${dropId} not found`);
    }

    if (drop.status === "draft") {
      let isOwner = false;
      if (userId) {
        const artist = await prisma.artist.findUnique({ where: { userId } });
        isOwner = !!artist && artist.id === drop.artistId;
      }
      if (!isOwner) {
        throw new NotFoundException(`Punchline Drop ${dropId} not found`);
      }
    }

    return this.serializeDrop(drop);
  }

  /** Published drops for a track, newest first. Public list surface. */
  async listPublishedDropsForTrack(
    trackId: string,
    options?: { limit?: number },
  ) {
    const limit = Math.min(Math.max(options?.limit ?? 24, 1), 100);
    const rows = await prisma.punchlineDrop.findMany({
      where: { trackId, status: "published" },
      orderBy: { publishedAt: "desc" },
      take: limit,
      include: {
        moments: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { collectibles: true } } },
        },
      },
    });

    return {
      items: rows.map((row) => this.serializeDrop(row)),
      meta: { count: rows.length, limit },
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private loadDropWithMoments(dropId: string) {
    return prisma.punchlineDrop.findUnique({
      where: { id: dropId },
      include: { moments: { orderBy: { createdAt: "asc" } } },
    });
  }

  private loadDropWithCollectCounts(dropId: string) {
    return prisma.punchlineDrop.findUnique({
      where: { id: dropId },
      include: {
        moments: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { collectibles: true } } },
        },
      },
    });
  }

  private async loadOwnedDrop(
    userId: string,
    dropId: string,
  ): Promise<NonNullable<DropWithMoments>> {
    const drop = await this.loadDropWithMoments(dropId);
    if (!drop) {
      throw new NotFoundException(`Punchline Drop ${dropId} not found`);
    }
    const artist = await this.requireArtist(userId);
    if (drop.artistId !== artist.id) {
      throw new ForbiddenException("You do not own this Punchline Drop.");
    }
    return drop;
  }

  private assertDraft(drop: { status: string }) {
    if (drop.status !== "draft") {
      throw new BadRequestException(
        `Only draft drops can be modified (status: ${drop.status}).`,
      );
    }
  }

  private async requireArtist(userId: string) {
    const artist = await prisma.artist.findUnique({ where: { userId } });
    if (!artist) {
      throw new ForbiddenException(
        "You need an artist profile to manage Punchline Drops.",
      );
    }
    return artist;
  }

  private async buildDropDetail(dropId: string) {
    const drop = await this.loadDropWithCollectCounts(dropId);
    if (!drop) {
      throw new NotFoundException(`Punchline Drop ${dropId} not found`);
    }
    return this.serializeDrop(drop);
  }

  private serializeDrop(drop: {
    id: string;
    trackId: string;
    artistId: string;
    status: string;
    title: string | null;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    moments: Array<Parameters<PunchlineDropService["serializeMoment"]>[0]>;
  }) {
    return {
      id: drop.id,
      trackId: drop.trackId,
      artistId: drop.artistId,
      status: drop.status,
      title: drop.title,
      description: drop.description,
      createdAt: drop.createdAt,
      updatedAt: drop.updatedAt,
      publishedAt: drop.publishedAt,
      rightsLabel: PUNCHLINE_RIGHTS_LABEL,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
      moments: drop.moments.map((moment) => this.serializeMoment(moment)),
    };
  }

  private serializeMoment(moment: {
    id: string;
    title: string;
    lyricText: string;
    artworkUrl: string | null;
    sourceStemType: string;
    startMs: number;
    endMs: number;
    clipAssetUri: string | null;
    editionSize: number;
    priceCents: number;
    rightsLabel: string;
    _count?: { collectibles: number };
  }) {
    return {
      id: moment.id,
      title: moment.title,
      lyricText: moment.lyricText,
      artworkUrl: moment.artworkUrl,
      sourceStemType: moment.sourceStemType,
      startMs: moment.startMs,
      endMs: moment.endMs,
      clipAssetUri: moment.clipAssetUri,
      editionSize: moment.editionSize,
      priceCents: moment.priceCents,
      rightsLabel: moment.rightsLabel,
      collectedCount: moment._count?.collectibles ?? 0,
    };
  }

  /**
   * Normalize an optional free-text field: `undefined` means "not provided"
   * (caller omits it from the update), `null`/blank clears it, and anything
   * over the limit is rejected. Returns the trimmed string otherwise.
   */
  private normalizeOptionalText(
    value: string | null | undefined,
    maxLen: number,
    field: string,
  ): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (trimmed.length > maxLen) {
      throw new BadRequestException(
        `${field} must be at most ${maxLen} characters.`,
      );
    }
    return trimmed;
  }

  /**
   * Validate a fully-resolved moment (used on add and on the merged result of
   * an update). Range length is checked against the SAME bounds the #481 clip
   * service enforces so a range the draft accepts can always be extracted.
   */
  private validateMomentFields(input: {
    title: unknown;
    lyricText: unknown;
    artworkUrl: unknown;
    startMs: unknown;
    endMs: unknown;
    editionSize: unknown;
    priceCents: unknown;
  }): ValidatedMomentFields {
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      throw new BadRequestException("Moment title is required.");
    }
    const title = input.title.trim();
    if (title.length > MAX_MOMENT_TITLE_LEN) {
      throw new BadRequestException(
        `Moment title must be at most ${MAX_MOMENT_TITLE_LEN} characters.`,
      );
    }

    if (
      typeof input.lyricText !== "string" ||
      input.lyricText.trim().length === 0
    ) {
      throw new BadRequestException("Moment lyricText is required.");
    }
    const lyricText = input.lyricText.trim();
    if (lyricText.length > MAX_MOMENT_LYRIC_LEN) {
      throw new BadRequestException(
        `Moment lyricText must be at most ${MAX_MOMENT_LYRIC_LEN} characters (a punchline, not the whole song).`,
      );
    }

    let artworkUrl: string | null = null;
    if (input.artworkUrl !== null && input.artworkUrl !== undefined) {
      if (typeof input.artworkUrl !== "string") {
        throw new BadRequestException("Moment artworkUrl must be a string.");
      }
      const trimmed = input.artworkUrl.trim();
      if (trimmed.length > 0) {
        if (!ARTWORK_URL_PATTERN.test(trimmed)) {
          throw new BadRequestException(
            "Moment artworkUrl must be an http(s) or ipfs URL.",
          );
        }
        if (trimmed.length > MAX_ARTWORK_URL_LEN) {
          throw new BadRequestException(
            `Moment artworkUrl must be at most ${MAX_ARTWORK_URL_LEN} characters.`,
          );
        }
        artworkUrl = trimmed;
      }
    }

    if (!Number.isInteger(input.startMs) || (input.startMs as number) < 0) {
      throw new BadRequestException(
        "Moment startMs must be a non-negative integer.",
      );
    }
    const startMs = input.startMs as number;
    if (
      !Number.isInteger(input.endMs) ||
      (input.endMs as number) <= startMs
    ) {
      throw new BadRequestException(
        "Moment endMs must be an integer greater than startMs.",
      );
    }
    const endMs = input.endMs as number;

    const durationMs = endMs - startMs;
    const { minMs, maxMs } = resolvePunchlineClipBounds(this.configService);
    if (durationMs < minMs) {
      throw new BadRequestException(
        `Moment clip is ${durationMs}ms; the minimum is ${minMs}ms.`,
      );
    }
    if (durationMs > maxMs) {
      throw new BadRequestException(
        `Moment clip is ${durationMs}ms; the maximum is ${maxMs}ms.`,
      );
    }

    if (
      !Number.isInteger(input.editionSize) ||
      (input.editionSize as number) < 1 ||
      (input.editionSize as number) > MAX_EDITION_SIZE
    ) {
      throw new BadRequestException(
        `Moment editionSize must be an integer between 1 and ${MAX_EDITION_SIZE}.`,
      );
    }

    if (
      !Number.isInteger(input.priceCents) ||
      (input.priceCents as number) < 0 ||
      (input.priceCents as number) > MAX_PRICE_CENTS
    ) {
      throw new BadRequestException(
        `Moment priceCents must be an integer between 0 and ${MAX_PRICE_CENTS}.`,
      );
    }

    return {
      title,
      lyricText,
      artworkUrl,
      startMs,
      endMs,
      editionSize: input.editionSize as number,
      priceCents: input.priceCents as number,
    };
  }
}
