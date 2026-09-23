import type { AudioReplacementStatus, Track } from "./api";

export function withAudioRevision(url: string | undefined, audioRevision?: string | null) {
  if (!url || !audioRevision) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}audioRevision=${encodeURIComponent(audioRevision)}`;
}

export function safeAudioReplacementFailureMessage(error?: string | null) {
  const normalized = error?.toLowerCase() ?? "";
  if (/too large|exceeds.{0,20}100 ?mib|file size/.test(normalized)) {
    return "The file is too large. Choose an audio file up to 100 MiB.";
  }
  if (/unsupported|format|extension/.test(normalized)) {
    return "The replacement format could not be processed. Choose MP3, WAV, FLAC, AIFF, M4A, AAC, or OGG.";
  }
  if (/publication|published|not ready|no longer ready/.test(normalized)) {
    return "Audio can only be replaced while the release is ready and unpublished.";
  }
  return "The replacement could not be processed. The existing audio remains active. You can try again.";
}

export const isAudioReplacementActive = (status?: AudioReplacementStatus | null) =>
  status != null && status !== "complete" && status !== "failed";

export function classifyAudioReplacementTrack(
  track?: Pick<Track, "audioReplacementStatus" | "activeAudioRevision" | "audioReplacementError">,
) {
  if (!track) return { state: "unknown" as const };
  if (isAudioReplacementActive(track.audioReplacementStatus)) return { state: "processing" as const };
  if (track.audioReplacementStatus === "complete" && track.activeAudioRevision) {
    return { state: "complete" as const, audioRevision: track.activeAudioRevision };
  }
  if (track.audioReplacementStatus === "failed") {
    return { state: "failed" as const, message: safeAudioReplacementFailureMessage(track.audioReplacementError) };
  }
  return { state: "unknown" as const };
}
