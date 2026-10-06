import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";
import {
  FIRST_LISTENER_MAX_RELEASE_PLACEMENTS,
  FIRST_LISTENER_WINDOW_MS,
  type FirstListenerArtistReception,
  type FirstListenerReceptionRelease,
} from "./first_listener.contracts";

const RECEPTION_RELEASE_READ_CAP = 100;
const RECEPTION_EXPOSURE_READ_CAP = FIRST_LISTENER_MAX_RELEASE_PLACEMENTS;
const RECEPTION_PLAYBACK_FACT_READ_CAP = 10_000;

interface ExposureForReception {
  releaseId: string;
  userId: string;
  placedAt: Date;
  release: {
    createdAt: Date;
    managementOwnerUserId: string | null;
    artist: { userId: string | null; managementOwnerUserId: string | null };
  };
  user: {
    analyticsConsent: {
      productAnalytics: boolean;
      policyVersion: string;
    } | null;
    tasteMemorySettings: {
      resetAt: Date | null;
      agentPlaybackTrainingEnabled: boolean;
    } | null;
  };
}

interface ReceptionAggregate {
  releaseId: string;
  heard: bigint | number;
  fullPlays: bigint | number;
  saves: bigint | number;
  follows: bigint | number;
  overflow: boolean;
}

export function parseDiscoveryMinimumAudience(rawValue: string | undefined): number {
  const raw = rawValue?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return 3;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 3;
}

/**
 * Gives an artist only aggregate reception after a release's first seven
 * catalog days. A recommendation exposure is never counted as a play: every
 * count starts with an exposure joined to a current-consent listener who later
 * produced a pseudonymous playback event for that release.
 */
@Injectable()
export class FirstListenerReceptionService {
  async getArtistReception(
    artistId: string,
    options: { now?: Date } = {},
  ): Promise<FirstListenerArtistReception> {
    const now = options.now ?? new Date();
    const threshold = parseDiscoveryMinimumAudience(process.env.DISCOVERY_MIN_AUDIENCE);
    const failClosed = (): FirstListenerArtistReception => ({
      available: false,
      minimumAudience: threshold,
      releases: [],
    });

    try {
      const releases = await prisma.release.findMany({
        where: {
          artistId,
          createdAt: { lte: new Date(now.getTime() - FIRST_LISTENER_WINDOW_MS) },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: RECEPTION_RELEASE_READ_CAP + 1,
        select: { id: true, title: true, createdAt: true },
      });
      if (releases.length > RECEPTION_RELEASE_READ_CAP) return failClosed();
      if (releases.length === 0) {
        return { available: true, minimumAudience: threshold, releases: [] };
      }

      // Bound each matured release independently at the placement cap. A
      // second release therefore cannot suppress a safe summary for the first.
      const aggregateByRelease = new Map<string, ReceptionAggregate>();
      for (const release of releases) {
        const rows = (await prisma.firstListenerExposure.findMany({
          where: { releaseId: release.id, placedAt: { lte: now } },
          orderBy: { placedAt: "asc" },
          take: RECEPTION_EXPOSURE_READ_CAP + 1,
          select: {
            releaseId: true,
            userId: true,
            placedAt: true,
            release: {
              select: {
                createdAt: true,
                managementOwnerUserId: true,
                artist: { select: { userId: true, managementOwnerUserId: true } },
              },
            },
            user: {
              select: {
                analyticsConsent: {
                  select: { productAnalytics: true, policyVersion: true },
                },
                tasteMemorySettings: {
                  select: { resetAt: true, agentPlaybackTrainingEnabled: true },
                },
              },
            },
          },
        })) as ExposureForReception[];
        if (rows.length > RECEPTION_EXPOSURE_READ_CAP) return failClosed();
        const qualified = rows.filter((exposure) => {
          const consent = exposure.user.analyticsConsent;
          const owners = new Set(
            [
              exposure.release.managementOwnerUserId,
              exposure.release.artist.userId,
              exposure.release.artist.managementOwnerUserId,
            ].filter((id): id is string => Boolean(id)),
          );
          const validPlacementWindow =
            exposure.placedAt >= exposure.release.createdAt &&
            exposure.placedAt <=
              new Date(exposure.release.createdAt.getTime() + FIRST_LISTENER_WINDOW_MS);
          return Boolean(
            validPlacementWindow &&
              !owners.has(exposure.userId) &&
              consent?.productAnalytics &&
              consent.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION,
          );
        });
        const pseudonymousExposures = qualified.flatMap((exposure) => {
          const actorId = pseudonymousAnalyticsActorId(exposure.userId);
          return actorId
            ? [{
                releaseId: exposure.releaseId,
                actorId,
                rawActorId: exposure.userId,
                placedAt: exposure.placedAt,
                resetAt: exposure.user.tasteMemorySettings?.resetAt ?? null,
                agentPlaybackTrainingEnabled:
                  exposure.user.tasteMemorySettings?.agentPlaybackTrainingEnabled ?? true,
              }]
            : [];
        });
        if (pseudonymousExposures.length > 0) {
          const aggregate = await this.aggregateReception(pseudonymousExposures);
          if (aggregate[0]?.overflow) return failClosed();
          if (aggregate[0]) aggregateByRelease.set(release.id, aggregate[0]);
        }
      }

      const result: FirstListenerReceptionRelease[] = releases.map((release) => {
        const aggregate = aggregateByRelease.get(release.id);
        const heardCount = aggregate ? Number(aggregate.heard) : 0;
        const fullPlayCount = aggregate ? Number(aggregate.fullPlays) : 0;
        const saveCount = aggregate ? Number(aggregate.saves) : 0;
        const followCount = aggregate ? Number(aggregate.follows) : 0;
        return {
          releaseId: release.id,
          title: release.title,
          createdAt: release.createdAt,
          heard: heardCount >= threshold ? heardCount : null,
          fullPlays: heardCount >= threshold && fullPlayCount >= threshold
            ? fullPlayCount
            : null,
          saves: heardCount >= threshold && saveCount >= threshold ? saveCount : null,
          follows: heardCount >= threshold && followCount >= threshold ? followCount : null,
        };
      });
      return { available: true, minimumAudience: threshold, releases: result };
    } catch {
      // Includes missing actor salt or a database/aggregation failure. Artists
      // receive no partial or identity-bearing result when evidence is unsafe.
      return failClosed();
    }
  }

  private aggregateReception(
    exposures: Array<{
      releaseId: string;
      actorId: string;
      rawActorId: string;
      placedAt: Date;
      resetAt: Date | null;
      agentPlaybackTrainingEnabled: boolean;
    }>,
  ) {
    const exposureValues = Prisma.join(
      exposures.map((exposure) =>
        Prisma.sql`(
          ${exposure.releaseId}::text,
          ${exposure.actorId}::text,
          ${exposure.rawActorId}::text,
          ${exposure.placedAt}::timestamp,
          ${exposure.resetAt}::timestamp,
          ${exposure.agentPlaybackTrainingEnabled}::boolean
        )`,
      ),
    );
    return prisma.$queryRaw<ReceptionAggregate[]>(Prisma.sql`
      WITH "qualifiedExposure"(
        "releaseId", "actorId", "rawActorId", "placedAt", "resetAt", "agentPlaybackTrainingEnabled"
      ) AS (
        VALUES ${exposureValues}
      ),
      "matchedPlaybackFacts" AS (
        SELECT
          x."releaseId",
          x."actorId",
          x."rawActorId",
          x."placedAt",
          x."agentPlaybackTrainingEnabled",
          event."id" AS "eventId",
          event."eventName",
          event."occurredAt",
          CASE
            WHEN (event."payload"->>'completionRatio') ~ '^[0-9]+([.][0-9]+)?$'
              THEN (event."payload"->>'completionRatio')::numeric
            ELSE NULL
          END AS "completionRatio"
        FROM "qualifiedExposure" x
        INNER JOIN "Release" release ON release."id" = x."releaseId"
        INNER JOIN "AnalyticsEvent" event
          ON event."actorId" IN (x."actorId", x."rawActorId")
          AND event."privacyTier" = 'pseudonymous'
          AND event."consentBasis" = 'consent'
          AND event."eventName" IN (
            'playback.started',
            'playback.completed',
            'library.saved'
          )
          AND event."occurredAt" > x."placedAt"
          AND (x."resetAt" IS NULL OR event."occurredAt" > x."resetAt")
          AND event."occurredAt" <= release."createdAt" + INTERVAL '7 days'
        INNER JOIN "Track" track
          ON track."id" = event."payload"->>'trackId'
        INNER JOIN "Release" actualRelease
          ON actualRelease."id" = track."releaseId"
          AND actualRelease."id" = x."releaseId"
        WHERE event."eventName" = 'library.saved'
          OR x."agentPlaybackTrainingEnabled"
          OR (
            event."payload"->>'agentOriginated' IS DISTINCT FROM 'true'
            AND LOWER(COALESCE(event."payload"->>'source', '')) NOT LIKE 'agent%'
            AND LOWER(COALESCE(event."payload"->>'initiator', '')) <> 'agent'
            AND NULLIF(event."payload"->>'agentSessionId', '') IS NULL
          )
        ORDER BY event."occurredAt" ASC, event."id" ASC
        LIMIT ${RECEPTION_PLAYBACK_FACT_READ_CAP + 1}
      ),
      -- #1968: a follow counts only while the listener still follows the release's
      -- artist, for the current follow, from a consented ledger event after the
      -- placement and inside the release's first catalog week.
      "matchedFollowFacts" AS (
        SELECT
          x."releaseId",
          x."actorId",
          event."id" AS "eventId",
          event."occurredAt"
        FROM "qualifiedExposure" x
        INNER JOIN "Release" release ON release."id" = x."releaseId"
        INNER JOIN "ArtistFollow" follow
          ON follow."userId" = x."rawActorId"
          AND follow."artistId" = release."artistId"
        INNER JOIN "AnalyticsEvent" event
          ON event."actorId" IN (x."actorId", x."rawActorId")
          AND event."privacyTier" = 'pseudonymous'
          AND event."consentBasis" = 'consent'
          AND event."eventName" = 'artist.followed'
          AND event."payload"->>'artistId' = release."artistId"
          AND event."occurredAt" > x."placedAt"
          AND (x."resetAt" IS NULL OR event."occurredAt" > x."resetAt")
          AND event."occurredAt" <= release."createdAt" + INTERVAL '7 days'
          AND event."occurredAt" >= follow."createdAt" - INTERVAL '1 minute'
        ORDER BY event."occurredAt" ASC, event."id" ASC
        LIMIT ${RECEPTION_PLAYBACK_FACT_READ_CAP + 1}
      ),
      "followFacts" AS (
        SELECT * FROM "matchedFollowFacts"
        ORDER BY "occurredAt" ASC, "eventId" ASC
        LIMIT ${RECEPTION_PLAYBACK_FACT_READ_CAP}
      ),
      "overflow" AS (
        SELECT (
          (SELECT COUNT(*) FROM "matchedPlaybackFacts") > ${RECEPTION_PLAYBACK_FACT_READ_CAP}
          OR (SELECT COUNT(*) FROM "matchedFollowFacts") > ${RECEPTION_PLAYBACK_FACT_READ_CAP}
        ) AS "overflow"
      ),
      "playbackFacts" AS (
        SELECT * FROM "matchedPlaybackFacts"
        ORDER BY "occurredAt" ASC, "eventId" ASC
        LIMIT ${RECEPTION_PLAYBACK_FACT_READ_CAP}
      ),
      "heard" AS (
        SELECT "releaseId", "actorId", MIN("occurredAt") AS "heardAt"
        FROM "playbackFacts"
        WHERE "eventName" IN ('playback.started', 'playback.completed')
        GROUP BY "releaseId", "actorId"
      ),
      "fullPlayListeners" AS (
        SELECT DISTINCT heard."releaseId", heard."actorId"
        FROM "heard" heard
        INNER JOIN "playbackFacts" fact
          ON fact."releaseId" = heard."releaseId"
          AND fact."actorId" = heard."actorId"
          AND fact."eventName" = 'playback.completed'
          AND fact."occurredAt" >= heard."heardAt"
          AND fact."completionRatio" >= 0.9
      ),
      "saveListeners" AS (
        SELECT DISTINCT heard."releaseId", heard."actorId"
        FROM "heard" heard
        INNER JOIN "playbackFacts" fact
          ON fact."releaseId" = heard."releaseId"
          AND fact."actorId" = heard."actorId"
          AND fact."eventName" = 'library.saved'
          AND fact."occurredAt" >= heard."heardAt"
      ),
      "followListeners" AS (
        SELECT DISTINCT heard."releaseId", heard."actorId"
        FROM "heard" heard
        INNER JOIN "followFacts" fact
          ON fact."releaseId" = heard."releaseId"
          AND fact."actorId" = heard."actorId"
          AND fact."occurredAt" >= heard."heardAt"
      ),
      "metrics" AS (
        SELECT
          heard."releaseId",
          COUNT(*)::bigint AS "heard",
          COUNT(DISTINCT "fullPlayListeners"."actorId")::bigint AS "fullPlays",
          COUNT(DISTINCT "saveListeners"."actorId")::bigint AS "saves",
          COUNT(DISTINCT "followListeners"."actorId")::bigint AS "follows"
        FROM "heard"
        LEFT JOIN "fullPlayListeners"
          ON "fullPlayListeners"."releaseId" = heard."releaseId"
          AND "fullPlayListeners"."actorId" = heard."actorId"
        LEFT JOIN "saveListeners"
          ON "saveListeners"."releaseId" = heard."releaseId"
          AND "saveListeners"."actorId" = heard."actorId"
        LEFT JOIN "followListeners"
          ON "followListeners"."releaseId" = heard."releaseId"
          AND "followListeners"."actorId" = heard."actorId"
        GROUP BY heard."releaseId"
      )
      SELECT
        exposure."releaseId",
        COALESCE(metrics."heard", 0)::bigint AS "heard",
        COALESCE(metrics."fullPlays", 0)::bigint AS "fullPlays",
        COALESCE(metrics."saves", 0)::bigint AS "saves",
        COALESCE(metrics."follows", 0)::bigint AS "follows",
        overflow."overflow"
      FROM (SELECT DISTINCT "releaseId" FROM "qualifiedExposure") exposure
      CROSS JOIN "overflow"
      LEFT JOIN "metrics" metrics ON metrics."releaseId" = exposure."releaseId"
    `);
  }
}
