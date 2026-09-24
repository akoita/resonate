export type RemixDraftOutputMetadata = {
  outputUri: string | null;
  mimeType?: string | null;
  synthIdPresent?: boolean | null;
  seed?: number | null;
  sampleRate?: number | null;
};

export type RemixGenerationMetadata = {
  output?: RemixDraftOutputMetadata | null;
};

export type PreviewStemState = {
  stemId: string;
  gainDb: number | null;
  muted: boolean;
  /**
   * Section-grid play spans (#1314): undefined/null = whole stem plays;
   * [] = every section off (silent); otherwise the preview schedules a gain
   * envelope over these spans, mirroring the server render's gating.
   */
  activeIntervals?: Array<{ startSec: number; endSec: number }> | null;
};

/** Matches the server render's section edge fade (SECTION_FADE_SECONDS). */
export const PREVIEW_SECTION_FADE_SECONDS = 0.05;

type SchedulableParam = {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
};

/**
 * Schedule the section envelope on a dedicated gain param, relative to the
 * preview's start time. Pure over an AudioParam-like interface so it is
 * testable without a real AudioContext. Live mute/solo/gain stay on the
 * separate manual gain node and never fight this automation.
 */
export function scheduleSectionEnvelope(
  param: SchedulableParam,
  intervals: Array<{ startSec: number; endSec: number }> | null | undefined,
  startAt: number,
  fadeSeconds: number = PREVIEW_SECTION_FADE_SECONDS,
): void {
  if (intervals === null || intervals === undefined) {
    param.setValueAtTime(1, startAt);
    return;
  }
  if (intervals.length === 0) {
    param.setValueAtTime(0, startAt);
    return;
  }
  const fade = Math.max(fadeSeconds, 0.001);
  param.setValueAtTime(intervals[0].startSec <= 0 ? 1 : 0, startAt);
  for (const interval of intervals) {
    if (interval.startSec > 0) {
      param.setValueAtTime(0, startAt + interval.startSec);
      param.linearRampToValueAtTime(1, startAt + interval.startSec + fade);
    }
    const fadeOutStart = Math.max(
      interval.endSec - fade,
      interval.startSec > 0 ? interval.startSec + fade : 0,
    );
    param.setValueAtTime(1, startAt + fadeOutStart);
    param.linearRampToValueAtTime(0, startAt + interval.endSec);
  }
}

/** Post-limiter output level for the studio meter. */
export type PreviewLevel = {
  /** Peak absolute sample value after the limiter, linear 0..1. */
  peak: number;
  /** True while the limiter is pulling more than 1 dB of gain reduction. */
  limiting: boolean;
};

export type StemArrangementPreviewHandle = {
  update(
    stems: PreviewStemState[],
    soloStemId: string | null,
    referenceStemId?: string | null,
  ): void;
  stop(): void;
  level(): PreviewLevel;
};

export type StemPreviewEngine = {
  play(input: {
    stems: PreviewStemState[];
    soloStemId: string | null;
    referenceStemId?: string | null;
    onEnded?: () => void;
  }): Promise<StemArrangementPreviewHandle>;
  dispose(): void;
};

/**
 * Master limiter: summing every stem at unity clips, so the preview runs
 * through a brickwall-ish compressor. The server render is loudness-normalized
 * instead; this only keeps the browser preview from distorting.
 */
export const PREVIEW_LIMITER_THRESHOLD_DB = -3;
export const PREVIEW_LIMITER_KNEE_DB = 0;
export const PREVIEW_LIMITER_RATIO = 20;
export const PREVIEW_LIMITER_ATTACK_SECONDS = 0.003;
export const PREVIEW_LIMITER_RELEASE_SECONDS = 0.25;
/** Gain reduction (dB) beyond which the meter reports "limiting". */
export const PREVIEW_LIMITING_REDUCTION_DB = -1;
export const PREVIEW_METER_FFT_SIZE = 1024;

const SILENT_LEVEL: PreviewLevel = { peak: 0, limiting: false };

type AudioContextConstructor = new () => AudioContext;

export function dbToLinearGain(db: number | null | undefined): number {
  const value = typeof db === "number" && Number.isFinite(db) ? db : 0;
  return Math.pow(10, value / 20);
}

/**
 * Live gain for one stem. With a reference (A/B "compare with original")
 * active, only the reference stem plays, at unity — its mute and any solo are
 * ignored because the point is to hear the untouched full mix.
 */
export function stemPreviewGain(
  stem: PreviewStemState,
  soloStemId: string | null,
  referenceStemId: string | null = null,
): number {
  if (referenceStemId) {
    return stem.stemId === referenceStemId ? 1 : 0;
  }
  if (stem.muted) return 0;
  if (soloStemId && soloStemId !== stem.stemId) return 0;
  return dbToLinearGain(stem.gainDb);
}

export function remixDraftOutputUri(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const output = (metadata as RemixGenerationMetadata).output;
  if (!output || typeof output !== "object") return null;
  return typeof output.outputUri === "string" && output.outputUri.trim()
    ? output.outputUri
    : null;
}

function audioContextConstructor(): AudioContextConstructor {
  if (typeof window === "undefined") {
    throw new Error("Audio preview is not available in this environment.");
  }
  const contextWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const constructor = window.AudioContext ?? contextWindow.webkitAudioContext;
  if (!constructor) {
    throw new Error("Audio preview is not supported by this browser.");
  }
  return constructor as AudioContextConstructor;
}

/** Older engines exposed `reduction` as an AudioParam rather than a number. */
function compressorReductionDb(compressor: DynamicsCompressorNode): number {
  const reduction = compressor.reduction as unknown;
  if (typeof reduction === "number") return reduction;
  if (reduction && typeof reduction === "object" && "value" in reduction) {
    const value = (reduction as { value: unknown }).value;
    return typeof value === "number" ? value : 0;
  }
  return 0;
}

const INERT_HANDLE: StemArrangementPreviewHandle = {
  update: () => undefined,
  stop: () => undefined,
  level: () => SILENT_LEVEL,
};

/**
 * Persistent studio preview engine. One AudioContext (created lazily on the
 * first play, i.e. inside a user gesture) and one master limiter/meter chain
 * live for the editor's lifetime; decoded stem buffers are cached so repeat
 * "Play preview" presses start instantly instead of re-downloading and
 * re-decoding every stem.
 */
export function createStemPreviewEngine(input: {
  urlForStem: (stemId: string) => string;
  fetchImpl?: typeof fetch;
  audioContextFactory?: () => AudioContext;
}): StemPreviewEngine {
  const doFetch: typeof fetch =
    input.fetchImpl ?? ((resource, init) => fetch(resource, init));
  const createContext =
    input.audioContextFactory ?? (() => new (audioContextConstructor())());
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let context: AudioContext | null = null;
  let master: {
    compressor: DynamicsCompressorNode;
    analyser: AnalyserNode;
  } | null = null;
  let meterData: Float32Array<ArrayBuffer> | null = null;
  let current: StemArrangementPreviewHandle | null = null;
  let playGeneration = 0;
  let disposed = false;

  const ensureContext = (): AudioContext => {
    if (context) return context;
    const created = createContext();
    const compressor = created.createDynamicsCompressor();
    compressor.threshold.value = PREVIEW_LIMITER_THRESHOLD_DB;
    compressor.knee.value = PREVIEW_LIMITER_KNEE_DB;
    compressor.ratio.value = PREVIEW_LIMITER_RATIO;
    compressor.attack.value = PREVIEW_LIMITER_ATTACK_SECONDS;
    compressor.release.value = PREVIEW_LIMITER_RELEASE_SECONDS;
    const analyser = created.createAnalyser();
    analyser.fftSize = PREVIEW_METER_FFT_SIZE;
    compressor.connect(analyser).connect(created.destination);
    context = created;
    master = { compressor, analyser };
    return created;
  };

  const loadBuffer = (
    audioContext: AudioContext,
    stemId: string,
  ): Promise<AudioBuffer> => {
    const cached = buffers.get(stemId);
    if (cached) return cached;
    const pending = (async () => {
      const response = await doFetch(input.urlForStem(stemId));
      if (!response.ok) {
        throw new Error(`Stem preview unavailable for ${stemId}`);
      }
      const data = await response.arrayBuffer();
      return audioContext.decodeAudioData(data);
    })();
    buffers.set(stemId, pending);
    // A failed fetch/decode must not poison the cache: the next play retries.
    pending.catch(() => {
      if (buffers.get(stemId) === pending) buffers.delete(stemId);
    });
    return pending;
  };

  const level = (): PreviewLevel => {
    if (!master) return SILENT_LEVEL;
    const data = meterData ?? new Float32Array(master.analyser.fftSize);
    meterData = data;
    master.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const sample of data) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
    return {
      peak: Math.min(1, peak),
      limiting:
        compressorReductionDb(master.compressor) < PREVIEW_LIMITING_REDUCTION_DB,
    };
  };

  const play: StemPreviewEngine["play"] = async (request) => {
    if (disposed) {
      throw new Error("Audio preview engine was disposed.");
    }
    current?.stop();
    current = null;
    const generation = ++playGeneration;
    const audioContext = ensureContext();
    // resume() is kicked off synchronously so it still counts as part of the
    // user gesture that triggered play.
    const resuming =
      audioContext.state === "suspended" ? audioContext.resume() : null;
    const [decoded] = await Promise.all([
      Promise.all(
        request.stems.map((stem) => loadBuffer(audioContext, stem.stemId)),
      ),
      resuming,
    ]);
    // A newer play() (or dispose) superseded this one while loading: start
    // nothing and hand back an inert handle.
    if (disposed || generation !== playGeneration || !master) {
      return INERT_HANDLE;
    }
    const output = master.compressor;

    const sources: AudioBufferSourceNode[] = [];
    const gains = new Map<string, GainNode>();
    const sectionGains = new Map<string, GainNode>();
    let stopped = false;
    let endedCount = 0;

    const releaseNodes = () => {
      for (const source of sources) source.disconnect();
      for (const gain of gains.values()) gain.disconnect();
      for (const gain of sectionGains.values()) gain.disconnect();
    };

    const handle: StemArrangementPreviewHandle = {
      update(stems, soloStemId, referenceStemId = null) {
        for (const stem of stems) {
          const gain = gains.get(stem.stemId);
          if (gain) {
            gain.gain.value = stemPreviewGain(stem, soloStemId, referenceStemId);
          }
        }
      },
      stop() {
        if (stopped) return;
        stopped = true;
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
        }
        releaseNodes();
        if (current === handle) current = null;
      },
      level: () => (stopped ? SILENT_LEVEL : level()),
    };

    request.stems.forEach((stem, index) => {
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      // Section envelope (#1314) lives on its own node so scheduled
      // automation and live manual-gain updates never conflict.
      const sectionGain = audioContext.createGain();
      source.buffer = decoded[index];
      source.connect(gain).connect(sectionGain).connect(output);
      source.onended = () => {
        endedCount += 1;
        if (!stopped && endedCount >= sources.length) {
          stopped = true;
          releaseNodes();
          if (current === handle) current = null;
          request.onEnded?.();
        }
      };
      sources.push(source);
      gains.set(stem.stemId, gain);
      sectionGains.set(stem.stemId, sectionGain);
    });

    handle.update(
      request.stems,
      request.soloStemId,
      request.referenceStemId ?? null,
    );
    const startAt = audioContext.currentTime + 0.03;
    // Section envelopes are scheduled once at start from the current
    // arrangement; cell edits during playback apply on the next preview start.
    for (const stem of request.stems) {
      const sectionGain = sectionGains.get(stem.stemId);
      if (sectionGain) {
        scheduleSectionEnvelope(sectionGain.gain, stem.activeIntervals, startAt);
      }
    }
    for (const source of sources) {
      source.start(startAt);
    }
    current = handle;
    return handle;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    current?.stop();
    current = null;
    buffers.clear();
    master?.compressor.disconnect();
    master?.analyser.disconnect();
    master = null;
    meterData = null;
    const closing = context;
    context = null;
    void closing?.close().catch(() => undefined);
  };

  return { play, dispose };
}
