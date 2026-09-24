import { describe, expect, it } from "vitest";
import {
  clampSeek,
  draftLoopSeekTarget,
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
});
