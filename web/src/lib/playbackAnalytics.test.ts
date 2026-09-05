import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildPlaybackCompletedPayload,
  buildPlaybackLifecyclePayload,
  createPlaybackAnalyticsInstanceId,
  getPlaybackAnalyticsSessionId,
  PLAYBACK_HEARTBEAT_SECONDS,
  shouldReportPlaybackCompleted,
} from "./playbackAnalytics";
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

describe("playback analytics helpers", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      clear: vi.fn(() => store.clear()),
    };
    const cryptoMock = { randomUUID: vi.fn(() => "session-uuid") };
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    vi.stubGlobal("crypto", cryptoMock);
    vi.stubGlobal("window", { sessionStorage: sessionStorageMock, crypto: cryptoMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses secure random bytes when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: bytes.length }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal("window", { sessionStorage, crypto: { getRandomValues } });
    const weakRandom = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Weak randomness must not generate playback IDs");
    });

    const sessionId = getPlaybackAnalyticsSessionId();
    expect(sessionId).toBe("playback_000102030405060708090a0b0c0d0e0f");
    expect(getPlaybackAnalyticsSessionId()).toBe(sessionId);
    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
    expect(createPlaybackAnalyticsInstanceId()).toBe(
      "playback_instance_000102030405060708090a0b0c0d0e0f",
    );
    expect(getRandomValues).toHaveBeenCalled();
    expect(weakRandom).not.toHaveBeenCalled();
  });

  it.each(["getItem", "setItem"] as const)("generates a secure session ID when storage %s throws", (method) => {
    vi.spyOn(sessionStorage, method).mockImplementation(() => {
      throw new Error("Storage denied");
    });
    expect(getPlaybackAnalyticsSessionId()).toBe("session-uuid");
  });

  it("preserves the SSR session sentinel and uses runtime crypto for instance IDs", () => {
    vi.stubGlobal("window", undefined);
    expect(getPlaybackAnalyticsSessionId()).toBe("playback_ssr");
    expect(createPlaybackAnalyticsInstanceId()).toBe("session-uuid");
  });

  it("qualifies long tracks after 30 seconds once per track load", () => {
    expect(
      shouldReportPlaybackCompleted({
        track,
        currentTimeSeconds: 29,
        durationSeconds: 120,
        alreadyReported: false,
      }),
    ).toBe(false);
    expect(
      shouldReportPlaybackCompleted({
        track,
        currentTimeSeconds: 30,
        durationSeconds: 120,
        alreadyReported: false,
      }),
    ).toBe(true);
    expect(
      shouldReportPlaybackCompleted({
        track,
        currentTimeSeconds: 60,
        durationSeconds: 120,
        alreadyReported: true,
      }),
    ).toBe(false);
  });

  it("qualifies short tracks after 80 percent completion", () => {
    expect(
      shouldReportPlaybackCompleted({
        track: { ...track, duration: 20 },
        currentTimeSeconds: 15,
        durationSeconds: 20,
        alreadyReported: false,
      }),
    ).toBe(false);
    expect(
      shouldReportPlaybackCompleted({
        track: { ...track, duration: 20 },
        currentTimeSeconds: 16,
        durationSeconds: 20,
        alreadyReported: false,
      }),
    ).toBe(true);
  });

  it("does not qualify local-only tracks", () => {
    expect(
      shouldReportPlaybackCompleted({
        track: { ...track, source: "local", catalogTrackId: null },
        currentTimeSeconds: 45,
        durationSeconds: 120,
        alreadyReported: false,
      }),
    ).toBe(false);
  });

  it("qualifies artistless remote tracks so the backend can resolve catalog ownership", () => {
    expect(
      shouldReportPlaybackCompleted({
        track: { ...track, artistId: null },
        currentTimeSeconds: 45,
        durationSeconds: 120,
        alreadyReported: false,
      }),
    ).toBe(true);
  });

  it("builds the analytics payload with stable session id and bounded ratio", () => {
    const sessionId = getPlaybackAnalyticsSessionId();
    expect(sessionId).toBe("session-uuid");
    expect(getPlaybackAnalyticsSessionId()).toBe("session-uuid");

    expect(
      buildPlaybackCompletedPayload({
        track,
        currentTimeSeconds: 130,
        durationSeconds: 120,
        sessionId,
      }),
    ).toEqual({
      trackId: "catalog-track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      sessionId: "session-uuid",
      source: "web_player",
      completionRatio: 1,
      durationMs: 120000,
    });
  });

  it("builds payloads without artist id when only catalog track identity is available", () => {
    expect(
      buildPlaybackCompletedPayload({
        track: { ...track, artistId: null },
        currentTimeSeconds: 30,
        durationSeconds: 120,
        sessionId: "session-1",
      }),
    ).toEqual({
      trackId: "catalog-track-1",
      releaseId: "release-1",
      sessionId: "session-1",
      source: "web_player",
      completionRatio: 0.25,
      durationMs: 120000,
    });
  });

  it("builds playback lifecycle payloads for future listener analytics", () => {
    expect(createPlaybackAnalyticsInstanceId()).toBe("session-uuid");

    expect(
      buildPlaybackLifecyclePayload({
        action: "heartbeat",
        track,
        sessionId: "session-1",
        playbackInstanceId: "instance-1",
        currentTimeSeconds: 30.2,
        durationSeconds: 120,
        heartbeatIntervalSeconds: PLAYBACK_HEARTBEAT_SECONDS,
        queueIndex: 1,
        queueLength: 4,
        repeatMode: "all",
        shuffle: true,
      }),
    ).toEqual({
      action: "heartbeat",
      trackId: "catalog-track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      sessionId: "session-1",
      playbackInstanceId: "instance-1",
      source: "web_player",
      positionMs: 30200,
      durationMs: 120000,
      heartbeatIntervalMs: 30000,
      queueIndex: 1,
      queueLength: 4,
      repeatMode: "all",
      shuffle: true,
    });
  });
});
