import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { PunchlineUnlockGrantedEvent } from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import { resolvePunchlineClipBounds } from "./punchline-clip.config";
import { PunchlineClipException, PunchlineClipService } from "./punchline-clip.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { PUNCHLINE_SOURCE_STEM_TYPE } from "./punchline-rights";
import { normalizeSourceLayer, sourceLayerLabel } from "./punchline-source";

/**
 * The layer a set's bonus clip is cut from (#2522): the layer most of the set's
 * moments use, so an orchestral set's bonus is not a vocal clip. Ties go to
 * vocals when vocals is tied, otherwise to the layer of the earliest moment.
 * No moments falls back to vocals.
 */
export function setBonusSourceLayer(momentLayers: Array<string | null | undefined>): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const raw of momentLayers) {
    const layer = normalizeSourceLayer(raw) || PUNCHLINE_SOURCE_STEM_TYPE;
    if (!counts.has(layer)) order.push(layer);
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  if (order.length === 0) return PUNCHLINE_SOURCE_STEM_TYPE;
  const top = Math.max(...counts.values());
  const tied = order.filter((layer) => counts.get(layer) === top);
  return tied.includes(PUNCHLINE_SOURCE_STEM_TYPE) ? PUNCHLINE_SOURCE_STEM_TYPE : tied[0]!;
}

/**
 * Complete-set unlock rewards (#488).
 *
 * The first unlock mechanic: an artist attaches ONE optional `complete_set`
 * bonus to a drop — a bonus vocal clip (extracted with the same #481 primitive
 * moments use) plus an optional personal note. A fan who collects every moment
 * in the drop is granted the reward **exactly once**, enforced by the
 * `@@unique([unlockId, collectorUserId])` constraint (same DB-level philosophy
 * as edition scarcity).
 *
 * Reveal gating: the reward content (clip uri + note) is serialized ONLY to
 * granted collectors and the drop's owner. Everyone else sees just that a
 * bonus exists — the incentive without the content.
 *
 * Red line (ADR-BM-4): a reward is bonus content/utility, never income or a
 * revenue share.
 */

export type PunchlineUnlockRewardMetadata = {
  kind: "bonus_clip";
  startMs: number;
  endMs: number;
  message: string | null;
  /** The layer the clip was cut from, set at publish (#2522); absent on older rows. */
  sourceStemType?: string;
  /** Filled at publish time by the #481 extractor; null while drafting. */
  clipAssetUri: string | null;
};

const MAX_UNLOCK_MESSAGE_LEN = 500;

/** Parse stored rewardMetadata into the typed bonus_clip reward, or null. */
export function parsePunchlineUnlockReward(
  metadata: Prisma.JsonValue | null,
): PunchlineUnlockRewardMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const m = metadata as Record<string, unknown>;
  if (m.kind !== "bonus_clip") {
    return null;
  }
  return {
    kind: "bonus_clip",
    startMs: Number(m.startMs),
    endMs: Number(m.endMs),
    message: typeof m.message === "string" ? m.message : null,
    ...(typeof m.sourceStemType === "string" ? { sourceStemType: m.sourceStemType } : {}),
    clipAssetUri: typeof m.clipAssetUri === "string" ? m.clipAssetUri : null,
  };
}

export interface SetDropUnlockInput {
  startMs?: number;
  endMs?: number;
  message?: string | null;
}

@Injectable()
export class PunchlineUnlockService {
  private readonly logger = new Logger(PunchlineUnlockService.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly clipService: PunchlineClipService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * Create or replace the drop's single complete_set unlock (owner + draft
   * only — the caller must already be authorized by the drop service; this
   * re-checks to stay safe standalone).
   */
  async setDropUnlock(userId: string, dropId: string, input: SetDropUnlockInput) {
    const drop = await this.loadOwnedDraftDrop(userId, dropId);

    const startMs = input?.startMs;
    const endMs = input?.endMs;
    if (
      !Number.isInteger(startMs) ||
      !Number.isInteger(endMs) ||
      (startMs as number) < 0 ||
      (endMs as number) <= (startMs as number)
    ) {
      throw new BadRequestException(
        "Bonus clip range requires integer startMs >= 0 and endMs > startMs.",
      );
    }
    const durationMs = (endMs as number) - (startMs as number);
    const { minMs, maxMs } = resolvePunchlineClipBounds(this.configService);
    if (durationMs < minMs || durationMs > maxMs) {
      throw new BadRequestException(
        `Bonus clip must be between ${minMs}ms and ${maxMs}ms long.`,
      );
    }

    let message: string | null = null;
    if (input.message != null) {
      if (typeof input.message !== "string") {
        throw new BadRequestException("Bonus message must be a string.");
      }
      const trimmed = input.message.trim();
      if (trimmed.length > MAX_UNLOCK_MESSAGE_LEN) {
        throw new BadRequestException(
          `Bonus message must be at most ${MAX_UNLOCK_MESSAGE_LEN} characters.`,
        );
      }
      message = trimmed.length > 0 ? trimmed : null;
    }

    const rewardMetadata: PunchlineUnlockRewardMetadata = {
      kind: "bonus_clip",
      startMs: startMs as number,
      endMs: endMs as number,
      message,
      clipAssetUri: null,
    };

    // One unlock per drop in the MVP: replace any existing rule.
    await prisma.$transaction([
      prisma.punchlineUnlock.deleteMany({ where: { dropId: drop.id } }),
      prisma.punchlineUnlock.create({
        data: {
          dropId: drop.id,
          unlockType: "complete_set",
          rewardMetadata,
        },
      }),
    ]);

    return this.getOwnerUnlock(drop.id);
  }

  /** Remove the drop's unlock (owner + draft only). */
  async removeDropUnlock(userId: string, dropId: string) {
    const drop = await this.loadOwnedDraftDrop(userId, dropId);
    await prisma.punchlineUnlock.deleteMany({ where: { dropId: drop.id } });
    return { removed: true };
  }

  /**
   * Publish-time hook: extract the bonus clip for the drop's unlock (if any)
   * with the same #481 primitive moments use, and persist the asset uri into
   * rewardMetadata. Called by the drop service inside its publish flow, after
   * the eligibility re-check. Throws the extractor's typed 400 on failure so
   * the drop stays a draft.
   */
  async renderUnlockClipForPublish(
    dropId: string,
    trackId: string,
    sourceLayer: string = PUNCHLINE_SOURCE_STEM_TYPE,
  ) {
    const unlock = await prisma.punchlineUnlock.findFirst({
      where: { dropId },
    });
    if (!unlock) {
      return null;
    }
    const reward = parsePunchlineUnlockReward(unlock.rewardMetadata);
    if (!reward) {
      this.logger.warn(`Unlock ${unlock.id} has unparseable rewardMetadata`);
      return null;
    }
    let clip: Awaited<ReturnType<PunchlineClipService["extractClip"]>>;
    try {
      clip = await this.clipService.extractClip({
        trackId,
        startMs: reward.startMs,
        endMs: reward.endMs,
        sourceLayer,
      });
    } catch (error) {
      if (error instanceof PunchlineClipException) {
        // Name the layer: a bonus cut from the full mix has a tighter cap.
        throw new PunchlineClipException(
          error.code,
          `The set bonus is cut from the ${sourceLayerLabel(sourceLayer)}, like most of this set's moments, and failed [${error.code}]: ${error.message} Adjust the bonus range and try again.`,
        );
      }
      throw error;
    }
    const updated: PunchlineUnlockRewardMetadata = {
      ...reward,
      sourceStemType: sourceLayer,
      clipAssetUri: clip.clipAssetUri,
    };
    await prisma.punchlineUnlock.update({
      where: { id: unlock.id },
      data: { rewardMetadata: updated },
    });
    return updated;
  }

  /**
   * Grant the drop's reward to a collector who just completed the set.
   * Exactly-once via the DB unique pair; a repeat call is a no-op.
   * Returns the granted reward (revealed) or null when the drop has no unlock.
   */
  async grantForCompletedSet(userId: string, dropId: string) {
    const unlock = await prisma.punchlineUnlock.findFirst({
      where: { dropId },
      include: {
        drop: { select: { trackId: true, artistId: true } },
      },
    });
    if (!unlock) {
      return null;
    }

    let isNewGrant = false;
    try {
      await prisma.punchlineUnlockGrant.create({
        data: { unlockId: unlock.id, collectorUserId: userId },
      });
      isNewGrant = true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Already granted — exactly-once satisfied, reveal again idempotently.
      } else {
        throw error;
      }
    }

    if (isNewGrant) {
      const event: PunchlineUnlockGrantedEvent = {
        eventName: "punchline.unlock_granted",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        unlockId: unlock.id,
        dropId,
        trackId: unlock.drop.trackId,
        artistId: unlock.drop.artistId,
        collectorUserId: userId,
      };
      this.eventBus.publish(event);
    }

    return {
      unlockId: unlock.id,
      unlockType: unlock.unlockType,
      newlyGranted: isNewGrant,
      reward: parsePunchlineUnlockReward(unlock.rewardMetadata),
    };
  }

  /**
   * The caller's granted rewards, newest first, with drop/track context —
   * the collector-side queryable reward state (#488 acceptance).
   */
  async listMyUnlocks(userId: string) {
    const rows = await prisma.punchlineUnlockGrant.findMany({
      where: { collectorUserId: userId },
      orderBy: { grantedAt: "desc" },
      take: 100,
      include: {
        unlock: {
          include: {
            drop: {
              select: {
                id: true,
                title: true,
                trackId: true,
                artistId: true,
                track: {
                  select: {
                    title: true,
                    releaseId: true,
                    // Credited-artist inputs (#1492): show the real artist, not
                    // the uploader/manager account label.
                    artist: true,
                    release: { select: { primaryArtist: true } },
                  },
                },
                artist: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        grantedAt: row.grantedAt,
        unlockId: row.unlockId,
        unlockType: row.unlock.unlockType,
        reward: parsePunchlineUnlockReward(row.unlock.rewardMetadata),
        drop: {
          id: row.unlock.drop.id,
          title: row.unlock.drop.title,
          trackId: row.unlock.drop.trackId,
          trackTitle: row.unlock.drop.track?.title ?? null,
          releaseId: row.unlock.drop.track?.releaseId ?? null,
          artistId: row.unlock.drop.artistId,
          artistName: resolveCreditedArtistName({
            trackArtist: row.unlock.drop.track?.artist,
            primaryArtist: row.unlock.drop.track?.release?.primaryArtist,
            accountDisplayName: row.unlock.drop.artist?.displayName,
          }),
        },
      })),
      meta: { count: rows.length },
    };
  }

  /**
   * Public-safe unlock summary for a drop: existence + whether the CALLER has
   * been granted it. Never leaks the reward content to non-granted callers.
   */
  async summarizeForDrop(dropId: string, userId?: string) {
    const unlock = await prisma.punchlineUnlock.findFirst({
      where: { dropId },
      select: { id: true, unlockType: true },
    });
    if (!unlock) {
      return null;
    }
    let granted = false;
    if (userId) {
      const grant = await prisma.punchlineUnlockGrant.findUnique({
        where: {
          unlockId_collectorUserId: {
            unlockId: unlock.id,
            collectorUserId: userId,
          },
        },
        select: { id: true },
      });
      granted = !!grant;
    }
    return { unlockType: unlock.unlockType, granted };
  }

  /**
   * Owner view of the drop's unlock: full config + how many fans earned it —
   * the artist-side queryable reward state (#488 acceptance). Reveal here is
   * safe: the caller is the drop's owner (checked by the drop service route).
   */
  async getOwnerUnlock(dropId: string) {
    const unlock = await prisma.punchlineUnlock.findFirst({
      where: { dropId },
      include: { _count: { select: { grants: true } } },
    });
    if (!unlock) {
      return null;
    }
    return {
      id: unlock.id,
      unlockType: unlock.unlockType,
      reward: parsePunchlineUnlockReward(unlock.rewardMetadata),
      grantedCount: unlock._count.grants,
    };
  }

  private async loadOwnedDraftDrop(userId: string, dropId: string) {
    const drop = await prisma.punchlineDrop.findUnique({
      where: { id: dropId },
      select: { id: true, artistId: true, status: true, trackId: true },
    });
    if (!drop) {
      throw new NotFoundException(`Punchline Drop ${dropId} not found`);
    }
    const artist = await prisma.artist.findUnique({ where: { userId } });
    if (!artist || artist.id !== drop.artistId) {
      throw new ForbiddenException("You do not own this Punchline Drop.");
    }
    if (drop.status !== "draft") {
      throw new BadRequestException(
        "Only draft drops can change their set bonus.",
      );
    }
    return drop;
  }
}
