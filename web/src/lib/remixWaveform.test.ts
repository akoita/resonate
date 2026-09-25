import { describe, expect, it, vi } from "vitest";
import {
  computePeaks,
  WAVEFORM_MAX_SAMPLE_READS,
  WAVEFORM_PEAK_BUCKETS,
} from "./remixWaveform";

function buffer(channels: number[][]) {
  const data = channels.map((samples) => Float32Array.from(samples));
  return {
    numberOfChannels: data.length,
    length: data[0]?.length ?? 0,
    getChannelData: (channel: number) => data[channel],
  };
}

describe("computePeaks (#1879)", () => {
  it("takes the max absolute sample per bucket across channels", () => {
    const peaks = computePeaks(
      buffer([
        [0.1, -0.2, 0.05, 0.3],
        [-0.4, 0.1, 0.0, -0.1],
      ]),
      2,
    );
    expect(peaks[0]).toBeCloseTo(0.4);
    expect(peaks[1]).toBeCloseTo(0.3);
  });

  it("keeps absolute scale (a quiet stem stays quiet) and clamps at 1", () => {
    const quiet = computePeaks(buffer([[0.01, -0.02, 0.01, 0.02]]), 2);
    expect(Math.max(...quiet)).toBeCloseTo(0.02);
    const hot = computePeaks(buffer([[1.7, -0.5]]), 2);
    expect(hot).toEqual([1, 0.5]);
  });

  it("returns the default bucket count, zero-filled for empty audio", () => {
    expect(WAVEFORM_PEAK_BUCKETS).toBe(1000);
    const empty = computePeaks(buffer([[]]));
    expect(empty).toHaveLength(WAVEFORM_PEAK_BUCKETS);
    expect(empty.every((peak) => peak === 0)).toBe(true);
  });

  it("stretches audio shorter than the bucket count across every bucket", () => {
    const peaks = computePeaks(buffer([[0.5, -0.25]]), 4);
    expect(peaks).toEqual([0.5, 0.5, 0.25, 0.25]);
  });

  it("bounds sample reads on long buffers", () => {
    const length = 48_000 * 60 * 5; // 5 minutes at 48 kHz
    let reads = 0;
    const channel = new Float32Array(length);
    channel[length - 1] = 0.9;
    const proxy = new Proxy(channel, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const getChannelData = vi.fn(() => proxy as unknown as Float32Array);
    const peaks = computePeaks(
      { numberOfChannels: 2, length, getChannelData },
      WAVEFORM_PEAK_BUCKETS,
    );
    expect(peaks).toHaveLength(WAVEFORM_PEAK_BUCKETS);
    expect(getChannelData).toHaveBeenCalledTimes(2);
    expect(reads).toBeLessThanOrEqual(WAVEFORM_MAX_SAMPLE_READS + 2_000);
  });
});
