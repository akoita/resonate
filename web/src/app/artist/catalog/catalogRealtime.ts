import type { Release } from "../../../lib/api";
import type { ReleaseStatusUpdate, TrackStatusUpdate } from "../../../hooks/useWebSockets";

const ACTIVE_RELEASE_STATUSES = new Set(["processing"]);
const ACTIVE_TRACK_STATUSES = new Set(["pending", "separating", "encrypting", "storing"]);
const TERMINAL_RELEASE_STATUSES = new Set([
  "ready",
  "published",
  "complete",
  "failed",
  "blocked",
  "withdrawn",
]);
const INACTIVE_TRACK_RELEASE_STATUSES = new Set(["draft", "failed", "blocked", "withdrawn"]);

export const CATALOG_POLL_INTERVAL_MS = 15_000;

function normalizeStatus(status?: string | null) {
  return status?.toLowerCase() ?? "";
}

export function patchReleaseStatus(
  releases: Release[],
  update: Pick<ReleaseStatusUpdate, "releaseId" | "status" | "error">,
): Release[] {
  let matched = false;
  const next = releases.map((release) => {
    if (release.id !== update.releaseId) return release;

    matched = true;
    return {
      ...release,
      status: update.status,
      processingError:
        normalizeStatus(update.status) === "failed"
          ? update.error || release.processingError || "Processing failed."
          : null,
    };
  });

  return matched ? next : releases;
}

export function patchTrackStatus(
  releases: Release[],
  update: Pick<TrackStatusUpdate, "releaseId" | "trackId" | "status" | "error">,
): Release[] {
  let matched = false;
  const next = releases.map((release) => {
    if (release.id !== update.releaseId || !release.tracks?.some((track) => track.id === update.trackId)) {
      return release;
    }

    matched = true;
    return {
      ...release,
      tracks: release.tracks.map((track) =>
        track.id === update.trackId
          ? {
              ...track,
              processingStatus: update.status,
              processingError:
                normalizeStatus(update.status) === "failed"
                  ? update.error || track.processingError || "Processing failed."
                  : null,
            }
          : track,
      ),
    };
  });

  return matched ? next : releases;
}

export function hasActiveCatalogProcessing(releases: Release[]) {
  return releases.some((release) => {
    const status = normalizeStatus(release.status);
    if (ACTIVE_RELEASE_STATUSES.has(status)) return true;
    if (INACTIVE_TRACK_RELEASE_STATUSES.has(status)) return false;
    return release.tracks?.some((track) => ACTIVE_TRACK_STATUSES.has(normalizeStatus(track.processingStatus))) === true;
  });
}

export function isTerminalReleaseStatus(status?: string | null) {
  return TERMINAL_RELEASE_STATUSES.has(normalizeStatus(status));
}

export type CatalogRequestGate = {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
  invalidate: () => void;
};

export function createCatalogRequestGate(): CatalogRequestGate {
  let latestRequestId = 0;

  return {
    begin: () => ++latestRequestId,
    isCurrent: (requestId) => requestId === latestRequestId,
    invalidate: () => {
      latestRequestId += 1;
    },
  };
}

type CatalogTimerApi = {
  setInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval: (timer: ReturnType<typeof globalThis.setInterval>) => void;
};

const browserTimerApi: CatalogTimerApi = {
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: (timer) => globalThis.clearInterval(timer),
};

export function startCatalogPolling(
  active: boolean,
  refresh: () => void | Promise<void>,
  timers: CatalogTimerApi = browserTimerApi,
) {
  if (!active) return () => undefined;

  const timer = timers.setInterval(() => {
    try {
      void Promise.resolve(refresh()).catch(() => undefined);
    } catch {
      // Polling is best effort; the next interval or focus refresh can retry.
    }
  }, CATALOG_POLL_INTERVAL_MS);

  return () => timers.clearInterval(timer);
}
