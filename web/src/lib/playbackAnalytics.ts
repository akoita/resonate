import type { LocalTrack } from "./localLibrary";

export const PLAYBACK_COMPLETED_SECONDS = 30;
export const PLAYBACK_HEARTBEAT_SECONDS = 30;
export const SHORT_TRACK_COMPLETION_RATIO = 0.8;
const SESSION_STORAGE_KEY = "resonate.playback.sessionId";
export type PlaybackLifecycleAction = "started" | "heartbeat";

export type PlaybackCompletedPayload = {
  trackId: string;
  artistId?: string;
  releaseId?: string;
  sessionId: string;
  source: string;
  completionRatio: number;
  durationMs?: number;
};

export type PlaybackLifecyclePayload = {
  action: PlaybackLifecycleAction;
  trackId: string;
  artistId?: string;
  releaseId?: string;
  sessionId: string;
  playbackInstanceId: string;
  source: string;
  positionMs?: number;
  durationMs?: number;
  heartbeatIntervalMs?: number;
  queueIndex?: number;
  queueLength?: number;
  repeatMode?: "none" | "one" | "all";
  shuffle?: boolean;
};

export function getPlaybackAnalyticsSessionId() {
  if (typeof window === "undefined") {
    return "playback_ssr";
  }

  const generated =
    "crypto" in window && "randomUUID" in window.crypto
      ? window.crypto.randomUUID()
      : `playback_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
  } catch {
    return generated;
  }

  return generated;
}

export function createPlaybackAnalyticsInstanceId() {
  if (typeof window !== "undefined" && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `playback_instance_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function shouldReportPlaybackCompleted(input: {
  track: LocalTrack | null;
  currentTimeSeconds: number;
  durationSeconds?: number | null;
  alreadyReported: boolean;
}) {
  if (input.alreadyReported || !input.track) {
    return false;
  }
  if (!getPlaybackAnalyticsTrackId(input.track)) {
    return false;
  }

  const currentTimeSeconds = Math.max(0, input.currentTimeSeconds);
  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : undefined;

  if (!durationSeconds) {
    return currentTimeSeconds >= PLAYBACK_COMPLETED_SECONDS;
  }

  const thresholdSeconds =
    durationSeconds < PLAYBACK_COMPLETED_SECONDS
      ? durationSeconds * SHORT_TRACK_COMPLETION_RATIO
      : PLAYBACK_COMPLETED_SECONDS;
  return currentTimeSeconds >= thresholdSeconds;
}

export function buildPlaybackCompletedPayload(input: {
  track: LocalTrack;
  currentTimeSeconds: number;
  durationSeconds?: number | null;
  sessionId: string;
}): PlaybackCompletedPayload | null {
  const trackId = getPlaybackAnalyticsTrackId(input.track);
  const artistId = input.track.artistId?.trim() || undefined;
  const releaseId = input.track.releaseId?.trim() || undefined;
  if (!trackId) {
    return null;
  }

  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : input.track.duration ?? undefined;
  const boundedCurrentTime = Math.max(0, input.currentTimeSeconds);
  const completionRatio = durationSeconds
    ? Math.min(1, boundedCurrentTime / durationSeconds)
    : boundedCurrentTime >= PLAYBACK_COMPLETED_SECONDS
      ? 1
      : 0;

  return {
    trackId,
    ...(artistId ? { artistId } : {}),
    ...(releaseId ? { releaseId } : {}),
    sessionId: input.sessionId,
    source: input.track.source === "remote" ? "web_player" : "web_player_local",
    completionRatio,
    durationMs: durationSeconds ? Math.round(durationSeconds * 1000) : undefined,
  };
}

export function buildPlaybackLifecyclePayload(input: {
  action: PlaybackLifecycleAction;
  track: LocalTrack;
  sessionId: string;
  playbackInstanceId: string;
  currentTimeSeconds?: number | null;
  durationSeconds?: number | null;
  heartbeatIntervalSeconds?: number;
  queueIndex?: number;
  queueLength?: number;
  repeatMode?: "none" | "one" | "all";
  shuffle?: boolean;
}): PlaybackLifecyclePayload | null {
  const trackId = getPlaybackAnalyticsTrackId(input.track);
  const artistId = input.track.artistId?.trim() || undefined;
  const releaseId = input.track.releaseId?.trim() || undefined;
  if (!trackId) {
    return null;
  }

  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : input.track.duration ?? undefined;
  const currentTimeSeconds =
    typeof input.currentTimeSeconds === "number" && Number.isFinite(input.currentTimeSeconds)
      ? Math.max(0, input.currentTimeSeconds)
      : undefined;

  return {
    action: input.action,
    trackId,
    ...(artistId ? { artistId } : {}),
    ...(releaseId ? { releaseId } : {}),
    sessionId: input.sessionId,
    playbackInstanceId: input.playbackInstanceId,
    source: input.track.source === "remote" ? "web_player" : "web_player_local",
    positionMs: currentTimeSeconds !== undefined ? Math.round(currentTimeSeconds * 1000) : undefined,
    durationMs: durationSeconds ? Math.round(durationSeconds * 1000) : undefined,
    heartbeatIntervalMs: input.heartbeatIntervalSeconds
      ? Math.round(input.heartbeatIntervalSeconds * 1000)
      : undefined,
    queueIndex: input.queueIndex,
    queueLength: input.queueLength,
    repeatMode: input.repeatMode,
    shuffle: input.shuffle,
  };
}

function getPlaybackAnalyticsTrackId(track: LocalTrack) {
  return track.catalogTrackId || (track.source === "remote" ? track.id : undefined);
}
