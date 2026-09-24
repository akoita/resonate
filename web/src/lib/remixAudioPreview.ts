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

/** A param whose pending automation can be replaced mid-playback (#1879). */
type ReschedulableParam = SchedulableParam & {
  cancelScheduledValues(time: number): unknown;
};

type SectionInterval = { startSec: number; endSec: number };

type EnvelopeEvent = {
  kind: "set" | "ramp";
  value: number;
  /** Seconds on the stem timeline (0 = start of the source). */
  atSec: number;
};

/**
 * The section envelope as timeline events (after the initial value at 0):
 * a trapezoid per span with the render's edge fades. Shared by the from-zero
 * and from-offset schedulers so both produce the same shape.
 */
function sectionEnvelopeEvents(
  intervals: SectionInterval[],
  fadeSeconds: number,
): EnvelopeEvent[] {
  const fade = Math.max(fadeSeconds, 0.001);
  const events: EnvelopeEvent[] = [];
  for (const interval of intervals) {
    if (interval.startSec > 0) {
      events.push({ kind: "set", value: 0, atSec: interval.startSec });
      events.push({ kind: "ramp", value: 1, atSec: interval.startSec + fade });
    }
    const fadeOutStart = Math.max(
      interval.endSec - fade,
      interval.startSec > 0 ? interval.startSec + fade : 0,
    );
    events.push({ kind: "set", value: 1, atSec: fadeOutStart });
    events.push({ kind: "ramp", value: 0, atSec: interval.endSec });
  }
  return events;
}

function applyEnvelopeEvent(
  param: SchedulableParam,
  event: EnvelopeEvent,
  timelineZero: number,
): void {
  if (event.kind === "set") {
    param.setValueAtTime(event.value, timelineZero + event.atSec);
  } else {
    param.linearRampToValueAtTime(event.value, timelineZero + event.atSec);
  }
}

/**
 * Section gain at one timeline position, ignoring the edge fades: 1 inside
 * an active span, 0 outside; null/undefined intervals = whole stem (1),
 * [] = every section off (0).
 */
export function sectionGainAt(
  intervals: SectionInterval[] | null | undefined,
  atSec: number,
): number {
  if (intervals === null || intervals === undefined) return 1;
  return intervals.some(
    (interval) => interval.startSec <= atSec && atSec < interval.endSec,
  )
    ? 1
    : 0;
}

/**
 * Schedule the section envelope on a dedicated gain param, relative to the
 * preview's start time. Pure over an AudioParam-like interface so it is
 * testable without a real AudioContext. Live mute/solo/gain stay on the
 * separate manual gain node and never fight this automation.
 */
export function scheduleSectionEnvelope(
  param: SchedulableParam,
  intervals: SectionInterval[] | null | undefined,
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
  param.setValueAtTime(intervals[0].startSec <= 0 ? 1 : 0, startAt);
  for (const event of sectionEnvelopeEvents(intervals, fadeSeconds)) {
    applyEnvelopeEvent(param, event, startAt);
  }
}

/**
 * (Re)schedule the section envelope from a timeline position (#1879): used
 * when playback starts at a seek offset and when cells are edited while the
 * preview runs. Drops pending automation from `now`, pins the value the
 * envelope has at `fromSec` (fades ignored — a mid-fade restart snaps to the
 * span's level), then schedules only the boundaries later than `fromSec`,
 * in context time `timelineZero + t` (`timelineZero` = context time of the
 * stem's timeline 0).
 */
export function scheduleSectionEnvelopeFrom(
  param: ReschedulableParam,
  intervals: SectionInterval[] | null | undefined,
  timelineZero: number,
  fromSec: number,
  now: number,
  fadeSeconds: number = PREVIEW_SECTION_FADE_SECONDS,
): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(sectionGainAt(intervals, fromSec), now);
  if (!intervals || intervals.length === 0) return;
  for (const event of sectionEnvelopeEvents(intervals, fadeSeconds)) {
    if (event.atSec > fromSec) applyEnvelopeEvent(param, event, timelineZero);
  }
}

/** A looped span on the stem timeline, in seconds. */
export type PreviewLoop = { startSec: number; endSec: number };

/**
 * Where playback enters a loop (#1879): the requested offset when it lies
 * inside the loop, otherwise the loop start.
 */
export function loopEntryOffset(offsetSec: number, loop: PreviewLoop): number {
  return offsetSec >= loop.startSec && offsetSec < loop.endSec
    ? offsetSec
    : loop.startSec;
}

/**
 * Fold a linear play position back into the loop once it passes the loop
 * end (the source keeps cycling [start, end) after entering it).
 */
export function wrapLoopPosition(positionSec: number, loop: PreviewLoop): number {
  const length = loop.endSec - loop.startSec;
  if (length <= 0 || positionSec < loop.endSec) return positionSec;
  return loop.startSec + ((positionSec - loop.startSec) % length);
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
  /**
   * Seconds on the source timeline (#1879): wraps inside a loop, clamps to
   * the duration otherwise, and freezes at the last position after stop.
   */
  position(): number;
  /** Longest decoded buffer among the playing stems, in seconds. */
  duration(): number;
  /**
   * Live section-cell edits (#1879): re-schedule each playing stem's section
   * envelope from the current position. In loop mode the section gain is a
   * constant (see `play`), so this only recomputes it.
   */
  updateSections(stems: PreviewStemState[]): void;
};

export type StemPreviewEngine = {
  /**
   * Start every stem in sync. `offsetSec` starts mid-timeline (seek);
   * `loop` cycles one span. Loops are single sections (#1879): while looping,
   * each stem's section gain is held constant at whether the stem is active
   * at the loop midpoint instead of following the envelope, and `onEnded`
   * never fires.
   */
  play(input: {
    stems: PreviewStemState[];
    soloStemId: string | null;
    referenceStemId?: string | null;
    onEnded?: () => void;
    offsetSec?: number;
    loop?: PreviewLoop | null;
  }): Promise<StemArrangementPreviewHandle>;
  /**
   * Fetch and decode stems into the cache ahead of play (#1879), e.g. for
   * waveforms. Creates the AudioContext without resuming it (a suspended
   * context can decode). Calls `onStemLoaded` per decoded stem, including
   * already-cached ones; per-stem failures are swallowed. Never rejects.
   */
  preload(
    stemIds: string[],
    onStemLoaded?: (stemId: string, buffer: AudioBuffer) => void,
  ): Promise<void>;
  /**
   * Longest decoded buffer in the cache (optionally only among `stemIds`),
   * or null while nothing has decoded yet.
   */
  bufferDuration(stemIds?: string[]): number | null;
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
  position: () => 0,
  duration: () => 0,
  updateSections: () => undefined,
};

/** Shortest loop the engine will cycle; anything shorter plays unlooped. */
const MIN_LOOP_SECONDS = 0.05;

/**
 * Persistent studio preview engine. One AudioContext (created lazily on the
 * first play or preload; resumed only by play, i.e. inside a user gesture)
 * and one master limiter/meter chain live for the editor's lifetime; decoded
 * stem buffers are cached so repeat "Play preview" presses start instantly
 * instead of re-downloading and re-decoding every stem.
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
  // Settled buffers, for synchronous duration reads (#1879).
  const decodedBuffers = new Map<string, AudioBuffer>();
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
    pending.then(
      (buffer) => {
        if (buffers.get(stemId) === pending) decodedBuffers.set(stemId, buffer);
      },
      // A failed fetch/decode must not poison the cache: the next play retries.
      () => {
        if (buffers.get(stemId) === pending) buffers.delete(stemId);
      },
    );
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

  const preload: StemPreviewEngine["preload"] = async (stemIds, onStemLoaded) => {
    if (disposed) return;
    let audioContext: AudioContext;
    try {
      audioContext = ensureContext();
    } catch {
      // No WebAudio here: nothing to preload; play() reports the error.
      return;
    }
    await Promise.all(
      stemIds.map(async (stemId) => {
        try {
          const buffer = await loadBuffer(audioContext, stemId);
          if (!disposed) onStemLoaded?.(stemId, buffer);
        } catch {
          // Swallowed: the cache entry is already dropped for a retry.
        }
      }),
    );
  };

  const bufferDuration: StemPreviewEngine["bufferDuration"] = (stemIds) => {
    let longest: number | null = null;
    const ids = stemIds ?? [...decodedBuffers.keys()];
    for (const stemId of ids) {
      const buffer = decodedBuffers.get(stemId);
      if (buffer && (longest === null || buffer.duration > longest)) {
        longest = buffer.duration;
      }
    }
    return longest;
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
    const duration = decoded.reduce(
      (longest, buffer) => Math.max(longest, buffer.duration),
      0,
    );
    // Clamp the loop to the audio; a degenerate loop plays unlooped.
    const requestedLoop = request.loop ?? null;
    const loop: PreviewLoop | null =
      requestedLoop &&
      Math.min(requestedLoop.endSec, duration) - Math.max(requestedLoop.startSec, 0) >=
        MIN_LOOP_SECONDS
        ? {
            startSec: Math.max(requestedLoop.startSec, 0),
            endSec: Math.min(requestedLoop.endSec, duration),
          }
        : null;
    const requestedOffset = Math.min(
      Math.max(request.offsetSec ?? 0, 0),
      duration,
    );
    const offset = loop ? loopEntryOffset(requestedOffset, loop) : requestedOffset;

    const sources: AudioBufferSourceNode[] = [];
    const gains = new Map<string, GainNode>();
    const sectionGains = new Map<string, GainNode>();
    let stopped = false;
    let endedCount = 0;
    const startAt = audioContext.currentTime + 0.03;
    // Context time of timeline 0: position = currentTime - timelineZero.
    const timelineZero = startAt - offset;
    let frozenPosition: number | null = null;

    const livePosition = (): number => {
      const linear =
        offset + Math.max(0, audioContext.currentTime - startAt);
      return loop ? wrapLoopPosition(linear, loop) : Math.min(linear, duration);
    };

    const releaseNodes = () => {
      for (const source of sources) source.disconnect();
      for (const gain of gains.values()) gain.disconnect();
      for (const gain of sectionGains.values()) gain.disconnect();
    };

    const scheduleSections = (stems: PreviewStemState[], now: number) => {
      for (const stem of stems) {
        const sectionGain = sectionGains.get(stem.stemId);
        if (!sectionGain) continue;
        if (loop) {
          // Loops are single sections: hold the loop-midpoint gain.
          const param = sectionGain.gain;
          param.cancelScheduledValues(now);
          param.setValueAtTime(
            sectionGainAt(
              stem.activeIntervals,
              (loop.startSec + loop.endSec) / 2,
            ),
            now,
          );
        } else if (offset === 0 && now === startAt) {
          // From-zero start: the original envelope, unchanged.
          scheduleSectionEnvelope(sectionGain.gain, stem.activeIntervals, startAt);
        } else {
          scheduleSectionEnvelopeFrom(
            sectionGain.gain,
            stem.activeIntervals,
            timelineZero,
            now - timelineZero,
            now,
          );
        }
      }
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
        frozenPosition = livePosition();
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
      position: () => frozenPosition ?? livePosition(),
      duration: () => duration,
      updateSections(stems) {
        if (stopped) return;
        scheduleSections(stems, Math.max(audioContext.currentTime, startAt));
      },
    };

    request.stems.forEach((stem, index) => {
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      // Section envelope (#1314) lives on its own node so scheduled
      // automation and live manual-gain updates never conflict.
      const sectionGain = audioContext.createGain();
      source.buffer = decoded[index];
      if (loop) {
        // Stems of one separation share a length; a shorter stem would wrap
        // at its own end (the browser clamps loopEnd to the buffer).
        source.loop = true;
        source.loopStart = loop.startSec;
        source.loopEnd = loop.endSec;
      }
      source.connect(gain).connect(sectionGain).connect(output);
      source.onended = () => {
        endedCount += 1;
        // A looping preview only ends through stop().
        if (!loop && !stopped && endedCount >= sources.length) {
          frozenPosition = livePosition();
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
    // Envelopes follow the arrangement at start; `updateSections` re-schedules
    // them live when cells change during playback (#1879).
    scheduleSections(request.stems, startAt);
    for (const source of sources) {
      source.start(startAt, offset);
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
    decodedBuffers.clear();
    master?.compressor.disconnect();
    master?.analyser.disconnect();
    master = null;
    meterData = null;
    const closing = context;
    context = null;
    void closing?.close().catch(() => undefined);
  };

  return { play, preload, bufferDuration, dispose };
}
