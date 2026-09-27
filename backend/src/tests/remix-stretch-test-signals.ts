/**
 * Shared signal helpers for the time-stretch specs (#1898): the parity
 * fixture's documented input generator, the fixture hash, and a dominant-
 * frequency estimator for pitch sanity checks.
 */

import { createHash } from "crypto";

/**
 * The fixture's documented generator: chord 0.2·(sin 220 + sin 277.18 +
 * sin 329.63 Hz) plus 30 ms LCG noise bursts every 0.5 s; L = chord + burst,
 * R = 0.8·chord − 0.7·burst. A pure 440 Hz sine (0.5) for `kind: "sine"`.
 */
export function makeTestSignal(
  sampleRate: number,
  seconds: number,
  kind: "chord" | "sine" = "chord",
): Float32Array[] {
  const n = Math.round(sampleRate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let s = 12345;
  const nz = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    if (kind === "sine") {
      left[i] = right[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t);
      continue;
    }
    const chord =
      0.2 *
      (Math.sin(2 * Math.PI * 220 * t) +
        Math.sin(2 * Math.PI * 277.18 * t) +
        Math.sin(2 * Math.PI * 329.63 * t));
    const ph = t % 0.5;
    const burst = ph < 0.03 ? 0.5 * nz() * (1 - ph / 0.03) : 0;
    left[i] = chord + burst;
    right[i] = 0.8 * chord - burst * 0.7;
  }
  return [left, right];
}

export function sha256Of(channels: Float32Array[]): string {
  const hash = createHash("sha256");
  for (const channel of channels) {
    hash.update(
      Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength),
    );
  }
  return hash.digest("hex");
}

/** Dominant frequency: Hann-windowed radix-2 FFT peak + parabolic interpolation. */
export function dominantHz(
  x: Float32Array,
  sampleRate: number,
  start: number,
  size = 65536,
): number {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < size; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const p = i + k;
        const q = p + len / 2;
        const tr = re[q] * wr - im[q] * wi;
        const ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
    }
  }
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  let best = 1;
  let bestMag = 0;
  for (let k = 1; k < size / 2; k += 1) {
    const m = mag(k);
    if (m > bestMag) {
      bestMag = m;
      best = k;
    }
  }
  const a = Math.log(mag(best - 1));
  const b = Math.log(mag(best));
  const c = Math.log(mag(best + 1));
  const d = (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + d) * sampleRate) / size;
}
