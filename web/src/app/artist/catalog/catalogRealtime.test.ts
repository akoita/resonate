import { describe, expect, it, vi } from "vitest";
import type { Release, Track } from "../../../lib/api";
import {
  CATALOG_POLL_INTERVAL_MS,
  createCatalogRequestGate,
  hasActiveCatalogProcessing,
  isTerminalReleaseStatus,
  patchReleaseStatus,
  patchTrackStatus,
  startCatalogPolling,
} from "./catalogRealtime";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    releaseId: "release-1",
    title: "Blue Hour",
    position: 1,
    explicit: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    artistId: "artist-1",
    title: "Blue Hour",
    status: "draft",
    type: "EP",
    explicit: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("catalog status updates", () => {
  it("patches a matching release status and processing error only", () => {
    const otherRelease = release({ id: "release-2", status: "published" });
    const releases = [release({ processingError: "old error" }), otherRelease];

    const updated = patchReleaseStatus(releases, {
      releaseId: "release-1",
      status: "failed",
      error: "Audio processing failed.",
    });

    expect(updated[0]).toMatchObject({ status: "failed", processingError: "Audio processing failed." });
    expect(updated[1]).toBe(otherRelease);
    expect(patchReleaseStatus(releases, { releaseId: "missing", status: "ready" })).toBe(releases);
  });

  it("clears a previous release error after a non-failed status update", () => {
    const updated = patchReleaseStatus(
      [release({ status: "failed", processingError: "old error" })],
      { releaseId: "release-1", status: "ready" },
    );

    expect(updated[0]).toMatchObject({ status: "ready", processingError: null });
  });

  it("patches only the matching track under the matching release", () => {
    const unrelated = release({
      id: "release-2",
      tracks: [track({ releaseId: "release-2", processingStatus: "complete" })],
    });
    const releases = [
      release({ tracks: [track({ processingStatus: "pending" })] }),
      unrelated,
    ];

    const updated = patchTrackStatus(releases, {
      releaseId: "release-1",
      trackId: "track-1",
      status: "failed",
      error: "Could not store stems.",
    });

    expect(updated[0].tracks?.[0]).toMatchObject({
      processingStatus: "failed",
      processingError: "Could not store stems.",
    });
    expect(updated[1]).toBe(unrelated);
    expect(patchTrackStatus(releases, {
      releaseId: "missing",
      trackId: "track-1",
      status: "complete",
    })).toBe(releases);
  });

  it("polls active release or track work and treats drafts as stable", () => {
    expect(hasActiveCatalogProcessing([release({ status: "draft" })])).toBe(false);
    expect(hasActiveCatalogProcessing([release({ status: "processing" })])).toBe(true);
    expect(hasActiveCatalogProcessing([
      release({ status: "processing", tracks: [track({ processingStatus: "pending" })] }),
    ])).toBe(true);
    expect(hasActiveCatalogProcessing([
      release({ tracks: [track({ processingStatus: "complete" })] }),
    ])).toBe(false);
  });

  it("does not poll stale pending tracks under draft, failed, blocked, or withdrawn releases", () => {
    const pendingTrack = track({ processingStatus: "pending" });

    expect(hasActiveCatalogProcessing([release({ status: "draft", tracks: [pendingTrack] })])).toBe(false);
    expect(hasActiveCatalogProcessing([release({ status: "failed", tracks: [pendingTrack] })])).toBe(false);
    expect(hasActiveCatalogProcessing([release({ status: "blocked", tracks: [pendingTrack] })])).toBe(false);
    expect(hasActiveCatalogProcessing([release({ status: "withdrawn", tracks: [pendingTrack] })])).toBe(false);
  });

  it("keeps polling active tracks under ready and published releases", () => {
    const pendingTrack = track({ processingStatus: "pending" });

    expect(hasActiveCatalogProcessing([release({ status: "ready", tracks: [pendingTrack] })])).toBe(true);
    expect(hasActiveCatalogProcessing([release({ status: "published", tracks: [pendingTrack] })])).toBe(true);
  });

  it("recognizes terminal release updates without treating a draft as terminal", () => {
    expect(isTerminalReleaseStatus("ready")).toBe(true);
    expect(isTerminalReleaseStatus("failed")).toBe(true);
    expect(isTerminalReleaseStatus("draft")).toBe(false);
    expect(isTerminalReleaseStatus("processing")).toBe(false);
  });
});

describe("catalog refresh lifecycle", () => {
  it("starts one modest polling interval while active and clears it on stop", () => {
    let tick: (() => void) | undefined;
    const timer = 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    const timers = {
      setInterval: vi.fn((callback: () => void, milliseconds: number) => {
        tick = callback;
        expect(milliseconds).toBe(CATALOG_POLL_INTERVAL_MS);
        return timer;
      }),
      clearInterval: vi.fn(),
    };
    const refresh = vi.fn();

    const stop = startCatalogPolling(true, refresh, timers);
    expect(timers.setInterval).toHaveBeenCalledTimes(1);

    tick?.();
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    expect(timers.clearInterval).toHaveBeenCalledWith(timer);
  });

  it("does not start polling when no work is active", () => {
    const timers = {
      setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>),
      clearInterval: vi.fn(),
    };

    const stop = startCatalogPolling(false, vi.fn(), timers);
    stop();

    expect(timers.setInterval).not.toHaveBeenCalled();
    expect(timers.clearInterval).not.toHaveBeenCalled();
  });

  it("swallows a transient refresh failure so the interval can retry", async () => {
    let tick: (() => void) | undefined;
    const timer = 2 as unknown as ReturnType<typeof globalThis.setInterval>;
    const timers = {
      setInterval: vi.fn((callback: () => void) => {
        tick = callback;
        return timer;
      }),
      clearInterval: vi.fn(),
    };
    const refresh = vi.fn().mockRejectedValue(new Error("temporary network error"));
    const stop = startCatalogPolling(true, refresh, timers);

    tick?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.clearInterval).not.toHaveBeenCalled();
    stop();
  });

  it("ignores responses superseded by a newer request or invalidated on cleanup", () => {
    const gate = createCatalogRequestGate();
    const staleRequest = gate.begin();
    const latestRequest = gate.begin();

    expect(gate.isCurrent(staleRequest)).toBe(false);
    expect(gate.isCurrent(latestRequest)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(latestRequest)).toBe(false);
  });

  it("keeps a socket patch when an older catalog response resolves afterward", () => {
    const gate = createCatalogRequestGate();
    const staleRequest = gate.begin();
    let releases = [release({ status: "processing" })];

    releases = patchReleaseStatus(releases, {
      releaseId: "release-1",
      status: "ready",
    });
    gate.invalidate();

    const staleResponse = [release({ status: "processing" })];
    if (gate.isCurrent(staleRequest)) releases = staleResponse;

    expect(releases[0].status).toBe("ready");
  });
});
