/**
 * Waveform peaks for the Remix Studio lanes (#1879): one small array per
 * stem, computed once from the decoded preview buffer and drawn by the lane.
 */

/** Peak buckets per stem, independent of the stem's length. */
export const WAVEFORM_PEAK_BUCKETS = 1000;

/**
 * Upper bound on sample reads per stem. Long buffers are sampled every Nth
 * frame instead of scanned in full: a peak display does not need every
 * sample, and a 5-minute stereo stem at 48 kHz is ~29M samples.
 */
export const WAVEFORM_MAX_SAMPLE_READS = 200_000;

/** The subset of AudioBuffer the peak scan needs (testable without WebAudio). */
export type PeakSourceBuffer = {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
};

/**
 * Per-bucket max |sample| across channels. Absolute scale is kept — a quiet
 * stem draws quiet, so lanes compare honestly — and only clamped to 1.
 */
export function computePeaks(
  buffer: PeakSourceBuffer,
  buckets: number = WAVEFORM_PEAK_BUCKETS,
): number[] {
  const bucketCount = Math.max(1, Math.floor(buckets));
  const peaks = new Array<number>(bucketCount).fill(0);
  const { length } = buffer;
  const channelCount = Math.max(0, buffer.numberOfChannels);
  if (length <= 0 || channelCount === 0) return peaks;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  const stride = Math.max(
    1,
    Math.ceil((length * channelCount) / WAVEFORM_MAX_SAMPLE_READS),
  );

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor((bucket * length) / bucketCount);
    if (from >= length) break;
    // Buckets narrower than one frame (very short buffers) still read one.
    const to = Math.max(
      from + 1,
      Math.min(length, Math.floor(((bucket + 1) * length) / bucketCount)),
    );
    let peak = 0;
    for (let frame = from; frame < to; frame += stride) {
      for (const data of channels) {
        const magnitude = Math.abs(data[frame]);
        if (magnitude > peak) peak = magnitude;
      }
    }
    peaks[bucket] = Math.min(1, peak);
  }
  return peaks;
}
