/**
 * The per-stem "Punch" compressor core (#1903 S6b, remix-fx-dyn-dsp/v1).
 *
 * A faithful port of ffmpeg's `acompressor` (libavfilter
 * af_sidechaincompress.c, `compressor()` with the input as its own
 * sidechain): one shared envelope over the channels (link=average), RMS
 * detection, downward mode, Hermite soft knee, makeup and mix. The render
 * runs the real ffmpeg filter; the browser preview runs this same algorithm
 * in an AudioWorklet (web/public/worklets/remix-punch-compressor.js, mirrored
 * by web/src/lib/remixPunchCompressor.ts). The committed fixture
 * `remix-fx-dyn-v1.parity.json` pins ffmpeg's own output for a deterministic
 * signal, and the ffmpeg-gated test compares this port with a live ffmpeg run.
 *
 * Pure: no I/O, no clock. Processing is in double precision, like ffmpeg
 * (which converts to AV_SAMPLE_FMT_DBL for this filter).
 */

/** ffmpeg acompressor options, in the units ffmpeg parses them. */
export type AcompressorParams = {
  /** Linear threshold (ffmpeg `threshold`, 0.000976563..1). */
  threshold: number;
  /** Ratio (ffmpeg `ratio`, 1..20). */
  ratio: number;
  /** Attack in milliseconds (ffmpeg `attack`). */
  attackMs: number;
  /** Release in milliseconds (ffmpeg `release`). */
  releaseMs: number;
  /** Linear makeup gain (ffmpeg `makeup`, 1..64). */
  makeup: number;
  /** Linear knee (ffmpeg `knee`, 1..8). */
  knee: number;
  /** Dry/wet mix (ffmpeg `mix`, 0..1); default 1. */
  mix?: number;
};

/** ffmpeg's stand-in for an infinite ratio. */
const FAKE_INFINITY = 65536.0 * 65536.0;

/** The derived constants ffmpeg computes in `compressor_config_output`. */
export type AcompressorState = {
  ratio: number;
  makeup: number;
  mix: number;
  knee: number;
  thres: number;
  kneeStart: number;
  kneeStop: number;
  adjKneeStart: number;
  compressedKneeStop: number;
  attackCoeff: number;
  releaseCoeff: number;
  /** The envelope (ffmpeg `lin_slope`), carried across blocks. */
  linSlope: number;
};

export function createAcompressorState(
  params: AcompressorParams,
  sampleRate: number,
): AcompressorState {
  const { threshold, ratio, knee } = params;
  const thres = Math.log(threshold);
  const linKneeStart = threshold / Math.sqrt(knee);
  const linKneeStop = threshold * Math.sqrt(knee);
  const kneeStart = Math.log(linKneeStart);
  const kneeStop = Math.log(linKneeStop);
  return {
    ratio,
    makeup: params.makeup,
    mix: params.mix ?? 1,
    knee,
    thres,
    kneeStart,
    kneeStop,
    adjKneeStart: linKneeStart * linKneeStart,
    compressedKneeStop: (kneeStop - thres) / ratio + thres,
    attackCoeff: Math.min(1, 1 / ((params.attackMs * sampleRate) / 4000)),
    releaseCoeff: Math.min(1, 1 / ((params.releaseMs * sampleRate) / 4000)),
    linSlope: 0,
  };
}

function hermiteInterpolation(
  x: number,
  x0: number,
  x1: number,
  p0: number,
  p1: number,
  m0: number,
  m1: number,
): number {
  const width = x1 - x0;
  const t = (x - x0) / width;
  const m0w = m0 * width;
  const m1w = m1 * width;
  const t2 = t * t;
  const t3 = t2 * t;
  const ct0 = p0;
  const ct1 = m0w;
  const ct2 = -3 * p0 - 2 * m0w + 3 * p1 - m1w;
  const ct3 = 2 * p0 + m0w - 2 * p1 + m1w;
  return ct3 * t3 + ct2 * t2 + ct1 * t + ct0;
}

/** ffmpeg `output_gain` for downward mode with RMS detection. */
function outputGain(state: AcompressorState, linSlope: number): number {
  const slope = Math.log(linSlope) * 0.5;
  let gain: number;
  let delta: number;
  if (Math.abs(state.ratio - FAKE_INFINITY) < 1.0) {
    gain = state.thres;
    delta = 0;
  } else {
    gain = (slope - state.thres) / state.ratio + state.thres;
    delta = 1 / state.ratio;
  }
  if (state.knee > 1.0 && slope < state.kneeStop) {
    gain = hermiteInterpolation(
      slope,
      state.kneeStart,
      state.kneeStop,
      state.kneeStart,
      state.compressedKneeStop,
      1.0,
      delta,
    );
  }
  return Math.exp(gain - slope);
}

/**
 * Compress `frames` samples of planar `input` into `output` (which may be
 * the same arrays), advancing `state`. Every channel gets the same gain.
 */
export function processAcompressor(
  state: AcompressorState,
  input: ArrayLike<number>[],
  output: { [index: number]: number }[],
  frames: number,
): void {
  const channels = input.length;
  if (channels === 0) return;
  const { makeup, mix } = state;
  for (let i = 0; i < frames; i += 1) {
    let absSample = Math.abs(input[0][i]);
    for (let c = 1; c < channels; c += 1) absSample += Math.abs(input[c][i]);
    absSample /= channels;
    absSample *= absSample;
    state.linSlope +=
      (absSample - state.linSlope) *
      (absSample > state.linSlope ? state.attackCoeff : state.releaseCoeff);
    let gain = 1.0;
    if (state.linSlope > 0.0 && state.linSlope > state.adjKneeStart) {
      gain = outputGain(state, state.linSlope);
    }
    const factor = gain * makeup * mix + (1 - mix);
    for (let c = 0; c < channels; c += 1) output[c][i] = input[c][i] * factor;
  }
}
