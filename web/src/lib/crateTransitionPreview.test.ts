import { describe, expect, it } from "vitest";
import {
  CROSSFADE_BEATS,
  equalPowerCurves,
  FALLBACK_CROSSFADE_SEC,
  planCrossfade,
  tempoMatchRate,
} from "./crateTransitionPreview";

describe("planCrossfade", () => {
  it("makes the crossfade a whole number of beats at the outgoing tempo", () => {
    const plan = planCrossfade({ fromBpm: 120, toBpm: 120, fromDurationSec: 180 });
    // 8 beats at 120 BPM is 4 seconds.
    expect(plan.crossfadeSec).toBeCloseTo(4, 9);
    expect(plan.beatAligned).toBe(true);
    expect(plan.crossfadeStartSec).toBeCloseTo(176, 9);
    expect(plan.fromStartSec).toBeCloseTo(172, 9);
    expect(plan.toPlaybackRate).toBe(1);
    // Different beat counts scale the length.
    expect(planCrossfade({ fromBpm: 120, toBpm: 120, beats: 16, fromDurationSec: 180 }).crossfadeSec).toBeCloseTo(8, 9);
    expect(CROSSFADE_BEATS).toBe(8);
  });

  it("falls back to a fixed length when the outgoing tempo is unknown", () => {
    for (const fromBpm of [null, undefined, 0, -5, Number.NaN]) {
      const plan = planCrossfade({ fromBpm, toBpm: 124, fromDurationSec: 120 });
      expect(plan.crossfadeSec).toBe(FALLBACK_CROSSFADE_SEC);
      expect(plan.beatAligned).toBe(false);
      expect(plan.toPlaybackRate).toBe(1);
    }
  });

  it("shrinks the fade for a short clip and starts at zero", () => {
    const plan = planCrossfade({ fromBpm: 100, toBpm: 100, fromDurationSec: 6 });
    expect(plan.crossfadeSec).toBe(3);
    expect(plan.beatAligned).toBe(false);
    expect(plan.crossfadeStartSec).toBe(3);
    expect(plan.fromStartSec).toBe(0);
  });

  it("handles a zero-length clip", () => {
    const plan = planCrossfade({ fromBpm: 120, toBpm: 120, fromDurationSec: 0 });
    expect(plan.crossfadeSec).toBe(0);
    expect(plan.crossfadeStartSec).toBe(0);
    expect(plan.fromStartSec).toBe(0);
  });
});

describe("tempoMatchRate", () => {
  it("matches the incoming tempo to the outgoing one", () => {
    expect(tempoMatchRate(124, 120)).toBeCloseTo(124 / 120, 9);
    expect(tempoMatchRate(120, 124)).toBeCloseTo(120 / 124, 9);
  });

  it("clamps to plus or minus 8%", () => {
    expect(tempoMatchRate(140, 100)).toBeCloseTo(1.08, 9);
    expect(tempoMatchRate(90, 130)).toBeCloseTo(0.92, 9);
  });

  it("is 1 when either tempo is unknown", () => {
    expect(tempoMatchRate(null, 120)).toBe(1);
    expect(tempoMatchRate(120, null)).toBe(1);
    expect(tempoMatchRate(0, 120)).toBe(1);
  });
});

describe("equalPowerCurves", () => {
  it("keeps power constant through the fade", () => {
    const { fadeOut, fadeIn } = equalPowerCurves(33);
    expect(fadeOut[0]).toBeCloseTo(1, 6);
    expect(fadeIn[0]).toBeCloseTo(0, 6);
    expect(fadeOut[32]).toBeCloseTo(0, 6);
    expect(fadeIn[32]).toBeCloseTo(1, 6);
    for (let i = 0; i < 33; i += 1) {
      expect(fadeOut[i] ** 2 + fadeIn[i] ** 2).toBeCloseTo(1, 5);
    }
  });
});
