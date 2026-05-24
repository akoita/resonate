import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildPlaybackCompletedPayload,
  getPlaybackAnalyticsSessionId,
  shouldReportPlaybackCompleted,
} from "./playbackAnalytics";
import type { LocalTrack } from "./localLibrary";

const track: LocalTrack = {
  id: "track-1",
  catalogTrackId: "catalog-track-1",
  artistId: "artist-1",
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
      sessionId: "session-1",
      source: "web_player",
      completionRatio: 0.25,
      durationMs: 120000,
    });
  });
});
