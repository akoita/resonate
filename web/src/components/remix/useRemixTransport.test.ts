import { describe, expect, it } from "vitest";
import {
  dropStaleCurrentDraftKeys,
  clampSeek,
  draftLoopSeekTarget,
  engineEffects,
  enginePreviewStems,
  previewSectionsKey,
  resolveDraftCacheKey,
  transportDurationSec,
} from "./useRemixTransport";

describe("useRemixTransport helpers (#1879)", () => {
  it("keys draft audio by archived job or by the current generation", () => {
    expect(resolveDraftCacheKey("job-2", "job-9")).toBe("job:job-2");
    expect(resolveDraftCacheKey(null, "job-9")).toBe("current:job-9");
    expect(resolveDraftCacheKey(null, null)).toBeNull();
    // A new generation yields a new key, so the old draft is never replayed.
    expect(resolveDraftCacheKey(null, "job-10")).not.toBe(
      resolveDraftCacheKey(null, "job-9"),
    );
  });

  it("clamps seeks onto the timeline", () => {
    expect(clampSeek(-3, 60)).toBe(0);
    expect(clampSeek(Number.NaN, 60)).toBe(0);
    expect(clampSeek(30, 60)).toBe(30);
    expect(clampSeek(90, 60)).toBe(60);
    expect(clampSeek(90, null)).toBe(90);
    expect(clampSeek(90, Number.NaN)).toBe(90);
  });

  it("sends a looping draft back to the loop start at the loop end", () => {
    const loop = { startSec: 16, endSec: 32 };
    expect(draftLoopSeekTarget(20, loop)).toBeNull();
    expect(draftLoopSeekTarget(32, loop)).toBe(16);
    expect(draftLoopSeekTarget(40, loop)).toBe(16);
    expect(draftLoopSeekTarget(40, null)).toBeNull();
    expect(draftLoopSeekTarget(40, { startSec: 8, endSec: 8 })).toBeNull();
  });

  it("uses decoded stems, then the grid, and the draft's own duration", () => {
    const base = { bufferDurationSec: null, timelineSec: 64, draftDurationSec: 58 };
    expect(transportDurationSec({ ...base, source: { kind: "arrangement" } })).toBe(64);
    expect(
      transportDurationSec({
        ...base,
        bufferDurationSec: 63.5,
        source: { kind: "original" },
      }),
    ).toBe(63.5);
    expect(
      transportDurationSec({ ...base, source: { kind: "draft", jobId: null } }),
    ).toBe(58);
    expect(
      transportDurationSec({
        ...base,
        draftDurationSec: null,
        source: { kind: "draft", jobId: "job-1" },
      }),
    ).toBeNull();
  });

  it("changes the sections key only when spans change", () => {
    const stems = [
      { stemId: "a", gainDb: 0, muted: false, activeIntervals: [{ startSec: 0, endSec: 16 }] },
      { stemId: "b", gainDb: 0, muted: false },
    ];
    const key = previewSectionsKey(stems);
    // Gain/mute edits don't touch the envelope.
    expect(
      previewSectionsKey([{ ...stems[0], gainDb: -6, muted: true }, stems[1]]),
    ).toBe(key);
    expect(
      previewSectionsKey([
        { ...stems[0], activeIntervals: [{ startSec: 0, endSec: 32 }] },
        stems[1],
      ]),
    ).not.toBe(key);
    expect(
      previewSectionsKey([stems[0], { ...stems[1], activeIntervals: [] }]),
    ).not.toBe(key);
  });

  it("plays the reference ungated only on the Original source", () => {
    const gated = [{ startSec: 0, endSec: 8 }];
    const stems = [
      { stemId: "orig", gainDb: 0, muted: false, activeIntervals: gated },
      { stemId: "vox", gainDb: 0, muted: false, activeIntervals: gated },
    ];
    const original = enginePreviewStems(stems, { kind: "original" }, "orig");
    expect(original[0].activeIntervals).toBeUndefined();
    expect(original[1].activeIntervals).toBe(gated);
    // The arrangement keeps the render's gating on every stem.
    expect(enginePreviewStems(stems, { kind: "arrangement" }, "orig")).toBe(
      stems,
    );
    expect(enginePreviewStems(stems, { kind: "original" }, null)).toBe(stems);
  });
});

describe("dropStaleCurrentDraftKeys (#1879)", () => {
  const peaks = {
    "current:job-1": [0.5],
    "job:job-0": [0.25],
  };

  it("keeps the current draft and archived versions untouched", () => {
    expect(dropStaleCurrentDraftKeys(peaks, "job-1")).toBe(peaks);
  });

  it("drops the previous current draft when a new generation lands", () => {
    const next = dropStaleCurrentDraftKeys(peaks, "job-2");
    expect(next).toEqual({ "job:job-0": [0.25] });
    expect(peaks).toHaveProperty("current:job-1"); // input not mutated
  });

  it("drops every current-draft entry when no draft is playable", () => {
    expect(dropStaleCurrentDraftKeys(peaks, null)).toEqual({
      "job:job-0": [0.25],
    });
  });
});

describe("engineEffects (#1897)", () => {
  const effects = {
    schemaVersion: "remix-fx/v1" as const,
    master: { speed: 0.85 },
  };
  it("applies effects to the arrangement, never to the original", () => {
    expect(engineEffects(effects, { kind: "arrangement" })).toBe(effects);
    expect(engineEffects(effects, { kind: "original" })).toBeNull();
    expect(engineEffects(undefined, { kind: "arrangement" })).toBeNull();
  });
});
