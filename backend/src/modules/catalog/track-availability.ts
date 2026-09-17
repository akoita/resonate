/**
 * Shared catalog availability read model (#1793).
 *
 * Withdrawal removes a licence to stream, not a purchase. A withdrawn release
 * keeps every row it had: nothing is deleted from anyone's library or playlist.
 * Those surfaces therefore need a way to ask "can this catalog track be played
 * right now, and if not, why?" without dropping the reference.
 *
 * This helper answers that for a batch of catalog track ids in ONE query, so a
 * playlist or library read never degrades into a per-track round trip.
 */
import { prisma } from "../../db/prisma";
import { PUBLIC_RELEASE_ROUTES } from "./catalog-public.constants";

/** Release status used while an artist has withdrawn a release from streaming. */
export const RELEASE_STATUS_WITHDRAWN = "withdrawn";

/** Release statuses a release may be withdrawn from, and restored back to. */
export const WITHDRAWABLE_RELEASE_STATUSES = ["ready", "published"] as const;

/** Stable machine reasons for the `unavailable` state (safe to branch on in UI). */
export type TrackUnavailableReason =
  /** The catalog track (or its release) no longer exists. */
  | "removed"
  /** Taken down after a rights complaint (Track.contentStatus = dmca_removed). */
  | "rights_removed"
  /** Held pending review (Track.contentStatus = quarantined). */
  | "under_review"
  /** The release's rights route does not permit public streaming. */
  | "restricted"
  /** The release is not in a publishable lifecycle state (still processing, failed…). */
  | "not_published"
  /** A device-local library entry: nothing in the catalog backs it. */
  | "local_file";

export type TrackAvailability =
  | { state: "available" }
  | {
      state: "withdrawn";
      /** The artist's own words, when they gave a reason. */
      reason: string | null;
      /**
       * When the artist withdrew it. Null only for a row whose status was set
       * directly (e.g. before this field existed), never through withdrawRelease.
       */
      withdrawnAt: Date | null;
    }
  | { state: "unavailable"; reason: TrackUnavailableReason };

export const AVAILABLE: TrackAvailability = { state: "available" };
export const LOCAL_FILE_AVAILABILITY: TrackAvailability = {
  state: "unavailable",
  reason: "local_file",
};
export const REMOVED_AVAILABILITY: TrackAvailability = {
  state: "unavailable",
  reason: "removed",
};

export function isPlayableAvailability(availability: TrackAvailability): boolean {
  return availability.state === "available";
}

type AvailabilityTrackRow = {
  id: string;
  contentStatus: string;
  rightsRoute: string | null;
  release: {
    status: string;
    rightsRoute: string | null;
    withdrawnAt: Date | null;
    withdrawalReason: string | null;
  } | null;
};

/** Classify one already-loaded track row. Exported for callers that batch their own query. */
export function classifyTrackAvailability(track: AvailabilityTrackRow): TrackAvailability {
  const release = track.release;
  if (!release) return REMOVED_AVAILABILITY;

  if (release.status === RELEASE_STATUS_WITHDRAWN) {
    return {
      state: "withdrawn",
      reason: release.withdrawalReason ?? null,
      withdrawnAt: release.withdrawnAt ?? null,
    };
  }
  if (track.contentStatus === "dmca_removed") {
    return { state: "unavailable", reason: "rights_removed" };
  }
  if (track.contentStatus === "quarantined") {
    return { state: "unavailable", reason: "under_review" };
  }
  if (!(WITHDRAWABLE_RELEASE_STATUSES as readonly string[]).includes(release.status)) {
    return { state: "unavailable", reason: "not_published" };
  }
  for (const route of [track.rightsRoute, release.rightsRoute]) {
    if (route && !PUBLIC_RELEASE_ROUTES.includes(route)) {
      return { state: "unavailable", reason: "restricted" };
    }
  }
  return AVAILABLE;
}

/**
 * Resolve availability for a batch of catalog track ids.
 *
 * Ids that match no catalog track are reported as `unavailable: "removed"` —
 * the caller decides whether that is a client bug (writes) or a reference to
 * keep and mark (reads).
 */
export async function resolveTrackAvailability(
  trackIds: Iterable<string>,
): Promise<Map<string, TrackAvailability>> {
  const ids = Array.from(new Set(Array.from(trackIds).filter(Boolean)));
  const byId = new Map<string, TrackAvailability>();
  if (ids.length === 0) return byId;

  const tracks = await prisma.track.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      contentStatus: true,
      rightsRoute: true,
      release: {
        select: {
          status: true,
          rightsRoute: true,
          withdrawnAt: true,
          withdrawalReason: true,
        },
      },
    },
  });

  for (const track of tracks) {
    byId.set(track.id, classifyTrackAvailability(track));
  }
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, REMOVED_AVAILABILITY);
  }
  return byId;
}
