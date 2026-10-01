import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DJ_ATTRIBUTION_TTL_MS,
  getDiscoveryAttribution,
  getDjAttribution,
  rememberDjAttribution,
} from "./discoveryAttribution";
import { rememberHomeAttribution } from "./homeAttribution";
import { buildPlaybackCompletedPayload, buildPlaybackLifecyclePayload } from "./playbackAnalytics";
import type { LocalTrack } from "./localLibrary";

const track: LocalTrack = {
  id: "track-1",
  catalogTrackId: "catalog-track-1",
  artistId: "artist-1",
  releaseId: "release-1",
  title: "Track",
  artist: "Artist",
  albumArtist: null,
  album: "Release",
  year: null,
  genre: null,
  duration: 120,
  createdAt: "2026-05-23T10:00:00.000Z",
  source: "remote",
};

describe("AI DJ attribution (#2005)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("crypto", { randomUUID: () => "uuid" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the dj surface, variant and experiment for the picked track only", () => {
    rememberDjAttribution("catalog-track-1", { rankerVariant: "candidate", experimentKey: "ranker_v2" });
    expect(getDjAttribution("catalog-track-1")).toEqual({
      surface: "dj",
      rankerVariant: "candidate",
      experimentKey: "ranker_v2",
    });
    expect(getDjAttribution("other-track")).toBeUndefined();
    expect(getDjAttribution(undefined)).toBeUndefined();
  });

  it("keeps a variant-less pick label-only and expires after the TTL", () => {
    const at = 1_000_000;
    rememberDjAttribution("t", {}, at);
    expect(getDjAttribution("t", at + DJ_ATTRIBUTION_TTL_MS - 1)).toEqual({ surface: "dj" });
    expect(getDjAttribution("t", at + DJ_ATTRIBUTION_TTL_MS)).toBeUndefined();
  });

  it("replaces the entry when the same track is picked again and stays bounded", () => {
    rememberDjAttribution("t", { rankerVariant: "baseline" }, 1);
    rememberDjAttribution("t", { rankerVariant: "candidate" }, 2);
    expect(getDjAttribution("t", 3)).toEqual({ surface: "dj", rankerVariant: "candidate" });

    for (let i = 0; i < 30; i += 1) rememberDjAttribution(`bulk-${i}`, {}, 10 + i);
    expect(getDjAttribution("t", 50)).toBeUndefined();
    expect(getDjAttribution("bulk-29", 50)).toEqual({ surface: "dj" });
  });

  it("is a no-op outside the browser", () => {
    vi.unstubAllGlobals();
    expect(() => rememberDjAttribution("t", { rankerVariant: "baseline" })).not.toThrow();
    expect(getDjAttribution("t")).toBeUndefined();
  });

  it("prefers the most recent of a Home rail and a DJ attribution", () => {
    const now = Date.now();
    rememberHomeAttribution("t", { railId: "because_genre", rankerVariant: "baseline" }, now);
    rememberDjAttribution("t", { rankerVariant: "candidate" }, now + 1000);
    expect(getDiscoveryAttribution("t", now + 2000)).toEqual({ surface: "dj", rankerVariant: "candidate" });

    rememberHomeAttribution("t", { railId: "exploration" }, now + 3000);
    expect(getDiscoveryAttribution("t", now + 4000)).toEqual({ railId: "exploration" });
    expect(getDiscoveryAttribution("untracked", now)).toBeUndefined();
  });

  it("forwards surface, variant and experiment on started, skipped and completed payloads", () => {
    rememberDjAttribution("catalog-track-1", { rankerVariant: "candidate", experimentKey: "ranker_v2" });
    const labels = { surface: "dj", rankerVariant: "candidate", experimentKey: "ranker_v2" };

    const completed = buildPlaybackCompletedPayload({
      track,
      currentTimeSeconds: 40,
      durationSeconds: 120,
      sessionId: "s",
    });
    expect(completed).toEqual(expect.objectContaining(labels));
    expect(completed).not.toHaveProperty("railId");

    for (const action of ["started", "skipped"] as const) {
      const lifecycle = buildPlaybackLifecyclePayload({
        action,
        track,
        sessionId: "s",
        playbackInstanceId: "i",
        currentTimeSeconds: 10,
        durationSeconds: 120,
      });
      expect(lifecycle).toEqual(expect.objectContaining({ action, ...labels }));
    }
  });

  it("adds no surface to playback payloads for a track the DJ did not pick", () => {
    const completed = buildPlaybackCompletedPayload({
      track,
      currentTimeSeconds: 40,
      durationSeconds: 120,
      sessionId: "s",
    });
    expect(completed).not.toHaveProperty("surface");
    expect(completed).not.toHaveProperty("rankerVariant");
  });
});
