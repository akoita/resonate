import { describe, expect, it } from "vitest";

import {
  classifyAudioReplacementTrack,
  safeAudioReplacementFailureMessage,
  withAudioRevision,
} from "./audioReplacement";

describe("track audio replacement page helpers", () => {
  it("qualifies playback URLs by active revision so replay cannot reuse the previous stream cache", () => {
    const streamUrl = "https://api.resonate.test/catalog/releases/r1/tracks/t1/stream";

    expect(withAudioRevision(streamUrl, "revision 2")).toBe(`${streamUrl}?audioRevision=revision%202`);
    expect(withAudioRevision(`${streamUrl}?range=1`, "revision-3")).toBe(
      `${streamUrl}?range=1&audioRevision=revision-3`,
    );
    expect(withAudioRevision(streamUrl, null)).toBe(streamUrl);
  });

  it("reconciles an ambiguous upload response against active, completed, and failed track state", () => {
    expect(classifyAudioReplacementTrack({ audioReplacementStatus: "separating" })).toEqual({ state: "processing" });
    expect(classifyAudioReplacementTrack({
      audioReplacementStatus: "complete",
      activeAudioRevision: "revision-4",
    })).toEqual({ state: "complete", audioRevision: "revision-4" });
    const failedTrack = classifyAudioReplacementTrack({
      audioReplacementStatus: "failed",
      audioReplacementError: "worker crashed at /srv/internal/worker.js",
    });
    expect(failedTrack).toEqual({
      state: "failed",
      message: "The replacement could not be processed. The existing audio remains active. You can try again.",
    });
    expect(JSON.stringify(failedTrack)).not.toContain("/srv/internal");
    expect(classifyAudioReplacementTrack({ audioReplacementStatus: null })).toEqual({ state: "unknown" });
  });

  it("maps persisted worker errors to safe, useful guidance instead of exposing raw details", () => {
    expect(safeAudioReplacementFailureMessage("File exceeds 100 MiB limit")).toContain("up to 100 MiB");
    expect(safeAudioReplacementFailureMessage("Unsupported extension: .mkv")).toContain("Choose MP3, WAV");
    expect(safeAudioReplacementFailureMessage("worker crashed at /srv/internal/worker.js")).not.toContain("/srv/internal");
  });
});
