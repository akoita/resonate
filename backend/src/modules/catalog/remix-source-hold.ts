/**
 * Source holds on published remixes (#2601, ADR-LD-5 §4).
 *
 * Remix eligibility is checked when a remix is made and published. This is
 * the part that looks back: when a source stops being remixable — the artist
 * revokes remix consent, withdraws the release, or the track is held or
 * taken down — every published derivative of it leaves discovery and stops
 * selling, and comes back when the cause is lifted.
 *
 * A hold reuses the withdrawal state (#1793): the release row and every
 * reference to it survive, libraries and playlists show the track as
 * unavailable, and buyers keep what they bought. `Release.sourceHoldReason`
 * marks a withdrawal the platform made, so it is never confused with one the
 * remixer made themselves:
 *
 * - held by the platform: `status = withdrawn`, `sourceHoldReason` set. The
 *   owner cannot restore it; it is restored here when no source blocks it.
 * - withdrawn by the owner: `sourceHoldReason` null. Never restored here, and
 *   the owner cannot restore it while a source still blocks it.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { EventBus } from "../shared/event_bus";
import {
  RELEASE_STATUS_WITHDRAWN,
  WITHDRAWABLE_RELEASE_STATUSES,
} from "./track-availability";

/** Strongest first: the reason shown when several apply. */
export const REMIX_SOURCE_HOLD_REASONS = [
  "source_removed",
  "source_under_review",
  "source_consent_revoked",
  "source_withdrawn",
] as const;
export type RemixSourceHoldReason = (typeof REMIX_SOURCE_HOLD_REASONS)[number];

export function isRemixSourceHoldReason(value: unknown): value is RemixSourceHoldReason {
  return (REMIX_SOURCE_HOLD_REASONS as readonly string[]).includes(value as string);
}

type SourceDb = Prisma.TransactionClient | typeof prisma;

const SOURCE_TRACK_SELECT = {
  id: true,
  contentStatus: true,
  release: {
    select: {
      status: true,
      artist: { select: { remixConsent: true } },
    },
  },
} as const;

type SourceTrackRow = {
  id: string;
  contentStatus: string;
  release: { status: string; artist: { remixConsent: string } | null } | null;
};

/** Why one source blocks its derivatives right now, or null when it doesn't. */
export function sourceHoldReasonForTrack(source: SourceTrackRow): RemixSourceHoldReason | null {
  if (source.contentStatus === "dmca_removed") return "source_removed";
  if (source.contentStatus === "quarantined") return "source_under_review";
  if (source.release?.artist?.remixConsent === "disabled") return "source_consent_revoked";
  if (source.release?.status === RELEASE_STATUS_WITHDRAWN) return "source_withdrawn";
  return null;
}

/** The strongest reason across a derivative's sources (a mashup has two). */
export function strongestSourceHoldReason(
  sources: Array<SourceTrackRow | null | undefined>,
): RemixSourceHoldReason | null {
  let strongest: RemixSourceHoldReason | null = null;
  for (const source of sources) {
    if (!source) continue;
    const reason = sourceHoldReasonForTrack(source);
    if (!reason) continue;
    if (
      strongest === null ||
      REMIX_SOURCE_HOLD_REASONS.indexOf(reason) < REMIX_SOURCE_HOLD_REASONS.indexOf(strongest)
    ) {
      strongest = reason;
    }
  }
  return strongest;
}

/**
 * The reason a release must stay held right now, computed from its sources.
 * Null for a release that is not a published remix, or whose sources are all
 * clear. Used to refuse an owner's restore while a source still blocks it.
 */
export async function currentSourceHoldReason(
  db: SourceDb,
  releaseId: string,
): Promise<RemixSourceHoldReason | null> {
  const project = await db.remixProject.findUnique({
    where: { publishedReleaseId: releaseId },
    select: {
      sourceTrack: { select: SOURCE_TRACK_SELECT },
      secondarySourceTrack: { select: SOURCE_TRACK_SELECT },
    },
  });
  if (!project) return null;
  return strongestSourceHoldReason([project.sourceTrack, project.secondarySourceTrack]);
}

export interface RemixSourceHoldChange {
  releaseId: string;
  remixProjectId: string;
  creatorId: string;
  held: boolean;
  /** The reason it was held; on release, the reason it had been held for. */
  reason: RemixSourceHoldReason;
}

/** Which sources changed. Any combination; an empty scope does nothing. */
export interface RemixSourceHoldScope {
  trackIds?: string[];
  releaseIds?: string[];
  artistIds?: string[];
}

async function sourceTrackIdsFor(scope: RemixSourceHoldScope): Promise<string[]> {
  const ids = new Set(scope.trackIds ?? []);
  const or: Prisma.TrackWhereInput[] = [];
  if (scope.releaseIds?.length) or.push({ releaseId: { in: scope.releaseIds } });
  if (scope.artistIds?.length) or.push({ release: { artistId: { in: scope.artistIds } } });
  if (or.length > 0) {
    const tracks = await prisma.track.findMany({ where: { OR: or }, select: { id: true } });
    for (const track of tracks) ids.add(track.id);
  }
  return [...ids];
}

/**
 * Bring the published derivatives of the given sources in line with their
 * sources' current state: hold the ones that must be held, restore the ones
 * the platform held whose cause is gone.
 *
 * Follows the chain: a remix that is held or restored is itself a source, so
 * its own derivatives are reconciled next. Each release changes through one
 * conditional update, so concurrent runs cannot hold or restore twice.
 */
export async function reconcileRemixSourceHolds(
  scope: RemixSourceHoldScope,
): Promise<RemixSourceHoldChange[]> {
  const changes: RemixSourceHoldChange[] = [];
  const seenProjects = new Set<string>();
  let frontier = await sourceTrackIdsFor(scope);

  while (frontier.length > 0) {
    const projects = await prisma.remixProject.findMany({
      where: {
        status: "published",
        publishedReleaseId: { not: null },
        OR: [
          { sourceTrackId: { in: frontier } },
          { secondarySourceTrackId: { in: frontier } },
        ],
      },
      select: {
        id: true,
        creatorUserId: true,
        sourceTrack: { select: SOURCE_TRACK_SELECT },
        secondarySourceTrack: { select: SOURCE_TRACK_SELECT },
        publishedRelease: {
          select: {
            id: true,
            status: true,
            statusBeforeWithdrawal: true,
            sourceHoldReason: true,
            tracks: { select: { id: true } },
          },
        },
      },
    });

    const next: string[] = [];
    for (const project of projects) {
      const release = project.publishedRelease;
      if (!release || seenProjects.has(project.id)) continue;
      seenProjects.add(project.id);

      const reason = strongestSourceHoldReason([project.sourceTrack, project.secondarySourceTrack]);
      const base = {
        releaseId: release.id,
        remixProjectId: project.id,
        creatorId: project.creatorUserId,
      };

      if (reason) {
        const held = await prisma.release.updateMany({
          where: { id: release.id, status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] } },
          data: {
            status: RELEASE_STATUS_WITHDRAWN,
            statusBeforeWithdrawal: release.status,
            withdrawnAt: new Date(),
            withdrawalReason: null,
            sourceHoldReason: reason,
          },
        });
        if (held.count === 1) {
          changes.push({ ...base, held: true, reason });
          next.push(...release.tracks.map((track) => track.id));
        } else if (release.sourceHoldReason && release.sourceHoldReason !== reason) {
          // Already held by the platform: keep the reason current.
          await prisma.release.updateMany({
            where: { id: release.id, status: RELEASE_STATUS_WITHDRAWN, sourceHoldReason: { not: null } },
            data: { sourceHoldReason: reason },
          });
        }
        continue;
      }

      if (release.status !== RELEASE_STATUS_WITHDRAWN || !isRemixSourceHoldReason(release.sourceHoldReason)) {
        continue;
      }
      const restoredTo = (WITHDRAWABLE_RELEASE_STATUSES as readonly string[]).includes(
        release.statusBeforeWithdrawal ?? "",
      )
        ? (release.statusBeforeWithdrawal as string)
        : "ready";
      const restored = await prisma.release.updateMany({
        where: { id: release.id, status: RELEASE_STATUS_WITHDRAWN, sourceHoldReason: { not: null } },
        data: {
          status: restoredTo,
          statusBeforeWithdrawal: null,
          withdrawnAt: null,
          withdrawalReason: null,
          sourceHoldReason: null,
        },
      });
      if (restored.count === 1) {
        changes.push({ ...base, held: false, reason: release.sourceHoldReason });
        next.push(...release.tracks.map((track) => track.id));
      }
    }
    frontier = [...new Set(next)];
  }
  return changes;
}

/**
 * Reconcile and tell the rest of the system (catalogue caches, the remixer's
 * inbox). The one entry point for every trigger.
 */
export async function reconcileAndAnnounceRemixSourceHolds(
  eventBus: Pick<EventBus, "publish"> | null | undefined,
  scope: RemixSourceHoldScope,
): Promise<RemixSourceHoldChange[]> {
  const changes = await reconcileRemixSourceHolds(scope);
  if (eventBus) {
    for (const change of changes) {
      eventBus.publish({
        eventName: "remix.source_hold_changed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        ...change,
      });
    }
  }
  return changes;
}

/** Refusal for a new sale of a stem whose release is on a source hold. */
export const STEM_SOURCE_HOLD_REFUSAL = {
  code: "stem_source_hold",
  error: "Stem not available for purchase",
  message:
    "This remix is on hold because of its original track, so it can't be bought right now. Purchases already made are not affected.",
} as const;
