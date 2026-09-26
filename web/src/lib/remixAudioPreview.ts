import {
  biquadQDb,
  echoTaps,
  echoTapSpacing,
  generateReverbImpulse,
  normalizeRemixFx,
  remixFxMaster,
  remixFxStem,
  REMIX_FX_ECHO_TAPS,
  REMIX_FX_REVERB_SECONDS,
  REMIX_FX_REVERB_SEEDS,
  REMIX_FX_WARMTH_CURVE_POINTS,
  reverbWet,
  toneFilter,
  warmthCurve,
  type RemixFxRecipe,
} from "./remixFx";
import {
  beatRenderKey,
  beatTrackLength,
  REMIX_BEAT_LANE_ID,
  renderBeatInto,
  type RemixBeatGrid,
  type RemixBeatRecipe,
  type RemixBeatSegment,
} from "./remixBeat";
import {
  isIdentityTimeline,
  masterFadeValueAt,
  REMIX_STRUCTURE_JOIN_FADE_SECONDS,
  type RemixMasterFadeRamp,
  type RemixStructureSegment,
  type RemixStructureTimeline,
} from "./remixStructure";

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

/**
 * The beat (#1902) as the preview plays it: the recipe rendered over the
 * timeline's blocks (timeline time, so never structure-scheduled). A muted
 * recipe (`recipe.muted`) stays in the graph at gain 0, like a muted stem.
 */
export type PreviewBeat = {
  recipe: RemixBeatRecipe;
  grid: RemixBeatGrid;
  segments: RemixBeatSegment[];
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

/**
 * Section spans in OUTPUT time for a varispeed factor (#1897): a source
 * position t plays at t/speed after the source's timeline zero, so the
 * render and the preview both gate at intervals ÷ speed (edge fades stay a
 * fixed output-time length). null/undefined pass through unchanged.
 */
export function outputTimeIntervals(
  intervals: SectionInterval[] | null | undefined,
  speed: number,
): SectionInterval[] | null | undefined {
  if (!intervals || speed === 1) return intervals;
  return intervals.map((interval) => ({
    startSec: interval.startSec / speed,
    endSec: interval.endSec / speed,
  }));
}

/**
 * Source-timeline position while playing at `speed` (#1897): the source
 * advances `speed` seconds per context second from `offsetSec` at
 * `startAt` (before the scheduled start it sits on the offset).
 */
export function sourcePositionAt(input: {
  offsetSec: number;
  startAt: number;
  now: number;
  speed: number;
}): number {
  return input.offsetSec + Math.max(0, input.now - input.startAt) * input.speed;
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

/**
 * A block loop under a structure (#1899): the timeline loop clamped to the
 * block that contains its start, and the matching SOURCE range the looping
 * buffer source cycles. Null when the loop is shorter than `minSeconds`
 * after clamping or starts outside every block.
 */
export function blockLoopSource(
  segments: RemixStructureSegment[],
  loop: PreviewLoop,
  minSeconds = 0.05,
): {
  segment: RemixStructureSegment;
  loop: PreviewLoop;
  srcLoopStartSec: number;
  srcLoopEndSec: number;
} | null {
  const startSec = Math.max(loop.startSec, 0);
  const segment = segments.find(
    (candidate) =>
      candidate.outStartSec <= startSec + 1e-9 && startSec < candidate.outEndSec,
  );
  if (!segment) return null;
  const endSec = Math.min(loop.endSec, segment.outEndSec);
  if (endSec - startSec < minSeconds) return null;
  return {
    segment,
    loop: { startSec, endSec },
    srcLoopStartSec: segment.srcStartSec + (startSec - segment.outStartSec),
    srcLoopEndSec: segment.srcStartSec + (endSec - segment.outStartSec),
  };
}

/**
 * One scheduled block source (#1899): `start(whenSec, offsetSec,
 * durationSec)` in context time with source offsets/durations in buffer
 * time. Timeline position T plays at `startAt + (T − offset)/speed`; a block
 * already under way at the offset starts mid-block.
 */
export type BlockSourcePlan = {
  segment: RemixStructureSegment;
  whenSec: number;
  offsetSec: number;
  durationSec: number;
  /** Apply the 10 ms join fade-in (the block starts from its beginning). */
  fadeIn: boolean;
  fadeOut: boolean;
};

export function planBlockSources(
  segments: RemixStructureSegment[],
  input: { startAt: number; offsetSec: number; speed: number },
): BlockSourcePlan[] {
  const { startAt, offsetSec, speed } = input;
  const plans: BlockSourcePlan[] = [];
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    // Past blocks are skipped; the last one is kept (possibly empty) so a
    // start at the very end still ends through onended.
    if (segment.outEndSec <= offsetSec && !isLast) return;
    const into = Math.max(0, offsetSec - segment.outStartSec);
    const length = segment.srcEndSec - segment.srcStartSec;
    plans.push({
      segment,
      whenSec: startAt + Math.max(0, segment.outStartSec - offsetSec) / speed,
      offsetSec: segment.srcStartSec + Math.min(into, length),
      durationSec: Math.max(0, length - into),
      fadeIn: segment.joinFadeIn && into === 0,
      fadeOut: segment.joinFadeOut && segment.outEndSec > offsetSec,
    });
  });
  return plans;
}

/**
 * Schedule a block's 10 ms join fades (source time, so J/speed in context
 * time) on its own gain param: fade-in from the block start, fade-out
 * ending at the block end.
 */
export function scheduleJoinFades(
  param: SchedulableParam,
  plan: BlockSourcePlan,
  input: { startAt: number; offsetSec: number; speed: number },
  fadeSeconds: number = REMIX_STRUCTURE_JOIN_FADE_SECONDS,
): void {
  const toContext = (sec: number) =>
    input.startAt + (sec - input.offsetSec) / input.speed;
  const { outStartSec, outEndSec } = plan.segment;
  if (plan.fadeIn) {
    param.setValueAtTime(0, toContext(outStartSec));
    param.linearRampToValueAtTime(1, toContext(outStartSec + fadeSeconds));
  }
  if (plan.fadeOut) {
    const fadeStart = Math.max(
      outEndSec - fadeSeconds,
      input.offsetSec,
      plan.fadeIn ? outStartSec + fadeSeconds : outStartSec,
    );
    param.setValueAtTime(1, toContext(Math.min(fadeStart, outEndSec)));
    param.linearRampToValueAtTime(0, toContext(outEndSec));
  }
}

/**
 * Schedule the master fade ramps (#1899) from timeline position
 * `offsetSec`: pins the level at the offset at `startAt`, then each later
 * ramp in context time. A non-final fade-out returns to 1 at its end
 * (unless a ramp starts right there); a `holdAfter` ramp leaves the level
 * at 0 for the effects tail.
 */
export function scheduleMasterFades(
  param: SchedulableParam,
  ramps: RemixMasterFadeRamp[],
  input: { startAt: number; offsetSec: number; speed: number },
): void {
  const toContext = (sec: number) =>
    input.startAt + (sec - input.offsetSec) / input.speed;
  param.setValueAtTime(masterFadeValueAt(ramps, input.offsetSec), input.startAt);
  ramps.forEach((ramp, index) => {
    if (ramp.endSec <= input.offsetSec) return;
    if (ramp.startSec >= input.offsetSec) {
      param.setValueAtTime(ramp.from, toContext(ramp.startSec));
    }
    param.linearRampToValueAtTime(ramp.to, toContext(ramp.endSec));
    if (!ramp.holdAfter && ramp.to !== 1) {
      const next = ramps[index + 1];
      if (!next || next.startSec > ramp.endSec + 1e-9) {
        param.setValueAtTime(1, toContext(ramp.endSec));
      }
    }
  });
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
    /**
     * Live beat level/mute (#1902); absent = the last known beat. A beat
     * that appears or changes its audio needs a restart (new play()).
     */
    beat?: PreviewBeat | null,
  ): void;
  stop(): void;
  level(): PreviewLevel;
  /**
   * Seconds on the timeline (#1879): the source timeline, or the structure's
   * output timeline when one plays (#1899). Wraps inside a loop, clamps to
   * the duration otherwise, and freezes at the last position after stop.
   */
  position(): number;
  /**
   * Longest decoded buffer among the playing stems, in seconds; the
   * structure timeline's duration when one plays (#1899).
   */
  duration(): number;
  /**
   * Live section-cell edits (#1879): re-schedule each playing stem's section
   * envelope from the current position. In loop mode the section gain is a
   * constant (see `play`), so this only recomputes it.
   */
  updateSections(stems: PreviewStemState[]): void;
  /**
   * Live effects edits (#1897): tone, echo, space and warmth update in place
   * and return "applied". A speed (or bpm) change, or effects appearing on a
   * preview started without any, returns "restart": the caller restarts
   * playback at the current source position — the simplest correct option,
   * since the source rate, echo spacing and output-time envelopes all
   * depend on it.
   */
  updateEffects(
    effects: RemixFxRecipe | null,
    bpm?: number | null,
  ): "applied" | "restart";
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
    /**
     * Effects recipe `remix-fx/v1` (#1897); null/absent keeps the plain
     * graph (source → gain → section gain → limiter), with no extra nodes.
     */
    effects?: RemixFxRecipe | null;
    /** Bar-grid tempo for tempo-synced echo; null = the 0.375 s fallback. */
    bpm?: number | null;
    /**
     * Structure timeline `remix-structure/v1` (#1899). Null/absent (or an
     * identity timeline) keeps the plain single-source-per-stem graph.
     * Otherwise `offsetSec`, `loop`, `position()`, `duration()` and the
     * stems' `activeIntervals` (from `gateIntervalsForBlocks`) are all in
     * TIMELINE time; each stem plays one buffer source per block, with
     * 10 ms join-fade gains only where flagged, and a master fade gain
     * (after the reverb return, before master tone) carries the user fades.
     * A loop must lie within a single block: it is clamped to the block
     * containing its start and cycles that block's source range; master
     * fades are held at 1 while looping.
     */
    timeline?: RemixStructureTimeline | null;
    /**
     * Beat `remix-beat/v1` (#1902). Null/absent keeps the graph unchanged.
     * Otherwise ONE extra buffer source plays the beat track (built by
     * `beatBuffer`) from the timeline offset at `speed` → a beat gain
     * (level, mute, solo via `REMIX_BEAT_LANE_ID`; silent while a
     * reference plays) → the master (fade) chain; with effects, into the
     * master bus plus a reverb send of 0.7 × master space. It loops with
     * the timeline loop.
     */
    beat?: PreviewBeat | null;
  }): Promise<StemArrangementPreviewHandle>;
  /**
   * The beat track (#1902) as a mono AudioBuffer at the context's sample
   * rate, rendered with `renderBeatInto` and memoized by
   * `beatRenderKey` (the last one only). Creates the context without
   * resuming it. Null once disposed or without WebAudio.
   */
  beatBuffer(beat: PreviewBeat): AudioBuffer | null;
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
  /**
   * Decode arbitrary audio (e.g. a draft, for its waveform — #1879) on the
   * engine's context, created lazily and never resumed here. Bypasses the
   * stem cache. Rejects once disposed.
   */
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  /**
   * Listening volume (#1910): the linear gain (clamped to 0..1) of the
   * final output stage — after the limiter and the meter's analyser, right
   * before the destination — so the meter still shows the mix level. Applies
   * live to a running preview and to every later play; never restarts.
   * Remembered before the context exists.
   */
  setOutputVolume(gain: number): void;
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

/**
 * Live gain for the beat (#1902): silent while a reference plays, when
 * muted, or while a stem is soloed; its level otherwise (soloing the beat
 * itself — `REMIX_BEAT_LANE_ID` — silences the stems in `stemPreviewGain`).
 */
export function beatPreviewGain(
  beat: Pick<PreviewBeat, "recipe"> | null | undefined,
  soloStemId: string | null,
  referenceStemId: string | null = null,
): number {
  if (!beat || referenceStemId || beat.recipe.muted) return 0;
  if (soloStemId && soloStemId !== REMIX_BEAT_LANE_ID) return 0;
  return dbToLinearGain(beat.recipe.gainDb);
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
  updateEffects: () => "applied",
};

/** Shortest loop the engine will cycle; anything shorter plays unlooped. */
const MIN_LOOP_SECONDS = 0.05;

/**
 * The preview's warmth WaveShaper sees its input pre-scaled by 1/this and a
 * curve stretched over ±this, so summed stems louder than full scale keep
 * the render's tanh shape instead of hitting the curve's end values.
 */
export const PREVIEW_WARMTH_INPUT_RANGE = 4;

function positiveBpm(bpm: number | null | undefined): number | null {
  return typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}

/**
 * Switchable tone stage: `input` feeds a dry gain and a biquad → wet gain,
 * both summed into `output`. No filter = dry 1 / wet 0, i.e. bit-identical
 * bypass, so a live tone edit never changes the graph's topology.
 */
function createToneStage(context: AudioContext, input: AudioNode, nodes: AudioNode[]) {
  const dry = context.createGain();
  const filter = context.createBiquadFilter();
  const wet = context.createGain();
  const output = context.createGain();
  input.connect(dry).connect(output);
  input.connect(filter).connect(wet).connect(output);
  nodes.push(dry, filter, wet, output);
  const set = (tone: number) => {
    const spec = toneFilter(tone);
    if (spec) {
      filter.type = spec.type;
      filter.frequency.value = spec.frequencyHz;
      // WebAudio's lowpass/highpass Q is in dB; see biquadQDb.
      filter.Q.value = biquadQDb(spec.q);
      dry.gain.value = 0;
      wet.gain.value = 1;
    } else {
      dry.gain.value = 1;
      wet.gain.value = 0;
    }
  };
  return { output, filter, dry, wet, set };
}

type StemFxChain = {
  tone: ReturnType<typeof createToneStage>;
  tapGains: GainNode[];
  send: GainNode;
};

type FxGraph = {
  stems: Map<string, StemFxChain>;
  /** The beat's reverb send (#1902); null without a beat. */
  beatSend: GainNode | null;
  masterTone: ReturnType<typeof createToneStage>;
  warmthDry: GainNode;
  warmthWet: GainNode;
  shaper: WaveShaperNode;
  nodes: AudioNode[];
  /**
   * Seconds the graph keeps ringing after the sources end (#1897): the
   * reverb IR length when any send is open, the last echo tap when any echo
   * is on — the max of the two; 0 without either.
   */
  tailSeconds: number;
  speed: number;
  bpm: number | null;
};

/** Apply tone / echo / space / warmth values to a built graph, in place. */
function applyFxValues(graph: FxGraph, effects: RemixFxRecipe | null): void {
  const master = remixFxMaster(effects);
  let tail = 0;
  for (const [stemId, chain] of graph.stems) {
    const stemFx = remixFxStem(effects, stemId);
    chain.tone.set(stemFx.tone);
    const taps = echoTaps(stemFx.echo, graph.bpm, graph.speed);
    chain.tapGains.forEach((tapGain, index) => {
      tapGain.gain.value = taps[index]?.gain ?? 0;
    });
    const wet = reverbWet(stemFx.space, master.space);
    chain.send.gain.value = wet;
    if (wet > 0) tail = Math.max(tail, REMIX_FX_REVERB_SECONDS);
    const lastTap = taps[taps.length - 1];
    if (lastTap) tail = Math.max(tail, lastTap.delaySec);
  }
  if (graph.beatSend) {
    const wet = reverbWet(0, master.space);
    graph.beatSend.gain.value = wet;
    if (wet > 0) tail = Math.max(tail, REMIX_FX_REVERB_SECONDS);
  }
  graph.tailSeconds = tail;
  graph.masterTone.set(master.tone);
  if (master.warmth > 0) {
    graph.shaper.curve = warmthCurve(
      master.warmth,
      REMIX_FX_WARMTH_CURVE_POINTS,
      PREVIEW_WARMTH_INPUT_RANGE,
    );
    graph.warmthDry.gain.value = 0;
    graph.warmthWet.gain.value = 1;
  } else {
    graph.warmthDry.gain.value = 1;
    graph.warmthWet.gain.value = 0;
  }
}

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
    /** Listening volume (#1910), the last stage before the destination. */
    output: GainNode;
  } | null = null;
  let outputVolume = 1;
  let meterData: Float32Array<ArrayBuffer> | null = null;
  // Reverb IR (#1897), generated once per context at its sample rate.
  let reverbImpulse: AudioBuffer | null = null;
  // Beat track (#1902): the last built buffer, by render key.
  let beatCache: { key: string; buffer: AudioBuffer; audibleSec: number } | null =
    null;
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
    const output = created.createGain();
    output.gain.value = outputVolume;
    compressor.connect(analyser).connect(output).connect(created.destination);
    context = created;
    master = { compressor, analyser, output };
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

  const reverbBuffer = (audioContext: AudioContext): AudioBuffer => {
    if (reverbImpulse) return reverbImpulse;
    const rate = audioContext.sampleRate;
    const left = generateReverbImpulse(rate, REMIX_FX_REVERB_SEEDS.left);
    const right = generateReverbImpulse(rate, REMIX_FX_REVERB_SEEDS.right);
    const buffer = audioContext.createBuffer(2, left.length, rate);
    buffer.copyToChannel(Float32Array.from(left), 0);
    buffer.copyToChannel(Float32Array.from(right), 1);
    reverbImpulse = buffer;
    return buffer;
  };

  const beatEntry = (
    audioContext: AudioContext,
    beat: PreviewBeat,
  ): { buffer: AudioBuffer; audibleSec: number } => {
    const rate = audioContext.sampleRate;
    const key = `${rate}:${beatRenderKey(beat.recipe, beat.grid, beat.segments)}`;
    if (beatCache?.key === key) return beatCache;
    const length = Math.max(
      1,
      beatTrackLength(beat.recipe.kit, beat.segments, rate),
    );
    const buffer = audioContext.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    renderBeatInto(data, beat.recipe, beat.grid, beat.segments, rate);
    // The source stops after the last hit has rung out, not after the
    // track's silent padding.
    let last = data.length - 1;
    while (last >= 0 && data[last] === 0) last -= 1;
    beatCache = { key, buffer, audibleSec: (last + 1) / rate };
    return beatCache;
  };

  const beatBuffer: StemPreviewEngine["beatBuffer"] = (beat) => {
    if (disposed) return null;
    try {
      return beatEntry(ensureContext(), beat).buffer;
    } catch {
      return null;
    }
  };

  const decode: StemPreviewEngine["decode"] = async (data) => {
    if (disposed) {
      throw new Error("Audio preview engine was disposed.");
    }
    return ensureContext().decodeAudioData(data);
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
    // Structure (#1899): everything below runs in timeline time.
    const structure =
      request.timeline && !isIdentityTimeline(request.timeline)
        ? request.timeline
        : null;
    const duration = structure
      ? structure.durationSec
      : decoded.reduce((longest, buffer) => Math.max(longest, buffer.duration), 0);
    // Clamp the loop to the audio; a degenerate loop plays unlooped.
    const requestedLoop = request.loop ?? null;
    const structureLoop =
      structure && requestedLoop
        ? blockLoopSource(structure.segments, requestedLoop, MIN_LOOP_SECONDS)
        : null;
    const loop: PreviewLoop | null = structure
      ? structureLoop?.loop ?? null
      : requestedLoop &&
          Math.min(requestedLoop.endSec, duration) -
            Math.max(requestedLoop.startSec, 0) >=
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
    const effects = normalizeRemixFx(request.effects ?? null);
    // Varispeed (#1897): the source plays `speed` source-seconds per
    // context second; pitch follows, like the render.
    const speed = remixFxMaster(effects).speed;
    const bpm = positiveBpm(request.bpm);

    const sources: AudioBufferSourceNode[] = [];
    const gains = new Map<string, GainNode>();
    const sectionGains = new Map<string, GainNode>();
    let stopped = false;
    let endedCount = 0;
    const startAt = audioContext.currentTime + 0.03;
    // Context time of source timeline 0 in OUTPUT time (#1897): source time
    // t plays at startAt + (t − offset)/speed = timelineZero + t/speed.
    const timelineZero = startAt - offset / speed;
    let frozenPosition: number | null = null;
    let fx: FxGraph | null = null;
    // Effects tail hold (#1897): pending release after the sources ended.
    let tailTimer: ReturnType<typeof setTimeout> | null = null;

    const livePosition = (): number => {
      const linear = sourcePositionAt({
        offsetSec: offset,
        startAt,
        now: audioContext.currentTime,
        speed,
      });
      return loop ? wrapLoopPosition(linear, loop) : Math.min(linear, duration);
    };

    // Structure-only nodes (#1899): per-block join gains, master fade.
    const structureNodes: AudioNode[] = [];
    // Beat (#1902): one source + gain, only with an audible beat.
    const beat = request.beat
      ? beatEntry(audioContext, request.beat)
      : null;
    const beatPlays = beat !== null && beat.audibleSec > 0;
    let beatState: PreviewBeat | null = request.beat ?? null;
    const beatGain = beatPlays ? audioContext.createGain() : null;

    const releaseNodes = () => {
      for (const source of sources) source.disconnect();
      for (const gain of gains.values()) gain.disconnect();
      for (const gain of sectionGains.values()) gain.disconnect();
      for (const node of fx?.nodes ?? []) node.disconnect();
      for (const node of structureNodes) node.disconnect();
      beatGain?.disconnect();
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
          // From-zero start: the original envelope (in output time).
          scheduleSectionEnvelope(
            sectionGain.gain,
            outputTimeIntervals(stem.activeIntervals, speed),
            startAt,
          );
        } else {
          scheduleSectionEnvelopeFrom(
            sectionGain.gain,
            outputTimeIntervals(stem.activeIntervals, speed),
            timelineZero,
            now - timelineZero,
            now,
          );
        }
      }
    };

    const handle: StemArrangementPreviewHandle = {
      update(stems, soloStemId, referenceStemId = null, nextBeat) {
        for (const stem of stems) {
          const gain = gains.get(stem.stemId);
          if (gain) {
            gain.gain.value = stemPreviewGain(stem, soloStemId, referenceStemId);
          }
        }
        if (nextBeat !== undefined) beatState = nextBeat;
        if (beatGain) {
          beatGain.gain.value = beatPreviewGain(
            beatState,
            soloStemId,
            referenceStemId,
          );
        }
      },
      stop() {
        if (stopped) return;
        // A stop during the effects tail releases immediately.
        if (tailTimer !== null) {
          clearTimeout(tailTimer);
          tailTimer = null;
        }
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
      updateEffects(nextEffects, nextBpm = null) {
        if (stopped) return "applied";
        const normalized = normalizeRemixFx(nextEffects);
        if (!fx) return normalized === null ? "applied" : "restart";
        if (
          remixFxMaster(normalized).speed !== fx.speed ||
          positiveBpm(nextBpm) !== fx.bpm
        ) {
          return "restart";
        }
        applyFxValues(fx, normalized);
        return "applied";
      },
    };

    // Effects graph (#1897), only when a recipe is set: per stem
    // section gain → tone → echo (dry + 4 explicit taps) → master bus, plus
    // a reverb send into one shared convolver → master bus; then master
    // bus → master tone → warmth → limiter. Every stage is built with
    // bypass gains so live edits never change the topology.
    // Master fade (#1899), structure only: after the master bus sum (reverb
    // return included), before master tone; straight into the limiter
    // without effects.
    let masterFade: GainNode | null = null;
    if (structure) {
      masterFade = audioContext.createGain();
      structureNodes.push(masterFade);
    }
    let stemInput: (stemId: string) => AudioNode = () => masterFade ?? output;
    if (masterFade && !effects) masterFade.connect(output);
    if (effects) {
      const nodes: AudioNode[] = [];
      const masterBus = audioContext.createGain();
      const convolver = audioContext.createConvolver();
      convolver.normalize = false;
      convolver.buffer = reverbBuffer(audioContext);
      convolver.connect(masterBus);
      nodes.push(masterBus, convolver);
      if (masterFade) masterBus.connect(masterFade);
      const masterTone = createToneStage(
        audioContext,
        masterFade ?? masterBus,
        nodes,
      );
      const warmthDry = audioContext.createGain();
      const warmthPre = audioContext.createGain();
      const shaper = audioContext.createWaveShaper();
      const warmthWet = audioContext.createGain();
      shaper.oversample = "none";
      warmthPre.gain.value = 1 / PREVIEW_WARMTH_INPUT_RANGE;
      masterTone.output.connect(warmthDry).connect(output);
      masterTone.output
        .connect(warmthPre)
        .connect(shaper)
        .connect(warmthWet)
        .connect(output);
      nodes.push(warmthDry, warmthPre, shaper, warmthWet);

      // Tap spacing depends only on bpm and speed, fixed for this play.
      const spacing = echoTapSpacing(bpm, speed);
      const stemChains = new Map<string, StemFxChain>();
      const stemInputs = new Map<string, AudioNode>();
      for (const stem of request.stems) {
        if (stemChains.has(stem.stemId)) continue;
        const input = audioContext.createGain();
        nodes.push(input);
        const tone = createToneStage(audioContext, input, nodes);
        const echoOut = audioContext.createGain();
        tone.output.connect(echoOut); // dry
        const tapGains: GainNode[] = [];
        for (let k = 1; k <= REMIX_FX_ECHO_TAPS; k += 1) {
          const delay = audioContext.createDelay(k * spacing + 0.01);
          delay.delayTime.value = k * spacing;
          const tapGain = audioContext.createGain();
          tone.output.connect(delay).connect(tapGain).connect(echoOut);
          tapGains.push(tapGain);
          nodes.push(delay, tapGain);
        }
        const send = audioContext.createGain();
        echoOut.connect(masterBus);
        echoOut.connect(send).connect(convolver);
        nodes.push(echoOut, send);
        stemChains.set(stem.stemId, { tone, tapGains, send });
        stemInputs.set(stem.stemId, input);
      }
      let beatSend: GainNode | null = null;
      if (beatGain) {
        // The beat joins the master bus with its own reverb send (#1902).
        beatSend = audioContext.createGain();
        beatGain.connect(masterBus);
        beatGain.connect(beatSend).connect(convolver);
        nodes.push(beatSend);
      }
      fx = {
        stems: stemChains,
        beatSend,
        masterTone,
        warmthDry,
        warmthWet,
        shaper,
        nodes,
        tailSeconds: 0,
        speed,
        bpm,
      };
      applyFxValues(fx, effects);
      stemInput = (stemId) => stemInputs.get(stemId) ?? masterBus;
    } else if (beatGain) {
      beatGain.connect(masterFade ?? output);
    }

    const onSourceEnded = () => {
      endedCount += 1;
      // A looping preview only ends through stop().
      if (!loop && !stopped && tailTimer === null && endedCount >= sources.length) {
        const finish = () => {
          tailTimer = null;
          if (stopped) return;
          frozenPosition = livePosition();
          stopped = true;
          releaseNodes();
          if (current === handle) current = null;
          request.onEnded?.();
        };
        // Like the render (#1897), keep the graph connected until the
        // reverb/echo tail has rung out; the playhead holds at the end
        // (position clamps to the duration) meanwhile.
        const tail = fx?.tailSeconds ?? 0;
        if (tail > 0) {
          tailTimer = setTimeout(finish, tail * 1000);
        } else {
          finish();
        }
      }
    };
    // Deferred source starts, run after the envelopes are scheduled.
    const starts: Array<() => void> = [];
    const timing = { startAt, offsetSec: offset, speed };

    request.stems.forEach((stem, index) => {
      if (structure) {
        // One buffer source per block (#1899): no audio copies, flat memory.
        const gain = audioContext.createGain();
        const sectionGain = audioContext.createGain();
        gain.connect(sectionGain).connect(stemInput(stem.stemId));
        gains.set(stem.stemId, gain);
        sectionGains.set(stem.stemId, sectionGain);
        if (structureLoop) {
          // A block loop cycles the block's source range on one source.
          const source = audioContext.createBufferSource();
          source.buffer = decoded[index];
          source.loop = true;
          source.loopStart = structureLoop.srcLoopStartSec;
          source.loopEnd = structureLoop.srcLoopEndSec;
          if (speed !== 1) source.playbackRate.value = speed;
          source.connect(gain);
          source.onended = onSourceEnded;
          sources.push(source);
          const entry =
            structureLoop.segment.srcStartSec +
            (offset - structureLoop.segment.outStartSec);
          starts.push(() => source.start(startAt, entry));
          return;
        }
        for (const plan of planBlockSources(structure.segments, timing)) {
          const source = audioContext.createBufferSource();
          source.buffer = decoded[index];
          if (speed !== 1) source.playbackRate.value = speed;
          if (plan.fadeIn || plan.fadeOut) {
            // Click-free join: a small per-block gain, only where flagged.
            const joinGain = audioContext.createGain();
            scheduleJoinFades(joinGain.gain, plan, timing);
            source.connect(joinGain).connect(gain);
            structureNodes.push(joinGain);
          } else {
            source.connect(gain);
          }
          source.onended = onSourceEnded;
          sources.push(source);
          starts.push(() =>
            source.start(plan.whenSec, plan.offsetSec, plan.durationSec),
          );
        }
        return;
      }
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
      if (speed !== 1) source.playbackRate.value = speed;
      source.connect(gain).connect(sectionGain).connect(stemInput(stem.stemId));
      source.onended = onSourceEnded;
      sources.push(source);
      gains.set(stem.stemId, gain);
      sectionGains.set(stem.stemId, sectionGain);
      starts.push(() => source.start(startAt, offset));
    });

    if (beat && beatGain) {
      // Already in timeline time: one source from the offset, never
      // structure-scheduled; it loops with the timeline loop.
      const source = audioContext.createBufferSource();
      source.buffer = beat.buffer;
      if (speed !== 1) source.playbackRate.value = speed;
      source.connect(beatGain);
      source.onended = onSourceEnded;
      sources.push(source);
      if (loop) {
        source.loop = true;
        source.loopStart = loop.startSec;
        source.loopEnd = loop.endSec;
        starts.push(() => source.start(startAt, offset));
      } else {
        const remaining = Math.max(0, beat.audibleSec - offset);
        starts.push(() => source.start(startAt, offset, remaining));
      }
    }

    handle.update(
      request.stems,
      request.soloStemId,
      request.referenceStemId ?? null,
    );
    // Envelopes follow the arrangement at start; `updateSections` re-schedules
    // them live when cells change during playback (#1879).
    scheduleSections(request.stems, startAt);
    if (masterFade) {
      if (loop) {
        // Loops audition the block's audio; fades play in linear playback.
        masterFade.gain.setValueAtTime(1, startAt);
      } else {
        scheduleMasterFades(masterFade.gain, structure?.masterFades ?? [], timing);
      }
    }
    for (const start of starts) start();
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
    master?.output.disconnect();
    master = null;
    meterData = null;
    reverbImpulse = null;
    beatCache = null;
    const closing = context;
    context = null;
    void closing?.close().catch(() => undefined);
  };

  const setOutputVolume = (gain: number) => {
    outputVolume = clampOutputVolume(gain);
    if (!master || !context) return;
    const param = master.output.gain;
    // A short glide keeps a dragged slider free of zipper clicks.
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(
      outputVolume,
      context.currentTime,
      PREVIEW_OUTPUT_VOLUME_SMOOTHING_SECONDS,
    );
  };

  return {
    play,
    preload,
    bufferDuration,
    decode,
    beatBuffer,
    setOutputVolume,
    dispose,
  };
}

/** Time constant of the listening-volume glide (#1910). */
export const PREVIEW_OUTPUT_VOLUME_SMOOTHING_SECONDS = 0.015;

/** Output volume gain on 0..1; non-finite values play at unity. */
export function clampOutputVolume(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(1, Math.max(0, gain));
}
