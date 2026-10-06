import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { normalizeAnalyticsGeoDimension } from "../analytics/analytics_event";
import {
  AnalyticsConsentService,
  PRODUCT_ANALYTICS_CONSENT_BASIS,
} from "../analytics/analytics_consent.service";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";
import { AnalyticsInstrumentationService } from "../analytics/analytics_instrumentation.service";
import type { FollowArtistDto } from "./artist_follow.dto";

export const ARTIST_FOLLOW_DEFAULT_SOURCE = "web_app";
const ARTIST_FOLLOW_PRODUCER = "artist-follow-service";

export interface ArtistFollowStatus {
  following: boolean;
}

interface FollowContext {
  releaseId?: string;
  trackId?: string;
}

/**
 * Artist follow state and its ledger events (#1968).
 *
 * Intentionally minimal: a follow is a private relationship between a listener
 * and an artist. There is no feed, no notification and no public follower
 * count. The only consumers are consent-governed demand aggregates (Scene Scout
 * city demand and first-listener reception), which read the `artist.followed`
 * ledger event and the current `ArtistFollow` row.
 */
@Injectable()
export class ArtistFollowService {
  constructor(
    @Optional() private readonly consentService?: AnalyticsConsentService,
    @Optional() private readonly instrumentation?: AnalyticsInstrumentationService,
  ) {}

  async getStatus(userId: string, artistId: string): Promise<ArtistFollowStatus> {
    const row = await prisma.artistFollow.findUnique({
      where: { userId_artistId: { userId, artistId } },
      select: { id: true },
    });
    return { following: Boolean(row) };
  }

  async follow(userId: string, artistId: string, input: FollowArtistDto = {}): Promise<ArtistFollowStatus> {
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { id: true, userId: true, managementOwnerUserId: true },
    });
    if (!artist) {
      throw new NotFoundException("Artist not found");
    }
    if (artist.userId === userId || artist.managementOwnerUserId === userId) {
      throw new BadRequestException("You cannot follow an artist profile you own or manage");
    }

    const context = await this.resolveFollowContext(artistId, input);
    const created = await prisma.$transaction(async (tx) => {
      // Account erasure and consent updates take the same user lock, so a
      // follow cannot be written for an account that is being closed.
      const lockedUsers = await tx.$queryRaw<Array<{ id: string; closedAt: Date | null; erasedAt: Date | null }>>(Prisma.sql`
        SELECT "id", "closedAt", "erasedAt"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `);
      const lockedUser = lockedUsers[0];
      if (!lockedUser || lockedUser.closedAt || lockedUser.erasedAt) {
        throw new ForbiddenException("A closed or erased account cannot follow an artist");
      }
      const result = await tx.artistFollow.createMany({
        data: [{ userId, artistId }],
        skipDuplicates: true,
      });
      return result.count > 0;
    });

    if (created) {
      await this.emit("artist.followed", userId, artistId, {
        payload: { artistId, ...context, source: normalizedSource(input.source) },
        geo: normalizeAnalyticsGeoDimension(input.geo),
      });
    }
    return { following: true };
  }

  async unfollow(userId: string, artistId: string): Promise<ArtistFollowStatus> {
    const removed = await prisma.artistFollow.deleteMany({ where: { userId, artistId } });
    if (removed.count > 0) {
      await this.emit("artist.unfollowed", userId, artistId, {
        payload: { artistId, source: ARTIST_FOLLOW_DEFAULT_SOURCE },
      });
    }
    return { following: false };
  }

  /**
   * Release/track context is kept only when it belongs to this artist's own
   * catalog, using the same ownership Scene Scout measures (`Release.artistId`).
   * A track wins over a release because it resolves to its real release.
   */
  private async resolveFollowContext(artistId: string, input: FollowArtistDto): Promise<FollowContext> {
    const trackId = input.trackId?.trim();
    if (trackId) {
      const track = await prisma.track.findUnique({
        where: { id: trackId },
        select: { id: true, releaseId: true, release: { select: { artistId: true } } },
      });
      if (track && track.release.artistId === artistId) {
        return { releaseId: track.releaseId, trackId: track.id };
      }
    }
    const releaseId = input.releaseId?.trim();
    if (releaseId) {
      const release = await prisma.release.findUnique({
        where: { id: releaseId },
        select: { id: true, artistId: true },
      });
      if (release && release.artistId === artistId) {
        return { releaseId: release.id };
      }
    }
    return {};
  }

  /**
   * Emission respects current analytics consent exactly like the browser
   * telemetry routes: without a current grant nothing is written to the ledger.
   * It never fails the follow itself.
   */
  private async emit(
    eventName: "artist.followed" | "artist.unfollowed",
    userId: string,
    artistId: string,
    details: { payload: Record<string, unknown>; geo?: ReturnType<typeof normalizeAnalyticsGeoDimension> },
  ) {
    if (!this.consentService || !this.instrumentation) return;
    try {
      if (!(await this.consentService.isProductAnalyticsAllowed(userId))) return;
      await this.instrumentation.recordProductEvent({
        eventName,
        producer: ARTIST_FOLLOW_PRODUCER,
        actorId: pseudonymousAnalyticsActorId(userId),
        subjectType: "artist",
        subjectId: artistId,
        source: typeof details.payload.source === "string" ? details.payload.source : ARTIST_FOLLOW_DEFAULT_SOURCE,
        geo: details.geo,
        consentBasis: PRODUCT_ANALYTICS_CONSENT_BASIS,
        payload: details.payload,
        sourceRefs: { artistId },
      });
    } catch (error) {
      console.warn(
        `[ArtistFollow] Failed to record analytics event ${eventName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function normalizedSource(value: string | undefined) {
  const source = value?.trim();
  return source || ARTIST_FOLLOW_DEFAULT_SOURCE;
}
