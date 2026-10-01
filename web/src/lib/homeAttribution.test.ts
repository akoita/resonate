import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHomeAttribution,
  HOME_ATTRIBUTION_TTL_MS,
  rememberHomeAttribution,
} from "./homeAttribution";
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

describe("home rail attribution (#1455)", () => {
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

  it("returns the remembered rail and variant for the clicked track only", () => {
    rememberHomeAttribution("catalog-track-1", { railId: "because_genre", rankerVariant: "candidate" });
    expect(getHomeAttribution("catalog-track-1")).toEqual({
      railId: "because_genre",
      rankerVariant: "candidate",
    });
    expect(getHomeAttribution("other-track")).toBeUndefined();
    expect(getHomeAttribution(undefined)).toBeUndefined();
  });

  it("expires after the TTL and keeps a variant-less attribution label-only", () => {
    const at = 1_000_000;
    rememberHomeAttribution("t", { railId: "exploration" }, at);
    expect(getHomeAttribution("t", at + HOME_ATTRIBUTION_TTL_MS - 1)).toEqual({ railId: "exploration" });
    expect(getHomeAttribution("t", at + HOME_ATTRIBUTION_TTL_MS)).toBeUndefined();
  });

  it("is a no-op outside the browser", () => {
    vi.unstubAllGlobals();
    expect(() => rememberHomeAttribution("t", { railId: "r" })).not.toThrow();
    expect(getHomeAttribution("t")).toBeUndefined();
  });

  it("forwards railId and rankerVariant on playback payloads for an attributed track", () => {
    rememberHomeAttribution("catalog-track-1", { railId: "because_genre", rankerVariant: "baseline" });

    const completed = buildPlaybackCompletedPayload({
      track,
      currentTimeSeconds: 40,
      durationSeconds: 120,
      sessionId: "s",
    });
    expect(completed).toEqual(
      expect.objectContaining({ railId: "because_genre", rankerVariant: "baseline", source: "web_player" }),
    );

    const skipped = buildPlaybackLifecyclePayload({
      action: "skipped",
      track,
      sessionId: "s",
      playbackInstanceId: "i",
      currentTimeSeconds: 10,
      durationSeconds: 120,
      reason: "next_clicked",
    });
    expect(skipped).toEqual(
      expect.objectContaining({ railId: "because_genre", rankerVariant: "baseline", reason: "next_clicked" }),
    );
  });

  it("adds nothing to playback payloads for a track that did not come from a rail", () => {
    const completed = buildPlaybackCompletedPayload({
      track,
      currentTimeSeconds: 40,
      durationSeconds: 120,
      sessionId: "s",
    });
    expect(completed).not.toHaveProperty("railId");
    expect(completed).not.toHaveProperty("rankerVariant");
  });
});
