import { describe, expect, it, vi } from "vitest";
import {
  dropStaleCurrentDraftKeys,
  clampSeek,
  draftLoopSeekTarget,
  engineEffects,
  enginePreviewStems,
  loopForTimeline,
  BEAT_PEAKS_DEBOUNCE_MS,
  previewBeatKey,
  previewSectionsKey,
  scheduleBeatPeaks,
  resolveDraftCacheKey,
  structureTimelineFor,
  structureTimelineKey,
  transportDurationSec,
} from "./useRemixTransport";
import { structureTimeline } from "../../lib/remixStructure";
import { defaultBeat } from "../../lib/remixBeat";

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

describe("structure timeline in the transport (#1899)", () => {
  const grid = {
    sections: [
      { startSec: 0, endSec: 6 },
      { startSec: 6, endSec: 22 },
      { startSec: 22, endSec: 38 },
    ],
  };
  const identity = structureTimeline(grid, null);
  const reordered = structureTimeline(grid, [
    { section: 2 },
    { section: 1 },
    { section: 1, fadeOut: true },
  ]);

  it("plays only non-identity timelines", () => {
    expect(structureTimelineFor(null)).toBeNull();
    expect(structureTimelineFor(undefined)).toBeNull();
    expect(structureTimelineFor(identity)).toBeNull();
    expect(structureTimelineFor(reordered)).toBe(reordered);
  });

  it("uses the timeline duration for engine sources, never for drafts", () => {
    const base = {
      bufferDurationSec: 38.2,
      timelineSec: 38,
      draftDurationSec: 48.5,
      structureSec: reordered.durationSec,
    };
    expect(reordered.durationSec).toBe(48);
    expect(transportDurationSec({ ...base, source: { kind: "arrangement" } })).toBe(48);
    expect(transportDurationSec({ ...base, source: { kind: "original" } })).toBe(48);
    expect(
      transportDurationSec({ ...base, source: { kind: "draft", jobId: null } }),
    ).toBe(48.5);
    expect(
      transportDurationSec({
        ...base,
        structureSec: null,
        source: { kind: "arrangement" },
      }),
    ).toBe(38.2);
  });

  it("keys timelines by content", () => {
    expect(structureTimelineKey(null)).toBe("");
    expect(structureTimelineKey(reordered)).toBe(
      structureTimelineKey(
        structureTimeline(grid, [
          { section: 2 },
          { section: 1 },
          { section: 1, fadeOut: true },
        ]),
      ),
    );
    expect(structureTimelineKey(reordered)).not.toBe(
      structureTimelineKey(
        structureTimeline(grid, [{ section: 2 }, { section: 1 }, { section: 1 }]),
      ),
    );
  });

  it("re-reads a block loop from the new timeline by block index", () => {
    const loop = { sectionIndex: 1, startSec: 6, endSec: 22 };
    expect(loopForTimeline(loop, reordered.segments)).toEqual({
      sectionIndex: 1,
      startSec: 16,
      endSec: 32,
    });
    expect(loopForTimeline(loop, identity.segments)).toEqual(loop);
    expect(
      loopForTimeline({ ...loop, sectionIndex: 3 }, reordered.segments),
    ).toBeNull();
    expect(loopForTimeline(loop, null)).toBeNull();
    expect(loopForTimeline(null, reordered.segments)).toBeNull();
  });
});

describe("previewBeatKey (#1902)", () => {
  const grid = {
    bpm: 120,
    sectionSeconds: 16,
    sections: [{ startSec: 0, endSec: 16 }],
  };
  const segments = [{ section: 0, outStartSec: 0, outEndSec: 16 }];
  const beat = (overrides = {}) => ({
    recipe: { ...defaultBeat("trap"), ...overrides },
    grid,
    segments,
  });

  it("changes with the sound, not with level or mute", () => {
    expect(previewBeatKey(null)).toBe("");
    expect(previewBeatKey(undefined)).toBe("");
    const key = previewBeatKey(beat());
    expect(key).not.toBe("");
    expect(previewBeatKey(beat({ gainDb: -9, muted: true }))).toBe(key);
    expect(previewBeatKey(beat({ kit: "808" }))).not.toBe(key);
    expect(previewBeatKey(beat({ swing: 0.4 }))).not.toBe(key);
    expect(
      previewBeatKey({ ...beat(), segments: [{ ...segments[0], outEndSec: 8 }] }),
    ).not.toBe(key);
  });
});

describe("scheduleBeatPeaks (#1902)", () => {
  const beat = {
    recipe: defaultBeat("trap"),
    grid: { bpm: 120, sectionSeconds: 1, sections: [{ startSec: 0, endSec: 1 }] },
    segments: [{ section: 0, outStartSec: 0, outEndSec: 1 }],
  };
  // 1 s of timeline at 10 Hz plus 5 samples of ring-out padding.
  const data = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1, 1, 1, 1]);
  const buffer = {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: 10,
    getChannelData: () => data,
  };

  it("builds once after the quiet time; a newer edit cancels the pending one", () => {
    vi.useFakeTimers();
    try {
      const build = vi.fn(() => buffer);
      const onPeaks = vi.fn();
      const cancelFirst = scheduleBeatPeaks({ beat, key: "a", build, onPeaks });
      vi.advanceTimersByTime(BEAT_PEAKS_DEBOUNCE_MS - 1);
      cancelFirst(); // the next step toggle
      scheduleBeatPeaks({ beat, key: "b", build, onPeaks });
      vi.advanceTimersByTime(BEAT_PEAKS_DEBOUNCE_MS - 1);
      expect(build).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(build).toHaveBeenCalledTimes(1);
      expect(onPeaks).toHaveBeenCalledTimes(1);
      const [key, peaks] = onPeaks.mock.calls[0];
      expect(key).toBe("b");
      // Peaks cover the timeline only (10 samples), not the padding.
      expect(Math.max(...peaks)).toBeCloseTo(1);
      expect(peaks[0]).toBeCloseTo(0.1);
      expect(peaks[peaks.length - 1]).toBeCloseTo(1);
      expect(peaks[Math.floor(peaks.length / 2) - 1]).toBeCloseTo(0.5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports nothing when no buffer can be built", () => {
    vi.useFakeTimers();
    try {
      const onPeaks = vi.fn();
      scheduleBeatPeaks({ beat, key: "a", build: () => null, onPeaks, delayMs: 10 });
      vi.advanceTimersByTime(10);
      expect(onPeaks).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
