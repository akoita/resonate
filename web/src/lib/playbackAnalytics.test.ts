import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildPlaybackCompletedPayload,
  buildPlaybackLifecyclePayload,
  createPlaybackAnalyticsInstanceId,
  getPlaybackLocalContext,
  getPlaybackDjSessionId,
  getPlaybackPlaylistId,
  getPlaybackAnalyticsSessionId,
  PLAYBACK_HEARTBEAT_SECONDS,
  PLAYED_THROUGH_RATIO,
  shouldReportPlaybackCompleted,
  shouldReportPlayedThrough,
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

  it("associates actual playback with the active DJ set without marking it agent-originated", () => {
    const set = { sessionId: "dj-session", trackIds: ["catalog-track-1"] };
    const common = { track, agentSessionId: getPlaybackDjSessionId("catalog-track-1", set), sessionId: "browser-session", playbackInstanceId: "instance", currentTimeSeconds: 30 };
    const started = buildPlaybackLifecyclePayload({ ...common, action: "started" });
    const completed = buildPlaybackCompletedPayload(common);
    expect(started?.agentSessionId).toBe("dj-session");
    expect(completed?.agentSessionId).toBe("dj-session");
    expect(started).not.toHaveProperty("agentOriginated");
    expect(getPlaybackDjSessionId("other", set)).toBeUndefined();
    expect(buildPlaybackCompletedPayload({ ...common, agentSessionId: getPlaybackDjSessionId("catalog-track-1", null) })).not.toHaveProperty("agentSessionId");
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

  it("reports played-through once at 90 percent of a track with a known duration (#2097)", () => {
    expect(PLAYED_THROUGH_RATIO).toBe(0.9);
    const input = { track, durationSeconds: 120, alreadyReported: false };
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 30 })).toBe(false);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 107.9 })).toBe(false);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 108 })).toBe(true);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 120 })).toBe(true);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 108, alreadyReported: true })).toBe(false);
  });

  it("does not report played-through without a usable duration, position or catalog track (#2097)", () => {
    const base = { track, currentTimeSeconds: 100, alreadyReported: false };
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: undefined })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: null })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: 0 })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: Number.NaN })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: Number.POSITIVE_INFINITY, currentTimeSeconds: 1e9 })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: 100, currentTimeSeconds: Number.NaN })).toBe(false);
    expect(shouldReportPlayedThrough({ ...base, durationSeconds: 100, track: null })).toBe(false);
    expect(
      shouldReportPlayedThrough({
        ...base,
        durationSeconds: 100,
        track: { ...track, catalogTrackId: undefined, source: "local" },
      }),
    ).toBe(false);
  });

  it("reports played-through for a short track independently of the 30 second play (#2097)", () => {
    const short = { ...track, duration: 20 };
    const input = { track: short, durationSeconds: 20, alreadyReported: false };
    // The 80 percent short-track play has counted, but 90 percent is not reached yet.
    expect(shouldReportPlaybackCompleted({ ...input, currentTimeSeconds: 16 })).toBe(true);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 16 })).toBe(false);
    expect(shouldReportPlayedThrough({ ...input, currentTimeSeconds: 18 })).toBe(true);
  });

  it("builds a played-through lifecycle payload carrying position and duration (#2097)", () => {
    const payload = buildPlaybackLifecyclePayload({
      action: "played_through",
      track,
      sessionId: "browser-session",
      playbackInstanceId: "instance",
      currentTimeSeconds: 110.4,
      durationSeconds: 120,
    });
    expect(payload).toMatchObject({
      action: "played_through",
      trackId: "catalog-track-1",
      playbackInstanceId: "instance",
      positionMs: 110400,
      durationMs: 120000,
    });
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
    const now = new Date(2026, 0, 7, 10);

    expect(
      buildPlaybackCompletedPayload({
        track,
        currentTimeSeconds: 130,
        durationSeconds: 120,
        sessionId,
        now,
      }),
    ).toEqual({
      trackId: "catalog-track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      sessionId: "session-uuid",
      source: "web_player",
      completionRatio: 1,
      durationMs: 120000,
      localHourBucket: "morning",
      weekdayKind: "weekday",
    });
  });

  it("builds payloads without artist id when only catalog track identity is available", () => {
    expect(
      buildPlaybackCompletedPayload({
        track: { ...track, artistId: null },
        currentTimeSeconds: 30,
        durationSeconds: 120,
        sessionId: "session-1",
        now: new Date(2026, 0, 7, 10),
      }),
    ).toEqual({
      trackId: "catalog-track-1",
      releaseId: "release-1",
      sessionId: "session-1",
      source: "web_player",
      completionRatio: 0.25,
      durationMs: 120000,
      localHourBucket: "morning",
      weekdayKind: "weekday",
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
        playlistId: "playlist-1",
        now: new Date(2026, 0, 3, 18),
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
      playlistId: "playlist-1",
      localHourBucket: "evening",
      weekdayKind: "weekend",
    });
  });

  it.each([
    [0, 0, "night"],
    [5, 59, "night"],
    [6, 0, "morning"],
    [11, 59, "morning"],
    [12, 0, "afternoon"],
    [17, 59, "afternoon"],
    [18, 0, "evening"],
    [23, 59, "evening"],
  ] as const)("buckets local hour %s:%s", (hour, minute, expected) => {
    expect(getPlaybackLocalContext(new Date(2026, 0, 7, hour, minute)).localHourBucket).toBe(expected);
  });

  it("classifies weekdays and weekends using the local calendar day", () => {
    expect(getPlaybackLocalContext(new Date(2026, 0, 3, 12)).weekdayKind).toBe("weekend");
    expect(getPlaybackLocalContext(new Date(2026, 0, 5, 12)).weekdayKind).toBe("weekday");
  });

  it("propagates coarse local context and playback provenance without a clock or timezone", () => {
    const now = new Date(2026, 0, 3, 5, 59);
    const playlistSource = { playlistId: "playlist-1", trackIds: [track.id] };
    const appendedTrack = { ...track, id: "appended-track" };
    const context = { localHourBucket: "night", weekdayKind: "weekend" };
    const completed = buildPlaybackCompletedPayload({
      track,
      currentTimeSeconds: 40,
      durationSeconds: 120,
      sessionId: "session-1",
      playbackInstanceId: "instance-1",
      repeatMode: "all",
      playlistId: getPlaybackPlaylistId(track, playlistSource),
      now,
    });
    const lifecycle = buildPlaybackLifecyclePayload({
      action: "started",
      track,
      sessionId: "session-1",
      playbackInstanceId: "instance-1",
      repeatMode: "all",
      playlistId: getPlaybackPlaylistId(track, playlistSource),
      now,
    });

    expect(completed).toEqual(expect.objectContaining({
      ...context,
      playbackInstanceId: "instance-1",
      repeatMode: "all",
      playlistId: "playlist-1",
    }));
    expect(lifecycle).toEqual(expect.objectContaining({
      ...context,
      playbackInstanceId: "instance-1",
      repeatMode: "all",
      playlistId: "playlist-1",
    }));
    expect(getPlaybackPlaylistId(appendedTrack, playlistSource)).toBeUndefined();

    for (const payload of [completed, lifecycle]) {
      expect(payload).not.toHaveProperty("localTime");
      expect(payload).not.toHaveProperty("timeZone");
      expect(payload).not.toHaveProperty("timezone");
      expect(JSON.stringify(payload)).not.toContain(now.toISOString());
    }
  });

  it("does not attribute an ad hoc track to a playlist", () => {
    expect(getPlaybackPlaylistId(track, null)).toBeUndefined();
  });
});
