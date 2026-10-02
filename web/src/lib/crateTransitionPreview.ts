/**
 * Crate transition preview (#1963, docs/rfc/taste-engine.md section 5.3): a
 * short crossfade from the end of one crate line into the start of the next.
 *
 * Deterministic DSP only: a tempo-matched, beat-length equal-power crossfade of
 * the two lines' own audio. Nothing is generated and nothing is rendered or
 * stored; the preview is heard locally and discarded.
 */

/** Crossfade length in beats unless the caller asks otherwise. */
export const CROSSFADE_BEATS = 8;
/** Crossfade length when the outgoing tempo is unknown. */
export const FALLBACK_CROSSFADE_SEC = 8;
/** The incoming line is never sped up or slowed by more than 8%. */
export const MAX_TEMPO_ADJUST = 0.08;
/** Samples in the equal-power gain curves handed to the Web Audio API. */
export const CROSSFADE_CURVE_POINTS = 64;

export type CrossfadePlanInput = {
  fromBpm: number | null | undefined;
  toBpm: number | null | undefined;
  beats?: number;
  /** Length of the outgoing audio in seconds. */
  fromDurationSec: number;
};

export type CrossfadePlan = {
  /** Where in the outgoing audio the preview starts (a lead-in before the fade). */
  fromStartSec: number;
  /** Where in the outgoing audio the crossfade begins. */
  crossfadeStartSec: number;
  /** How long the crossfade lasts, in seconds of playback. */
  crossfadeSec: number;
  /** Playback rate for the incoming audio, tempo-matched and clamped; 1 when unknown. */
  toPlaybackRate: number;
  /** True when the crossfade length is a whole number of beats at the outgoing tempo. */
  beatAligned: boolean;
};

function validBpm(bpm: number | null | undefined): bpm is number {
  return typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0;
}

/** Playback rate that brings the incoming tempo to the outgoing one, within the clamp. */
export function tempoMatchRate(
  fromBpm: number | null | undefined,
  toBpm: number | null | undefined,
): number {
  if (!validBpm(fromBpm) || !validBpm(toBpm)) return 1;
  const raw = fromBpm / toBpm;
  return Math.min(1 + MAX_TEMPO_ADJUST, Math.max(1 - MAX_TEMPO_ADJUST, raw));
}

export function planCrossfade(input: CrossfadePlanInput): CrossfadePlan {
  const beats = input.beats !== undefined && input.beats > 0 ? input.beats : CROSSFADE_BEATS;
  const duration = Number.isFinite(input.fromDurationSec) ? Math.max(0, input.fromDurationSec) : 0;

  let crossfadeSec: number;
  let beatAligned: boolean;
  if (validBpm(input.fromBpm)) {
    crossfadeSec = (beats * 60) / input.fromBpm;
    beatAligned = true;
  } else {
    crossfadeSec = FALLBACK_CROSSFADE_SEC;
    beatAligned = false;
  }
  // A crossfade that would swallow most of a short clip shrinks to half of it.
  if (crossfadeSec > duration / 2) {
    crossfadeSec = duration / 2;
    beatAligned = false;
  }

  const crossfadeStartSec = Math.max(0, duration - crossfadeSec);
  // Let the outgoing line play alone for as long as the fade lasts first.
  const fromStartSec = Math.max(0, crossfadeStartSec - crossfadeSec);

  return {
    fromStartSec,
    crossfadeStartSec,
    crossfadeSec,
    toPlaybackRate: tempoMatchRate(input.fromBpm, input.toBpm),
    beatAligned,
  };
}

/**
 * Equal-power gain curves for the outgoing and incoming sides: cos and sin of a
 * quarter turn, so out^2 + in^2 stays 1 and the loudness does not dip mid-fade.
 */
export function equalPowerCurves(points = CROSSFADE_CURVE_POINTS): {
  fadeOut: Float32Array<ArrayBuffer>;
  fadeIn: Float32Array<ArrayBuffer>;
} {
  const count = Math.max(2, Math.floor(points));
  const fadeOut = new Float32Array(count);
  const fadeIn = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const phase = (i / (count - 1)) * (Math.PI / 2);
    fadeOut[i] = Math.cos(phase);
    fadeIn[i] = Math.sin(phase);
  }
  return { fadeOut, fadeIn };
}

/* ------------------------------------------------------------------ */
/* Web Audio player                                                    */
/* ------------------------------------------------------------------ */

export type TransitionPlayRequest = {
  fromStemId: string;
  toStemId: string;
  fromBpm: number | null;
  toBpm: number | null;
  /** Called once both previews are decoded and the crossfade is scheduled. */
  onStarted?: () => void;
};

export type CrateTransitionPlayer = {
  /** Fetches both previews, then plays the crossfade. Resolves when it ends or is stopped. */
  play: (request: TransitionPlayRequest) => Promise<void>;
  /** Stops playback at once; safe to call when idle. */
  stop: () => void;
  /** Releases the audio context. */
  dispose: () => void;
};

type AudioContextConstructor = new () => AudioContext;

function defaultAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("Audio preview is not available in this environment.");
  }
  const contextWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
  const constructor = window.AudioContext ?? contextWindow.webkitAudioContext;
  if (!constructor) throw new Error("Audio preview is not supported by this browser.");
  return new constructor();
}

export function createCrateTransitionPlayer(input: {
  urlForStem: (stemId: string) => string;
  fetchImpl?: typeof fetch;
  audioContextFactory?: () => AudioContext;
}): CrateTransitionPlayer {
  const doFetch: typeof fetch = input.fetchImpl ?? ((resource, init) => fetch(resource, init));
  const createContext = input.audioContextFactory ?? defaultAudioContext;
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let context: AudioContext | null = null;
  let active: { stop: () => void } | null = null;
  let runId = 0;

  const ensureContext = () => {
    if (!context) context = createContext();
    return context;
  };

  const loadBuffer = (audioContext: AudioContext, stemId: string) => {
    const cached = buffers.get(stemId);
    if (cached) return cached;
    const pending = (async () => {
      const response = await doFetch(input.urlForStem(stemId));
      if (!response.ok) throw new Error(`Preview unavailable for ${stemId}`);
      return audioContext.decodeAudioData(await response.arrayBuffer());
    })();
    buffers.set(stemId, pending);
    // A failed fetch must not poison the cache: the next press retries.
    pending.catch(() => {
      if (buffers.get(stemId) === pending) buffers.delete(stemId);
    });
    return pending;
  };

  const stop = () => {
    runId += 1;
    const current = active;
    active = null;
    current?.stop();
  };

  const play = async (request: TransitionPlayRequest) => {
    stop();
    const myRun = runId;
    const audioContext = ensureContext();
    // Resume inside the user gesture that pressed the button.
    if (audioContext.state === "suspended") await audioContext.resume();
    const [fromBuffer, toBuffer] = await Promise.all([
      loadBuffer(audioContext, request.fromStemId),
      loadBuffer(audioContext, request.toStemId),
    ]);
    if (myRun !== runId) return;

    const plan = planCrossfade({
      fromBpm: request.fromBpm,
      toBpm: request.toBpm,
      fromDurationSec: fromBuffer.duration,
    });
    const { fadeOut, fadeIn } = equalPowerCurves();
    const start = audioContext.currentTime + 0.05;
    const fadeAt = start + (plan.crossfadeStartSec - plan.fromStartSec);
    const fadeEnd = fadeAt + plan.crossfadeSec;
    // Incoming audio plays on at its tempo-matched rate for one more fade length.
    const tail = Math.min(plan.crossfadeSec, Math.max(0, toBuffer.duration / plan.toPlaybackRate - plan.crossfadeSec));
    const end = fadeEnd + tail;

    const fromSource = audioContext.createBufferSource();
    fromSource.buffer = fromBuffer;
    const fromGain = audioContext.createGain();
    fromGain.gain.setValueAtTime(1, start);
    if (plan.crossfadeSec > 0) fromGain.gain.setValueCurveAtTime(fadeOut, fadeAt, plan.crossfadeSec);
    fromSource.connect(fromGain).connect(audioContext.destination);

    const toSource = audioContext.createBufferSource();
    toSource.buffer = toBuffer;
    toSource.playbackRate.value = plan.toPlaybackRate;
    const toGain = audioContext.createGain();
    toGain.gain.setValueAtTime(0, start);
    if (plan.crossfadeSec > 0) toGain.gain.setValueCurveAtTime(fadeIn, fadeAt, plan.crossfadeSec);
    toSource.connect(toGain).connect(audioContext.destination);

    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        for (const node of [fromSource, toSource]) {
          try {
            node.stop();
          } catch {
            // Already stopped.
          }
          node.disconnect();
        }
        fromGain.disconnect();
        toGain.disconnect();
        if (active === handle) active = null;
        resolve();
      };
      const handle = { stop: finish };
      active = handle;
      toSource.onended = finish;

      fromSource.start(start, plan.fromStartSec);
      fromSource.stop(fadeEnd);
      toSource.start(fadeAt, 0);
      toSource.stop(end);
      request.onStarted?.();
    });
  };

  const dispose = () => {
    stop();
    buffers.clear();
    const closing = context;
    context = null;
    void closing?.close().catch(() => undefined);
  };

  return { play, stop, dispose };
}
