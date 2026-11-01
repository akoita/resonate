import { loudnessEnvelope, suggestedLengthMs, suggestMomentRanges } from "./punchline-suggest";

function envelopeOf(segments: Array<[number, number]>): number[] {
  return segments.flatMap(([db, windows]) => Array<number>(windows).fill(db));
}

describe("suggested moment ranges (#1476 slice 3)", () => {
  it("measures RMS loudness per window", () => {
    const pcm = Buffer.alloc(8000 * 2 * 2); // 2 s at 8 kHz
    for (let i = 8000; i < 16000; i++) pcm.writeInt16LE(i % 2 ? 16384 : -16384, i * 2);
    const env = loudnessEnvelope(pcm, 8000, 250);
    expect(env).toHaveLength(8);
    expect(env[0]).toBe(-90);
    expect(env[7]).toBeCloseTo(-6.02, 1);
  });

  it("picks a length near 8 s in whole bars, inside the bounds", () => {
    expect(suggestedLengthMs(2000, 15000, null)).toBe(8000);
    expect(suggestedLengthMs(2000, 15000, 120)).toBe(8000); // 4 bars of 2 s
    expect(suggestedLengthMs(2000, 15000, 90)).toBe(Math.round(3 * (4 * 60000) / 90));
    expect(suggestedLengthMs(2000, 5000, null)).toBe(5000);
  });

  it("prefers a lift out of a quieter passage and keeps ranges apart", () => {
    // 30 s: verse -30 dB, chorus -12 dB from 12 s to 20 s, outro -14 dB.
    const env = envelopeOf([[-30, 48], [-12, 32], [-14, 40]]);
    const ranges = suggestMomentRanges(env, { durationMs: 30000, windowMs: 250, minMs: 2000, maxMs: 15000, count: 3 });
    expect(ranges.length).toBeGreaterThan(0);
    const best = ranges.find((r) => r.startMs === 12000);
    expect(best).toMatchObject({ endMs: 20000, reason: "lift" });
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.startMs).toBeGreaterThanOrEqual(ranges[i - 1]!.endMs);
  });

  it("snaps to the beat grid and stays inside the track", () => {
    const env = envelopeOf([[-40, 20], [-10, 20]]); // loud at the very end (5–10 s)
    const ranges = suggestMomentRanges(env, {
      durationMs: 10000, windowMs: 250, minMs: 2000, maxMs: 15000, tempoBpm: 100, firstBeatSec: 0.3, count: 1,
    });
    expect(ranges).toHaveLength(1);
    const [range] = ranges;
    expect(range!.endMs).toBeLessThanOrEqual(10000);
    expect((range!.startMs - 300) % 600).toBe(0);
  });

  it("suggests nothing for silence or a track shorter than the minimum", () => {
    expect(suggestMomentRanges(envelopeOf([[-90, 80]]), { durationMs: 20000, windowMs: 250, minMs: 2000, maxMs: 15000 })).toEqual([]);
    expect(suggestMomentRanges(envelopeOf([[-10, 4]]), { durationMs: 1000, windowMs: 250, minMs: 2000, maxMs: 15000 })).toEqual([]);
  });
});
