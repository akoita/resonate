import {
  biquadQDb,
  echoTaps,
  echoTapSpacing,
  generateReverbImpulse,
  normalizeRemixFx,
  remixFxMaster,
  remixFxPitch,
  remixFxStem,
  remixFxStemPro,
  remixFxStretchPlan,
  REMIX_FX_EQ_BANDS,
  REMIX_FX_EQ_BAND_ORDER,
  remixFxVarispeedRate,
  REMIX_FX_ECHO_TAPS,
  REMIX_FX_REVERB_SECONDS,
  REMIX_FX_REVERB_SEEDS,
  REMIX_FX_WARMTH_CURVE_POINTS,
  reverbWet,
  toneFilter,
  warmthCurve,
  type RemixEqBandId,
  type RemixFxRecipe,
} from "./remixFx";
import {
  beatRenderKey,
  beatTimingAtSpeed,
  beatTrackLength,
  REMIX_BEAT_LANE_ID,
  renderBeatInto,
  type RemixBeatGrid,
  type RemixBeatRecipe,
  type RemixBeatSegment,
} from "./remixBeat";
import {
  partLaneId,
  partLengthSeconds,
  partPlacementSpans,
  partStretchPlan,
  REMIX_PART_SPAN_FADE_SECONDS,
  type RemixPartSpan,
} from "./remixParts";
import {
  isIdentityTimeline,
  masterFadeValueAt,
  REMIX_STRUCTURE_JOIN_FADE_SECONDS,
  type RemixMasterFadeRamp,
  type RemixStructureSegment,
  type RemixStructureTimeline,
} from "./remixStructure";
import {
  createStretchPool,
  StretchCancelledError,
  type StretchPool,
} from "./remixStretchPool";

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

/**
 * One AI part (#1901) as the preview plays it: a decoded take (the loop,
 * exactly `bars` bars at the song's tempo, decoded on the engine context
 * with `partTakeBuffer`) placed on the timeline blocks it is on, like the
 * render. Level and mute apply live through `update`.
 */
export type PreviewPart = {
  partId: string;
  role: string;
  takeId: string;
  buffer: AudioBuffer;
  /** Take length in bars: the loop length the placement reads (shared with the render). */
  bars: number;
  gainDb: number;
  muted: boolean;
  /** Per-timeline-block on/off; null = on everywhere. */
  blocks: boolean[] | null;
};

/** Live level/mute of a playing part (#1901), by part id. */
export type PreviewPartState = Pick<PreviewPart, "partId" | "gainDb" | "muted">;

/** The bar grid + timeline blocks the parts are placed on (#1901). */
export type PreviewPartTimeline = {
  grid: RemixBeatGrid;
  segments: RemixBeatSegment[];
};

/** A part take to time-stretch ahead of play (#1898, #1901). */
export type PreviewStretchPart = {
  takeId: string;
  role: string;
  buffer: AudioBuffer;
};

/** Store id of a part take in the stretched-buffer store (#1901). */
export function partStretchItemId(takeId: string): string {
  return `part:${takeId}`;
}

/**
 * One scheduled part source (#1901) for a span: it starts at `whenSec`
 * (context time) at `phaseSec` into the loop (buffer time; 0 unless play
 * starts inside the span), loops the whole buffer and stops at `stopSec`.
 * `fade` is the 10 ms fade-out (context times) where the span cuts the loop.
 */
export type PartSourcePlan = {
  span: RemixPartSpan;
  whenSec: number;
  phaseSec: number;
  stopSec: number;
  fade: { startSec: number; endSec: number } | null;
};

/**
 * Part span sources for a play (#1901): timeline position T plays at
 * `startAt + (T − offset)/speed`; spans already over at the offset are
 * skipped, one under way starts mid-loop (the loop phase in buffer time is
 * the time into the span ÷ `tempo` modulo the loop's buffer length). The
 * fade-out is 10 ms of TIMELINE time, like the render's part track.
 */
export function planPartSources(
  spans: RemixPartSpan[],
  input: {
    startAt: number;
    offsetSec: number;
    speed: number;
    /** Stretch tempo of the buffer (1 = timeline time). */
    tempo: number;
    /** The loop's length in buffer time (the buffer's duration). */
    loopBufferSec: number;
  },
): PartSourcePlan[] {
  const { startAt, offsetSec, speed, tempo, loopBufferSec } = input;
  const toContext = (sec: number) => startAt + (sec - offsetSec) / speed;
  const plans: PartSourcePlan[] = [];
  for (const span of spans) {
    if (span.outEndSec <= offsetSec) continue;
    const into = Math.max(0, offsetSec - span.outStartSec);
    const phase = loopBufferSec > 0 ? (into / tempo) % loopBufferSec : 0;
    const fadeStart = Math.max(
      span.outEndSec - REMIX_PART_SPAN_FADE_SECONDS,
      span.outStartSec,
      offsetSec,
    );
    plans.push({
      span,
      whenSec: startAt + Math.max(0, span.outStartSec - offsetSec) / speed,
      phaseSec: phase,
      stopSec: toContext(span.outEndSec),
      fade: span.fadeOut
        ? { startSec: toContext(fadeStart), endSec: toContext(span.outEndSec) }
        : null,
    });
  }
  return plans;
}

/**
 * A part's audio over one timeline loop (#1901), for looped playback: the
 * loop range [startSec, endSec) of the part's track, in BUFFER time (÷
 * `tempo`), as channel data one looping source can cycle. Frames follow the
 * render's rules — the loop restarts at phase 0 at each span start and a
 * cut span fades out over its last 10 ms (÷ tempo). Memory: one timeline
 * loop (a loop lies within one block). Null when no span overlaps it.
 */
export function partLoopChannels(
  source: Float32Array[],
  sampleRate: number,
  spans: RemixPartSpan[],
  loop: PreviewLoop,
  tempo: number,
): Float32Array[] | null {
  const loopFrames = source[0]?.length ?? 0;
  if (loopFrames === 0) return null;
  const frame = (sec: number) => Math.round((sec / tempo) * sampleRate);
  const a0 = frame(loop.startSec);
  const a1 = frame(loop.endSec);
  if (a1 <= a0) return null;
  const overlapping = spans.filter(
    (span) => frame(span.outStartSec) < a1 && frame(span.outEndSec) > a0,
  );
  if (overlapping.length === 0) return null;
  const out = source.map(() => new Float32Array(a1 - a0));
  const fadeLength = frame(REMIX_PART_SPAN_FADE_SECONDS);
  for (const span of overlapping) {
    const s0 = frame(span.outStartSec);
    const s1 = frame(span.outEndSec);
    const fadeFrames = span.fadeOut ? Math.min(fadeLength, s1 - s0) : 0;
    for (let f = Math.max(s0, a0); f < Math.min(s1, a1); f += 1) {
      const phase = (f - s0) % loopFrames;
      const gain = fadeFrames > 0 && f >= s1 - fadeFrames ? (s1 - f) / fadeFrames : 1;
      source.forEach((channel, c) => {
        out[c][f - a0] = channel[phase] * gain;
      });
    }
  }
  return out;
}

/** Take buffers kept decoded by the engine (#1901), least recently used out. */
export const PREVIEW_PART_TAKE_CACHE_SIZE = 8;

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

/** A time-stretch stage (#1898), as `remixFxStretchPlan` returns it. */
export type PreviewStretchPlan = { tempo: number; semitones: number };

/** Outcome of preparing stretched stems (#1898). */
export type StretchPrepareResult = "ready" | "cancelled" | "failed";

/**
 * Store key of one stretched stem (#1898): `stemId | tempo | semitones |
 * sampleRate`; everything that changes the stretched audio.
 */
export function stretchVariantKey(
  stemId: string,
  plan: PreviewStretchPlan,
  sampleRate: number,
): string {
  return `${stemId}|${plan.tempo}|${plan.semitones}|${sampleRate}`;
}

/**
 * Source time → the stretched buffer's time (#1898): a stem stretched by
 * `tempo` holds source second t at t ÷ tempo (the render seeks its
 * stretched files the same way).
 */
export function stretchedSourceSec(sec: number, tempo: number): number {
  return tempo === 1 ? sec : sec / tempo;
}

/** A source span (loop range) in the stretched buffer's time (#1898). */
export function stretchedSpan(
  span: PreviewLoop,
  tempo: number,
): PreviewLoop {
  return {
    startSec: stretchedSourceSec(span.startSec, tempo),
    endSec: stretchedSourceSec(span.endSec, tempo),
  };
}

/**
 * A block source plan on a stretched buffer (#1898): the buffer offset and
 * duration move to stretched time; when it starts (context time) and its
 * timeline segment don't change.
 */
export function stretchedBlockPlan(
  plan: BlockSourcePlan,
  tempo: number,
): BlockSourcePlan {
  if (tempo === 1) return plan;
  return {
    ...plan,
    offsetSec: stretchedSourceSec(plan.offsetSec, tempo),
    durationSec: stretchedSourceSec(plan.durationSec, tempo),
  };
}

/**
 * The join fade's length on the timeline for stretched blocks (#1898): the
 * render fades 10 ms of the STRETCHED file, which is 10 ms × tempo of
 * timeline (source) time.
 */
export function stretchedJoinFadeSeconds(
  tempo: number,
  fadeSeconds: number = REMIX_STRUCTURE_JOIN_FADE_SECONDS,
): number {
  return fadeSeconds * tempo;
}

/**
 * How the beat track plays for a recipe (#1898). With keepPitch it is
 * synthesized in OUTPUT time (`beatTimingAtSpeed`: timeline ÷ speed) and
 * plays at rate 1 from timeline offset ÷ speed, never transposed, like the
 * render; otherwise it is timeline-time audio at the varispeed rate.
 */
export function beatPlayback(effects: RemixFxRecipe | null | undefined): {
  /** The speed the beat is synthesized at (1 = timeline time). */
  timingSpeed: number;
  /** Its source's playbackRate. */
  rate: number;
} {
  const speed = remixFxMaster(effects).speed;
  const timingSpeed = remixFxPitch(effects).keepPitch ? speed : 1;
  return { timingSpeed, rate: speed / timingSpeed };
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
    /**
     * Live AI part levels/mutes (#1901) by part id; absent = the last known.
     * Parts appearing or changing what they play need a restart.
     */
    parts?: PreviewPartState[] | null,
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
   * and return "applied". A speed (or bpm) change, a Keep original pitch or
   * key change (#1898), or effects appearing on a preview started without
   * any, returns "restart": the caller restarts playback at the current
   * source position — the simplest correct option, since the source rate,
   * the stretched buffers, echo spacing and output-time envelopes all
   * depend on it.
   */
  updateEffects(
    effects: RemixFxRecipe | null,
    bpm?: number | null,
  ): "applied" | "restart";
  /**
   * Tempo/key still pending (#1898): the recipe needs a time-stretch but
   * some audible stem had no stretched buffer ready when this started, so
   * everything plays the varispeed fallback (right timing, no key shift).
   * The caller restarts once `prepareStretch` is done.
   */
  stretchPending(): boolean;
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
     * Effects recipe `remix-fx/v2` (#1897, #1898); null/absent keeps the plain
     * graph (source → gain → section gain → limiter), with no extra nodes.
     * A recipe with a time-stretch stage (`remixFxStretchPlan`) plays the
     * stems' stretched buffers (see `prepareStretch`) at the varispeed rate
     * when every audible stem has one ready — source offsets, loop ranges
     * and block spans move to stretched time (÷ tempo), while the timeline
     * and everything scheduled on it (position, gates, echo, fades) is
     * unchanged. A muted stem without one is left out. Otherwise it plays
     * the varispeed path at `speed` without the key shift and the handle
     * reports `stretchPending()`.
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
     * the timeline loop. With keepPitch (#1898) the track is synthesized in
     * output time and plays at rate 1 (see `beatPlayback`).
     */
    beat?: PreviewBeat | null;
    /**
     * AI parts `remix-parts/v1` (#1901) with their decoded takes, placed on
     * `partTimeline` (bar grid + timeline blocks) exactly like the render
     * (`partPlacementSpans`). Null/absent (or no timeline) keeps the graph
     * unchanged. Per span, one looping buffer source starts at the span's
     * context time from loop phase 0 (mid-loop when play starts inside it)
     * and stops at its end, with the 10 ms fade-out gain where flagged →
     * a part gain (level, mute, solo via `partLaneId`; silent while a
     * reference plays) → the master (fade) chain; with effects, into the
     * master bus plus a 0.7 × master space reverb send. A timeline loop
     * cycles the part's audio over that loop. Tempo/key: parts play their
     * stretched buffers (per-item plan: drums tempo only) in the stretched
     * path and count toward its readiness like stems.
     */
    parts?: PreviewPart[] | null;
    partTimeline?: PreviewPartTimeline | null;
  }): Promise<StemArrangementPreviewHandle>;
  /**
   * Time-stretch the stems for a plan (#1898) in the worker pool, ahead of
   * play. Keeps ONLY the current plan's stretched buffers: a new plan (or
   * null) cancels the previous plan's jobs and drops its buffers. Idempotent
   * for the same plan: stems already stretched or in flight are not redone.
   * Decodes stems as needed (a stem that can't be decoded is skipped, as in
   * preload). `onProgress` gets the share done across these stems (0..1).
   * Resolves "cancelled" when superseded by another plan or disposed, and
   * "failed" when a stretch failed (a later call retries it).
   */
  prepareStretch(
    plan: PreviewStretchPlan | null,
    stemIds: string[],
    onProgress?: (fraction: number) => void,
    /**
     * AI part takes (#1901) stretched alongside, each with its own plan
     * (`partStretchPlan`: drums tempo only; an identity plan needs nothing).
     */
    parts?: PreviewStretchPart[],
  ): Promise<StretchPrepareResult>;
  /**
   * Whether every stem in `stemIds` (and every part take in `parts`) has its
   * stretched buffer for `plan`.
   */
  stretchReady(
    plan: PreviewStretchPlan | null,
    stemIds: string[],
    parts?: Array<Pick<PreviewStretchPart, "takeId" | "role">>,
  ): boolean;
  /**
   * A part take (#1901) decoded on the engine's context, created lazily and
   * never resumed here: `load` fetches the bytes on a miss. The last
   * {@link PREVIEW_PART_TAKE_CACHE_SIZE} takes stay cached (LRU); a failed
   * load is not cached. Rejects once disposed.
   */
  partTakeBuffer(
    takeId: string,
    load: () => Promise<ArrayBuffer>,
  ): Promise<AudioBuffer>;
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
 * Live gain for an AI part (#1901): silent while a reference plays, when
 * muted, or while any other lane is soloed; its level otherwise (soloing the
 * part — `partLaneId` — silences the stems and the beat).
 */
export function partPreviewGain(
  part: PreviewPartState | null | undefined,
  soloStemId: string | null,
  referenceStemId: string | null = null,
): number {
  if (!part || referenceStemId || part.muted) return 0;
  if (soloStemId && soloStemId !== partLaneId(part.partId)) return 0;
  return dbToLinearGain(part.gainDb);
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
  stretchPending: () => false,
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

/**
 * Pro stages of one source stem (#1903 S6a), in chain order EQ low → mid →
 * high → (2-channel up-mix) → pan, between the stem's gain and its section
 * gain. Each node exists only when its value was non-default at play: a stem
 * without Pro fields gets none, so such previews stay byte-identical.
 */
export type StemProStage = {
  input: AudioNode;
  output: AudioNode;
  eq: Partial<Record<RemixEqBandId, BiquadFilterNode>>;
  panner: StereoPannerNode | null;
};

/**
 * Builds a stem's Pro stage for `effects`, or null when it has no Pro
 * field. Biquads follow the Web Audio spec (shelves ignore Q; the peaking
 * band's Q is linear); a 2-channel "speakers" GainNode up-mixes a mono stem
 * at unity before the StereoPannerNode so its stereo law applies, like the
 * render's explicit up-mix.
 */
export function createStemProStage(
  context: BaseAudioContext,
  effects: RemixFxRecipe | null,
  stemId: string,
  nodes: AudioNode[],
): StemProStage | null {
  const pro = remixFxStemPro(effects, stemId);
  const chain: AudioNode[] = [];
  const eq: StemProStage["eq"] = {};
  for (const band of REMIX_FX_EQ_BAND_ORDER) {
    const spec = REMIX_FX_EQ_BANDS[band];
    if (pro[spec.key] === 0) continue;
    const filter = context.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.value = spec.frequencyHz;
    if (spec.q !== undefined) filter.Q.value = spec.q;
    eq[band] = filter;
    chain.push(filter);
  }
  let panner: StereoPannerNode | null = null;
  if (pro.pan !== 0) {
    const upmix = context.createGain();
    upmix.channelCount = 2;
    upmix.channelCountMode = "explicit";
    upmix.channelInterpretation = "speakers";
    panner = context.createStereoPanner();
    chain.push(upmix, panner);
  }
  if (chain.length === 0) return null;
  for (let index = 1; index < chain.length; index += 1) {
    chain[index - 1].connect(chain[index]);
  }
  nodes.push(...chain);
  const stage: StemProStage = {
    input: chain[0],
    output: chain[chain.length - 1],
    eq,
    panner,
  };
  applyStemProValues(stage, effects, stemId);
  return stage;
}

/** Live EQ gains and pan on a built Pro stage (0 = neutral). */
export function applyStemProValues(
  stage: StemProStage,
  effects: RemixFxRecipe | null,
  stemId: string,
): void {
  const pro = remixFxStemPro(effects, stemId);
  for (const band of REMIX_FX_EQ_BAND_ORDER) {
    const filter = stage.eq[band];
    if (filter) filter.gain.value = pro[REMIX_FX_EQ_BANDS[band].key];
  }
  if (stage.panner) stage.panner.pan.value = pro.pan;
}

/**
 * Whether a built stage can play `effects` live: every non-default Pro
 * value needs its node. A missing node (a band or pan turned on after the
 * play started) needs a restart.
 */
export function stemProStageCovers(
  stage: StemProStage | undefined,
  effects: RemixFxRecipe | null,
  stemId: string,
): boolean {
  const pro = remixFxStemPro(effects, stemId);
  for (const band of REMIX_FX_EQ_BAND_ORDER) {
    if (pro[REMIX_FX_EQ_BANDS[band].key] !== 0 && !stage?.eq[band]) return false;
  }
  return pro.pan === 0 || !!stage?.panner;
}

type StemFxChain = {
  tone: ReturnType<typeof createToneStage>;
  tapGains: GainNode[];
  send: GainNode;
};

type FxGraph = {
  stems: Map<string, StemFxChain>;
  /** Pro stages by stem id (#1903); only stems with Pro fields at play. */
  pro: Map<string, StemProStage>;
  /** The beat's reverb send (#1902); null without a beat. */
  beatSend: GainNode | null;
  /** The AI parts' reverb sends (#1901). */
  partSends: GainNode[];
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
  for (const [stemId, stage] of graph.pro) {
    applyStemProValues(stage, effects, stemId);
  }
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
  for (const send of graph.partSends) {
    const wet = reverbWet(0, master.space);
    send.gain.value = wet;
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
  /** Stretch worker pool (#1898), created on the first `prepareStretch`. */
  stretchPoolFactory?: () => StretchPool;
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
  // Time-stretched stems (#1898): only the current plan's, by variant key,
  // plus its in-flight jobs by stem id. Source buffers stay cached above.
  let stretchPool: StretchPool | null = null;
  let stretchPlanKey: string | null = null;
  const stretchedBuffers = new Map<string, AudioBuffer>();
  const stretchJobs = new Map<
    string,
    {
      jobId: string;
      listeners: Set<(fraction: number) => void>;
      promise: Promise<StretchPrepareResult>;
    }
  >();
  let stretchJobCount = 0;
  // AI part takes (#1901): decoded on this context, LRU by take id.
  const partTakes = new Map<string, Promise<AudioBuffer>>();
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
    // keepPitch (#1898): synthesized in output time at this speed.
    timingSpeed = 1,
  ): { buffer: AudioBuffer; audibleSec: number } => {
    const rate = audioContext.sampleRate;
    const { grid, segments } = beatTimingAtSpeed(
      beat.grid,
      beat.segments,
      timingSpeed,
    );
    // The timing speed is 1 without keepPitch (the beat doesn't depend on
    // the speed then), the speed with it.
    const key = `${rate}:${timingSpeed}:${beatRenderKey(beat.recipe, grid, segments)}`;
    if (beatCache?.key === key) return beatCache;
    const length = Math.max(1, beatTrackLength(beat.recipe.kit, segments, rate));
    const buffer = audioContext.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    renderBeatInto(data, beat.recipe, grid, segments, rate);
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

  const planKeyFor = (plan: PreviewStretchPlan, sampleRate: number) =>
    stretchVariantKey("", plan, sampleRate);

  /** Switch the store to a plan: another plan's jobs and buffers go. */
  const switchStretchPlan = (planKey: string | null) => {
    if (planKey === stretchPlanKey) return;
    stretchPlanKey = planKey;
    const inFlight = [...stretchJobs.values()].map((job) => job.jobId);
    stretchJobs.clear();
    stretchedBuffers.clear();
    stretchPool?.cancel(inFlight);
  };

  /**
   * Stretch one store item (a stem, or a part take `part:{takeId}`, #1901)
   * with its own plan; `loadSource` gives its unstretched buffer.
   */
  const startStretchJob = (
    audioContext: AudioContext,
    stemId: string,
    plan: PreviewStretchPlan,
    planKey: string,
    loadSource: () => Promise<AudioBuffer> = () => loadBuffer(audioContext, stemId),
  ) => {
    const sampleRate = audioContext.sampleRate;
    const jobId = `stretch-${(stretchJobCount += 1)}`;
    const listeners = new Set<(fraction: number) => void>();
    const current = () => !disposed && stretchPlanKey === planKey;
    const promise = (async (): Promise<StretchPrepareResult> => {
      try {
        let source: AudioBuffer;
        try {
          source = await loadSource();
        } catch {
          // Undecodable stems stay skipped, as in preload; play() reports.
          return "ready";
        }
        if (!current()) return "cancelled";
        stretchPool ??= (input.stretchPoolFactory ?? (() => createStretchPool()))();
        const out = await stretchPool.run(
          {
            jobId,
            sampleRate,
            tempo: plan.tempo,
            semitones: plan.semitones,
            // Copied when a worker takes the job, then transferred to it.
            channels: () =>
              Array.from({ length: source.numberOfChannels }, (_, c) =>
                source.getChannelData(c).slice(),
              ),
          },
          (fraction) => listeners.forEach((listener) => listener(fraction)),
        );
        if (!current() || !context) return "cancelled";
        const length = Math.max(1, out[0]?.length ?? 0);
        const buffer = context.createBuffer(out.length, length, sampleRate);
        out.forEach((channel, c) =>
          buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c),
        );
        stretchedBuffers.set(stretchVariantKey(stemId, plan, sampleRate), buffer);
        listeners.forEach((listener) => listener(1));
        return "ready";
      } catch (error) {
        return error instanceof StretchCancelledError || !current()
          ? "cancelled"
          : "failed";
      } finally {
        if (stretchJobs.get(stemId)?.jobId === jobId) stretchJobs.delete(stemId);
      }
    })();
    const job = { jobId, listeners, promise };
    stretchJobs.set(stemId, job);
    return job;
  };

  const prepareStretch: StemPreviewEngine["prepareStretch"] = async (
    plan,
    stemIds,
    onProgress,
    parts = [],
  ) => {
    if (disposed) return "cancelled";
    if (!plan) {
      switchStretchPlan(null);
      return "ready";
    }
    let audioContext: AudioContext;
    try {
      audioContext = ensureContext();
    } catch {
      return "failed";
    }
    const sampleRate = audioContext.sampleRate;
    const planKey = planKeyFor(plan, sampleRate);
    switchStretchPlan(planKey);
    // Every store item with its own plan: stems take the recipe plan, part
    // takes (#1901) their per-role plan; an identity part plan needs nothing.
    const items = new Map<
      string,
      { plan: PreviewStretchPlan; load?: () => Promise<AudioBuffer> }
    >();
    for (const stemId of stemIds) items.set(stemId, { plan });
    for (const part of parts) {
      const itemPlan = partStretchPlan(part.role, plan);
      if (!itemPlan) continue;
      const buffer = part.buffer;
      items.set(partStretchItemId(part.takeId), {
        plan: itemPlan,
        load: async () => buffer,
      });
    }
    const ids = [...items.keys()];
    const done = new Map<string, number>();
    const report = () => {
      if (!onProgress || ids.length === 0) return;
      let sum = 0;
      for (const fraction of done.values()) sum += fraction;
      onProgress(Math.min(1, sum / ids.length));
    };
    const tasks = ids.map((itemId) => {
      const item = items.get(itemId)!;
      if (stretchedBuffers.has(stretchVariantKey(itemId, item.plan, sampleRate))) {
        done.set(itemId, 1);
        return "ready" as const;
      }
      const job =
        stretchJobs.get(itemId) ??
        startStretchJob(audioContext, itemId, item.plan, planKey, item.load);
      job.listeners.add((fraction) => {
        done.set(itemId, fraction);
        report();
      });
      return job.promise;
    });
    report();
    const results = await Promise.all(tasks);
    if (disposed || stretchPlanKey !== planKey || results.includes("cancelled")) {
      return "cancelled";
    }
    return results.includes("failed") ? "failed" : "ready";
  };

  const stretchReady: StemPreviewEngine["stretchReady"] = (
    plan,
    stemIds,
    parts = [],
  ) => {
    if (!plan) return true;
    if (!context) return false;
    const sampleRate = context.sampleRate;
    return (
      stretchPlanKey === planKeyFor(plan, sampleRate) &&
      stemIds.every((stemId) =>
        stretchedBuffers.has(stretchVariantKey(stemId, plan, sampleRate)),
      ) &&
      parts.every((part) => {
        const itemPlan = partStretchPlan(part.role, plan);
        return (
          !itemPlan ||
          stretchedBuffers.has(
            stretchVariantKey(partStretchItemId(part.takeId), itemPlan, sampleRate),
          )
        );
      })
    );
  };

  const partTakeBuffer: StemPreviewEngine["partTakeBuffer"] = (takeId, load) => {
    if (disposed) {
      return Promise.reject(new Error("Audio preview engine was disposed."));
    }
    const cached = partTakes.get(takeId);
    if (cached) {
      // Most recently used goes last.
      partTakes.delete(takeId);
      partTakes.set(takeId, cached);
      return cached;
    }
    let audioContext: AudioContext;
    try {
      audioContext = ensureContext();
    } catch (error) {
      return Promise.reject(error);
    }
    const pending = (async () => audioContext.decodeAudioData(await load()))();
    partTakes.set(takeId, pending);
    while (partTakes.size > PREVIEW_PART_TAKE_CACHE_SIZE) {
      const oldest = partTakes.keys().next().value as string;
      partTakes.delete(oldest);
    }
    // A failed fetch/decode is not cached: the next call retries.
    pending.catch(() => {
      if (partTakes.get(takeId) === pending) partTakes.delete(takeId);
    });
    return pending;
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
    const pitch = remixFxPitch(effects);
    // Tempo/key (#1898): the stretched buffers of this plan, when every
    // audible stem has one; else the varispeed fallback (key shift pending).
    // A muted stem without one is left out (it is silent anyway).
    const stretchPlan = remixFxStretchPlan(effects);
    // AI parts (#1901): placed on the part timeline like the render.
    const partTimeline = request.partTimeline ?? null;
    const requestedParts =
      partTimeline && positiveBpm(partTimeline.grid.bpm) ? request.parts ?? [] : [];
    let stretched: Array<AudioBuffer | null> | null = null;
    // Per part: its buffer and stretch tempo in the stretched path (drums
    // take the tempo only; an identity plan plays the take as is).
    let stretchedParts: Array<{ buffer: AudioBuffer | null; tempo: number }> | null =
      null;
    if (stretchPlan) {
      const sampleRate = audioContext.sampleRate;
      const planReady = stretchPlanKey === planKeyFor(stretchPlan, sampleRate);
      const variants = request.stems.map((stem) =>
        planReady
          ? stretchedBuffers.get(
              stretchVariantKey(stem.stemId, stretchPlan, sampleRate),
            ) ?? null
          : null,
      );
      const partVariants = requestedParts.map((part) => {
        const itemPlan = partStretchPlan(part.role, stretchPlan);
        if (!itemPlan) return { buffer: part.buffer, tempo: 1 };
        return {
          buffer: planReady
            ? stretchedBuffers.get(
                stretchVariantKey(
                  partStretchItemId(part.takeId),
                  itemPlan,
                  sampleRate,
                ),
              ) ?? null
            : null,
          tempo: itemPlan.tempo,
        };
      });
      if (
        request.stems.every((stem, index) => variants[index] || stem.muted) &&
        requestedParts.every((part, index) => partVariants[index].buffer || part.muted)
      ) {
        stretched = variants;
        stretchedParts = partVariants;
      }
    }
    const pendingStretch = stretchPlan !== null && stretched === null;
    // Stretched buffers hold source time t at t ÷ tempo and play at the
    // varispeed rate; the fallback plays the sources at `speed`.
    const tempo = stretched && stretchPlan ? stretchPlan.tempo : 1;
    const sourceRate = stretched ? remixFxVarispeedRate(effects) : speed;
    const joinFadeSeconds = stretchedJoinFadeSeconds(tempo);
    const beatTiming = beatPlayback(effects);

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
      ? beatEntry(audioContext, request.beat, beatTiming.timingSpeed)
      : null;
    const beatPlays = beat !== null && beat.audibleSec > 0;
    let beatState: PreviewBeat | null = request.beat ?? null;
    const beatGain = beatPlays ? audioContext.createGain() : null;

    // AI parts (#1901): what each part plays — its (stretched) buffer, the
    // tempo that buffer is stretched by, its source rate and its spans.
    // A muted part without its stretched buffer sits this play out.
    const partStates = new Map<string, PreviewPartState>(
      requestedParts.map((part) => [
        part.partId,
        { partId: part.partId, gainDb: part.gainDb, muted: part.muted },
      ]),
    );
    const partPlays = requestedParts.flatMap((part, index) => {
      const variant = stretchedParts ? stretchedParts[index] : null;
      const buffer = variant ? variant.buffer : part.buffer;
      if (!buffer || !partTimeline) return [];
      const spans = partPlacementSpans(
        part,
        partTimeline.grid,
        partTimeline.segments,
        partLengthSeconds(partTimeline.grid.bpm as number, part.bars),
      );
      if (spans.length === 0) return [];
      return [
        {
          part,
          buffer,
          tempo: variant ? variant.tempo : 1,
          rate: stretchedParts ? sourceRate : speed,
          spans,
          gain: audioContext.createGain(),
        },
      ];
    });
    const partGains = new Map(partPlays.map((play) => [play.part.partId, play.gain]));
    const partNodes: AudioNode[] = [];

    const releaseNodes = () => {
      for (const source of sources) source.disconnect();
      for (const gain of gains.values()) gain.disconnect();
      for (const gain of sectionGains.values()) gain.disconnect();
      for (const node of fx?.nodes ?? []) node.disconnect();
      for (const node of structureNodes) node.disconnect();
      beatGain?.disconnect();
      for (const gain of partGains.values()) gain.disconnect();
      for (const node of partNodes) node.disconnect();
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
      update(stems, soloStemId, referenceStemId = null, nextBeat, nextParts) {
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
        for (const next of nextParts ?? []) {
          if (partStates.has(next.partId)) {
            partStates.set(next.partId, {
              partId: next.partId,
              gainDb: next.gainDb,
              muted: next.muted,
            });
          }
        }
        for (const [partId, gain] of partGains) {
          gain.gain.value = partPreviewGain(
            partStates.get(partId),
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
        const nextPitch = remixFxPitch(normalized);
        const graph = fx;
        if (
          remixFxMaster(normalized).speed !== fx.speed ||
          positiveBpm(nextBpm) !== fx.bpm ||
          // Tempo/key (#1898) pick the buffers and the beat timing.
          nextPitch.keepPitch !== pitch.keepPitch ||
          nextPitch.semitones !== pitch.semitones ||
          // Pro (#1903): a band or pan turned on needs its node.
          [...fx.stems.keys()].some(
            (stemId) =>
              !stemProStageCovers(graph.pro.get(stemId), normalized, stemId),
          )
        ) {
          return "restart";
        }
        applyFxValues(fx, normalized);
        return "applied";
      },
      stretchPending: () => pendingStretch,
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
      // Pro stages (#1903): only for stems with Pro fields at play.
      const proStages = new Map<string, StemProStage>();
      for (const stem of request.stems) {
        if (proStages.has(stem.stemId)) continue;
        const stage = createStemProStage(audioContext, effects, stem.stemId, nodes);
        if (stage) proStages.set(stem.stemId, stage);
      }
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
      // AI parts (#1901) join the master bus with their own reverb sends.
      const partSends: GainNode[] = [];
      for (const gain of partGains.values()) {
        const send = audioContext.createGain();
        gain.connect(masterBus);
        gain.connect(send).connect(convolver);
        partSends.push(send);
        nodes.push(send);
      }
      fx = {
        stems: stemChains,
        pro: proStages,
        beatSend,
        partSends,
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
    } else {
      beatGain?.connect(masterFade ?? output);
      for (const gain of partGains.values()) gain.connect(masterFade ?? output);
    }

    // Pro (#1903): gain → [EQ → up-mix → pan] → section gain, so the Pro
    // stages sit where the render puts them (before the section gate).
    const connectThroughPro = (
      stemId: string,
      gain: GainNode,
      sectionGain: GainNode,
    ): GainNode => {
      const stage = fx?.pro.get(stemId);
      if (stage) {
        gain.connect(stage.input);
        stage.output.connect(sectionGain);
      } else {
        gain.connect(sectionGain);
      }
      return sectionGain;
    };
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
      const buffer = stretched ? stretched[index] : decoded[index];
      // A muted stem without its stretched buffer sits this play out.
      if (!buffer) return;
      if (structure) {
        // One buffer source per block (#1899): no audio copies, flat memory.
        const gain = audioContext.createGain();
        const sectionGain = audioContext.createGain();
        connectThroughPro(stem.stemId, gain, sectionGain).connect(
          stemInput(stem.stemId),
        );
        gains.set(stem.stemId, gain);
        sectionGains.set(stem.stemId, sectionGain);
        if (structureLoop) {
          // A block loop cycles the block's source range on one source.
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const range = stretchedSpan(
            {
              startSec: structureLoop.srcLoopStartSec,
              endSec: structureLoop.srcLoopEndSec,
            },
            tempo,
          );
          source.loopStart = range.startSec;
          source.loopEnd = range.endSec;
          if (sourceRate !== 1) source.playbackRate.value = sourceRate;
          source.connect(gain);
          source.onended = onSourceEnded;
          sources.push(source);
          const entry = stretchedSourceSec(
            structureLoop.segment.srcStartSec +
              (offset - structureLoop.segment.outStartSec),
            tempo,
          );
          starts.push(() => source.start(startAt, entry));
          return;
        }
        for (const block of planBlockSources(structure.segments, timing)) {
          const plan = stretchedBlockPlan(block, tempo);
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          if (sourceRate !== 1) source.playbackRate.value = sourceRate;
          if (plan.fadeIn || plan.fadeOut) {
            // Click-free join: a small per-block gain, only where flagged.
            const joinGain = audioContext.createGain();
            scheduleJoinFades(joinGain.gain, plan, timing, joinFadeSeconds);
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
      source.buffer = buffer;
      if (loop) {
        // Stems of one separation share a length; a shorter stem would wrap
        // at its own end (the browser clamps loopEnd to the buffer).
        const range = stretchedSpan(loop, tempo);
        source.loop = true;
        source.loopStart = range.startSec;
        source.loopEnd = range.endSec;
      }
      if (sourceRate !== 1) source.playbackRate.value = sourceRate;
      source.connect(gain);
      connectThroughPro(stem.stemId, gain, sectionGain).connect(
        stemInput(stem.stemId),
      );
      source.onended = onSourceEnded;
      sources.push(source);
      gains.set(stem.stemId, gain);
      sectionGains.set(stem.stemId, sectionGain);
      starts.push(() => source.start(startAt, stretchedSourceSec(offset, tempo)));
    });

    if (beat && beatGain) {
      // Already in timeline time (output time with keepPitch, #1898): one
      // source from the offset, never structure-scheduled; it loops with
      // the timeline loop.
      const { timingSpeed, rate } = beatTiming;
      const beatSec = (sec: number) => sec / timingSpeed;
      const source = audioContext.createBufferSource();
      source.buffer = beat.buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      source.connect(beatGain);
      source.onended = onSourceEnded;
      sources.push(source);
      if (loop) {
        source.loop = true;
        source.loopStart = beatSec(loop.startSec);
        source.loopEnd = beatSec(loop.endSec);
        starts.push(() => source.start(startAt, beatSec(offset)));
      } else {
        const remaining = Math.max(0, beat.audibleSec - beatSec(offset));
        starts.push(() => source.start(startAt, beatSec(offset), remaining));
      }
    }

    for (const play of partPlays) {
      if (loop) {
        // A timeline loop cycles the part's audio over that loop: its
        // frames (one loop, within one block) on one looping source.
        const channels = partLoopChannels(
          Array.from({ length: play.buffer.numberOfChannels }, (_, c) =>
            play.buffer.getChannelData(c),
          ),
          play.buffer.sampleRate,
          play.spans,
          loop,
          play.tempo,
        );
        if (!channels) continue;
        const loopBuffer = audioContext.createBuffer(
          channels.length,
          channels[0].length,
          play.buffer.sampleRate,
        );
        channels.forEach((channel, c) =>
          loopBuffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c),
        );
        const source = audioContext.createBufferSource();
        source.buffer = loopBuffer;
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = loopBuffer.duration;
        if (play.rate !== 1) source.playbackRate.value = play.rate;
        source.connect(play.gain);
        source.onended = onSourceEnded;
        sources.push(source);
        starts.push(() =>
          source.start(startAt, (offset - loop.startSec) / play.tempo),
        );
        continue;
      }
      const plans = planPartSources(play.spans, {
        ...timing,
        tempo: play.tempo,
        loopBufferSec: play.buffer.duration,
      });
      for (const plan of plans) {
        // One looping source per span, from loop phase 0 at the span start.
        const source = audioContext.createBufferSource();
        source.buffer = play.buffer;
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = play.buffer.duration;
        if (play.rate !== 1) source.playbackRate.value = play.rate;
        if (plan.fade) {
          const fadeGain = audioContext.createGain();
          fadeGain.gain.setValueAtTime(1, plan.fade.startSec);
          fadeGain.gain.linearRampToValueAtTime(0, plan.fade.endSec);
          source.connect(fadeGain).connect(play.gain);
          partNodes.push(fadeGain);
        } else {
          source.connect(play.gain);
        }
        source.onended = onSourceEnded;
        sources.push(source);
        starts.push(() => {
          source.start(plan.whenSec, plan.phaseSec);
          source.stop(plan.stopSec);
        });
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
    stretchPool?.dispose();
    stretchPool = null;
    stretchPlanKey = null;
    stretchJobs.clear();
    stretchedBuffers.clear();
    partTakes.clear();
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
    prepareStretch,
    stretchReady,
    partTakeBuffer,
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
