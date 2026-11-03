/**
 * Per-stem automation lanes (#2541, Remix Studio Pro S6e of #1903), the
 * browser mirror of `backend/src/modules/remix/remix-automation.ts`.
 *
 * A lane is a list of points on whole bars of the timeline
 * (`timelineDownbeats`); values move in a straight line from point to point
 * and hold before the first and after the last. Level moves linearly in dB,
 * the filter knob linearly (below 0 a low-pass closes, above 0 a high-pass
 * opens), so the cutoff sweeps exponentially.
 *
 * The preview plays the same curves exactly with Web Audio ramps:
 * an exponential gain ramp is a straight line in dB, and an exponential
 * cutoff ramp is a straight line of the knob, as long as a ramp does not
 * cross 0 (where the low-pass hands over to the high-pass), so ramps are
 * split there. The render steps the filter 8 times a second instead
 * (`filterSteps`). `remix-automation-v1.parity.json` pins both sides.
 */
import type {
  RemixAutomation,
  RemixAutomationPoint,
  RemixStemAutomation,
} from "./api";
import { biquadQDb } from "./remixFx";

export const REMIX_AUTOMATION_SCHEMA_VERSION = "remix-automation/v1" as const;

export const AUTOMATION_LEVEL_MIN_DB = -24;
export const AUTOMATION_LEVEL_MAX_DB = 6;
export const AUTOMATION_LEVEL_STEP_DB = 0.5;
export const AUTOMATION_FILTER_MIN = -1;
export const AUTOMATION_FILTER_MAX = 1;
export const AUTOMATION_FILTER_STEP = 0.01;
export const AUTOMATION_MAX_POINTS = 32;
export const AUTOMATION_MAX_FILTER_POINTS_TOTAL = 48;

export const AUTOMATION_LOWPASS_OPEN_HZ = 20000;
export const AUTOMATION_LOWPASS_CLOSED_HZ = 200;
export const AUTOMATION_HIGHPASS_OPEN_HZ = 20;
export const AUTOMATION_HIGHPASS_CLOSED_HZ = 2000;
export const AUTOMATION_FILTER_Q = 0.7071;
export const AUTOMATION_FILTER_STEPS_PER_SECOND = 8;
export const AUTOMATION_FILTER_MAX_STEPS_PER_SEGMENT = 24;

export type AutomationLaneName = "level" | "filter";
export type TimedPoint = { atSec: number; value: number };
/** One stem's lanes in seconds; null = no lane. */
export type TimedStemAutomation = {
  level: TimedPoint[] | null;
  filter: TimedPoint[] | null;
};

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export const AUTOMATION_LANES: Record<
  AutomationLaneName,
  { label: string; min: number; max: number; step: number; neutral: number }
> = {
  level: {
    label: "Level",
    min: AUTOMATION_LEVEL_MIN_DB,
    max: AUTOMATION_LEVEL_MAX_DB,
    step: AUTOMATION_LEVEL_STEP_DB,
    neutral: 0,
  },
  filter: {
    label: "Filter",
    min: AUTOMATION_FILTER_MIN,
    max: AUTOMATION_FILTER_MAX,
    step: AUTOMATION_FILTER_STEP,
    neutral: 0,
  },
};

export function snapAutomationValue(lane: AutomationLaneName, value: number): number {
  const spec = AUTOMATION_LANES[lane];
  const clamped = Math.max(spec.min, Math.min(spec.max, value));
  return Math.round(Math.round(clamped / spec.step) * spec.step * 1e6) / 1e6;
}

// --- Curves (mirror of the backend) -------------------------------------------

export function timedLane(
  points: RemixAutomationPoint[] | undefined,
  downbeats: number[],
  speed = 1,
): TimedPoint[] | null {
  if (!points) return null;
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const timed = points
    .filter((point) => point.bar < downbeats.length)
    .map((point) => ({ atSec: round6(downbeats[point.bar] / s), value: point.value }));
  return timed.length > 0 ? timed : null;
}

export function timedStemAutomation(
  automation: RemixAutomation | null | undefined,
  stemId: string,
  downbeats: number[],
  speed = 1,
): TimedStemAutomation | null {
  const lanes = automation?.stems[stemId];
  if (!lanes) return null;
  const level = timedLane(lanes.level, downbeats, speed);
  const filter = timedLane(lanes.filter, downbeats, speed);
  return level || filter ? { level, filter } : null;
}

export function laneValueAt(points: TimedPoint[], t: number): number {
  if (t <= points[0].atSec) return points[0].value;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    if (t < b.atSec) {
      const a = points[i - 1];
      return a.value + ((b.value - a.value) * (t - a.atSec)) / (b.atSec - a.atSec);
    }
  }
  return points[points.length - 1].value;
}

export function filterCutoffs(value: number): { lowpassHz: number; highpassHz: number } {
  const v = Math.max(AUTOMATION_FILTER_MIN, Math.min(AUTOMATION_FILTER_MAX, value));
  return {
    lowpassHz: round6(
      v < 0
        ? AUTOMATION_LOWPASS_OPEN_HZ *
            Math.pow(AUTOMATION_LOWPASS_CLOSED_HZ / AUTOMATION_LOWPASS_OPEN_HZ, -v)
        : AUTOMATION_LOWPASS_OPEN_HZ,
    ),
    highpassHz: round6(
      v > 0
        ? AUTOMATION_HIGHPASS_OPEN_HZ *
            Math.pow(AUTOMATION_HIGHPASS_CLOSED_HZ / AUTOMATION_HIGHPASS_OPEN_HZ, v)
        : AUTOMATION_HIGHPASS_OPEN_HZ,
    ),
  };
}

/** The render's stepped filter sweep (parity with the backend). */
export function filterSteps(
  points: TimedPoint[],
): Array<{ atSec: number; lowpassHz: number; highpassHz: number }> {
  const steps = [{ atSec: 0, ...filterCutoffs(points[0].value) }];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.value === b.value) continue;
    const length = b.atSec - a.atSec;
    const n = Math.max(
      1,
      Math.min(
        AUTOMATION_FILTER_MAX_STEPS_PER_SEGMENT,
        Math.ceil(length * AUTOMATION_FILTER_STEPS_PER_SECOND),
      ),
    );
    for (let k = 0; k < n; k += 1) {
      const at = a.atSec + (length * k) / n;
      const mid = a.atSec + (length * (k + 0.5)) / n;
      steps.push({
        atSec: round6(at),
        ...filterCutoffs(a.value + ((b.value - a.value) * (mid - a.atSec)) / length),
      });
    }
    steps.push({ atSec: b.atSec, ...filterCutoffs(b.value) });
  }
  return steps;
}

// --- Preview (Web Audio) -------------------------------------------------------

/** A filter lane with a point added wherever a segment crosses 0. */
export function filterRampPoints(points: TimedPoint[]): TimedPoint[] {
  const out: TimedPoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if ((a.value < 0 && b.value > 0) || (a.value > 0 && b.value < 0)) {
      const at = a.atSec + ((b.atSec - a.atSec) * -a.value) / (b.value - a.value);
      out.push({ atSec: at, value: 0 });
    }
    out.push(b);
  }
  return out;
}

type RampParam = {
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
};

const dbGain = (db: number) => Math.pow(10, db / 20);

/**
 * Schedule a lane (OUTPUT time) on a param from `offsetOutSec`, which plays
 * at context time `startAt`: the value there, then an exponential ramp to
 * each later point (exact, see the module note).
 */
export function scheduleLane(
  param: RampParam,
  points: TimedPoint[],
  map: (value: number) => number,
  input: { startAt: number; offsetOutSec: number },
): void {
  const toContext = (sec: number) => input.startAt + (sec - input.offsetOutSec);
  param.setValueAtTime(map(laneValueAt(points, input.offsetOutSec)), input.startAt);
  for (const point of points) {
    if (point.atSec <= input.offsetOutSec) continue;
    param.exponentialRampToValueAtTime(map(point.value), toContext(point.atSec));
  }
}

/** The preview's automation stage of one stem: level gain → low-pass → high-pass. */
export type AutomationStage = {
  input: AudioNode;
  output: AudioNode;
  level: GainNode | null;
  lowpass: BiquadFilterNode | null;
  highpass: BiquadFilterNode | null;
};

/**
 * Build and schedule a stem's automation stage for lanes in OUTPUT time, or
 * null without lanes (the graph is then unchanged).
 */
export function createAutomationStage(
  context: BaseAudioContext,
  lanes: TimedStemAutomation | null | undefined,
  timing: { startAt: number; offsetOutSec: number },
  nodes: AudioNode[],
): AutomationStage | null {
  if (!lanes || (!lanes.level && !lanes.filter)) return null;
  const chain: AudioNode[] = [];
  let level: GainNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let highpass: BiquadFilterNode | null = null;
  if (lanes.level) {
    level = context.createGain();
    scheduleLane(level.gain, lanes.level, dbGain, timing);
    chain.push(level);
  }
  if (lanes.filter) {
    const ramp = filterRampPoints(lanes.filter);
    lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.value = biquadQDb(AUTOMATION_FILTER_Q);
    scheduleLane(lowpass.frequency, ramp, (v) => filterCutoffs(v).lowpassHz, timing);
    highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.Q.value = biquadQDb(AUTOMATION_FILTER_Q);
    scheduleLane(highpass.frequency, ramp, (v) => filterCutoffs(v).highpassHz, timing);
    chain.push(lowpass, highpass);
  }
  for (let i = 1; i < chain.length; i += 1) chain[i - 1].connect(chain[i]);
  nodes.push(...chain);
  return { input: chain[0], output: chain[chain.length - 1], level, lowpass, highpass };
}

/** Every stem's lanes on the timeline clock, for the transport; null = none. */
export function previewAutomation(
  automation: RemixAutomation | null | undefined,
  downbeats: number[],
): Record<string, TimedStemAutomation> | null {
  if (!automation || downbeats.length === 0) return null;
  const out: Record<string, TimedStemAutomation> = {};
  for (const stemId of Object.keys(automation.stems)) {
    const lanes = timedStemAutomation(automation, stemId, downbeats, 1);
    if (lanes) out[stemId] = lanes;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Lanes moved to output time (timeline ÷ speed). */
export function automationAtSpeed(
  lanes: TimedStemAutomation | null | undefined,
  speed: number,
): TimedStemAutomation | null {
  if (!lanes) return null;
  if (speed === 1 || !(speed > 0)) return lanes;
  const move = (points: TimedPoint[] | null) =>
    points ? points.map((p) => ({ atSec: round6(p.atSec / speed), value: p.value })) : null;
  return { level: move(lanes.level), filter: move(lanes.filter) };
}

/** Signature of the preview lanes, so the transport restarts only on a real change. */
export function previewAutomationKey(
  lanes: Record<string, TimedStemAutomation> | null | undefined,
): string {
  if (!lanes) return "";
  return JSON.stringify(
    Object.keys(lanes)
      .sort()
      .map((stemId) => [stemId, lanes[stemId].level, lanes[stemId].filter]),
  );
}

// --- Editing ---------------------------------------------------------------------

export function emptyAutomation(): RemixAutomation {
  return { schemaVersion: REMIX_AUTOMATION_SCHEMA_VERSION, stems: {} };
}

function withLane(
  automation: RemixAutomation,
  stemId: string,
  lane: AutomationLaneName,
  points: RemixAutomationPoint[],
): RemixAutomation {
  const current: RemixStemAutomation = { ...(automation.stems[stemId] ?? {}) };
  if (points.length > 0) current[lane] = points;
  else delete current[lane];
  const stems = { ...automation.stems };
  if (current.level || current.filter) stems[stemId] = current;
  else delete stems[stemId];
  return { ...automation, stems };
}

/** Add or move the point on `bar` (one point per bar). */
export function setAutomationPoint(
  automation: RemixAutomation,
  stemId: string,
  lane: AutomationLaneName,
  bar: number,
  value: number,
): RemixAutomation {
  const points = (automation.stems[stemId]?.[lane] ?? []).filter((p) => p.bar !== bar);
  points.push({ bar, value: snapAutomationValue(lane, value) });
  points.sort((a, b) => a.bar - b.bar);
  return withLane(automation, stemId, lane, points);
}

/** Move a point to another bar (replacing a point already there). */
export function moveAutomationPoint(
  automation: RemixAutomation,
  stemId: string,
  lane: AutomationLaneName,
  fromBar: number,
  toBar: number,
): RemixAutomation {
  const point = automation.stems[stemId]?.[lane]?.find((p) => p.bar === fromBar);
  if (!point || fromBar === toBar) return automation;
  return setAutomationPoint(
    removeAutomationPoint(automation, stemId, lane, fromBar),
    stemId,
    lane,
    toBar,
    point.value,
  );
}

export function removeAutomationPoint(
  automation: RemixAutomation,
  stemId: string,
  lane: AutomationLaneName,
  bar: number,
): RemixAutomation {
  const points = (automation.stems[stemId]?.[lane] ?? []).filter((p) => p.bar !== bar);
  return withLane(automation, stemId, lane, points);
}

export function clearAutomationLane(
  automation: RemixAutomation,
  stemId: string,
  lane: AutomationLaneName,
): RemixAutomation {
  return withLane(automation, stemId, lane, []);
}

/** The PATCH value: null when nothing is left. */
export function automationPayload(automation: RemixAutomation | null): RemixAutomation | null {
  return automation && Object.keys(automation.stems).length > 0 ? automation : null;
}

export function sameAutomation(
  a: RemixAutomation | null | undefined,
  b: RemixAutomation | null | undefined,
): boolean {
  const key = (x: RemixAutomation | null | undefined) => {
    const payload = automationPayload(x ?? null);
    if (!payload) return "";
    return JSON.stringify(
      Object.keys(payload.stems)
        .sort()
        .map((stemId) => [stemId, payload.stems[stemId].level ?? null, payload.stems[stemId].filter ?? null]),
    );
  };
  return key(a) === key(b);
}

/** What stops a save, in the user's words (the server checks the same limits). */
export function automationProblems(
  automation: RemixAutomation | null,
  barCount: number,
): string[] {
  if (!automation) return [];
  const problems: string[] = [];
  let filterPoints = 0;
  for (const [stemId, lanes] of Object.entries(automation.stems)) {
    for (const lane of ["level", "filter"] as const) {
      const points = lanes[lane] ?? [];
      if (lane === "filter") filterPoints += points.length;
      if (points.length > AUTOMATION_MAX_POINTS) {
        problems.push(`${stemId}: a lane can have at most ${AUTOMATION_MAX_POINTS} points.`);
      }
      if (barCount > 0 && points.some((p) => p.bar >= barCount)) {
        problems.push(`${stemId}: a ${AUTOMATION_LANES[lane].label.toLowerCase()} point is past the last bar (${barCount}).`);
      }
    }
  }
  if (filterPoints > AUTOMATION_MAX_FILTER_POINTS_TOTAL) {
    problems.push(`Filter lanes can have at most ${AUTOMATION_MAX_FILTER_POINTS_TOTAL} points in total.`);
  }
  return problems;
}

/** How a value reads in the lane list. */
export function automationValueLabel(lane: AutomationLaneName, value: number): string {
  if (lane === "level") return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
  if (value === 0) return "Open";
  const { lowpassHz, highpassHz } = filterCutoffs(value);
  const hz = value < 0 ? lowpassHz : highpassHz;
  const text = hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
  return value < 0 ? `Low-pass ${text}` : `High-pass ${text}`;
}
