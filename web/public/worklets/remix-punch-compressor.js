/**
 * Remix Studio Pro "Punch" compressor AudioWorklet (#1903 S6b,
 * remix-fx-dyn-dsp/v1).
 *
 * The preview's half of the punch: the same algorithm as
 * src/lib/remixPunchCompressor.ts (a faithful port of ffmpeg's
 * `acompressor`, which the render runs), inlined because a worklet module is
 * loaded on its own. remixPunchCompressor.test.ts runs this file against the
 * TypeScript core and ffmpeg's committed output; keep the two in step.
 *
 * Options/messages: `{ params }`, the mapped acompressor settings
 * (`punchCompressor(punch)` on the main thread), or `{ params: null }` to
 * pass audio through unchanged. The envelope carries across changes.
 * `{ dispose: true }` (sent when a play's graph is released) ends the
 * processor so the browser can collect it.
 */

const FAKE_INFINITY = 65536.0 * 65536.0;

function createState(params, rate, linSlope) {
  const threshold = params.threshold;
  const ratio = params.ratio;
  const knee = params.knee;
  const thres = Math.log(threshold);
  const linKneeStart = threshold / Math.sqrt(knee);
  const linKneeStop = threshold * Math.sqrt(knee);
  const kneeStart = Math.log(linKneeStart);
  const kneeStop = Math.log(linKneeStop);
  return {
    ratio,
    makeup: params.makeup,
    mix: params.mix === undefined ? 1 : params.mix,
    knee,
    thres,
    kneeStart,
    kneeStop,
    adjKneeStart: linKneeStart * linKneeStart,
    compressedKneeStop: (kneeStop - thres) / ratio + thres,
    attackCoeff: Math.min(1, 1 / ((params.attackMs * rate) / 4000)),
    releaseCoeff: Math.min(1, 1 / ((params.releaseMs * rate) / 4000)),
    linSlope,
  };
}

function hermiteInterpolation(x, x0, x1, p0, p1, m0, m1) {
  const width = x1 - x0;
  const t = (x - x0) / width;
  const m0w = m0 * width;
  const m1w = m1 * width;
  const t2 = t * t;
  const t3 = t2 * t;
  const ct2 = -3 * p0 - 2 * m0w + 3 * p1 - m1w;
  const ct3 = 2 * p0 + m0w - 2 * p1 + m1w;
  return ct3 * t3 + ct2 * t2 + m0w * t + p0;
}

function outputGain(state, linSlope) {
  const slope = Math.log(linSlope) * 0.5;
  let gain;
  let delta;
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

function processBlock(state, input, output, frames) {
  const channels = input.length;
  if (channels === 0) return;
  const makeup = state.makeup;
  const mix = state.mix;
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

class RemixPunchCompressorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.params = null;
    this.state = null;
    this.alive = true;
    this.setParams((options && options.processorOptions && options.processorOptions.params) || null);
    this.port.onmessage = (event) => {
      if (!event.data) return;
      if (event.data.dispose === true) this.alive = false;
      else if ("params" in event.data) this.setParams(event.data.params);
    };
  }

  setParams(params) {
    this.params = params;
    this.state = params
      ? createState(params, sampleRate, this.state ? this.state.linSlope : 0)
      : this.state;
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) return true;
    const frames = input[0].length;
    const channels = Math.min(input.length, output.length);
    if (!this.params || !this.state) {
      for (let c = 0; c < channels; c += 1) output[c].set(input[c]);
      return true;
    }
    processBlock(this.state, input.slice(0, channels), output, frames);
    return true;
  }
}

registerProcessor("remix-punch-compressor", RemixPunchCompressorProcessor);
