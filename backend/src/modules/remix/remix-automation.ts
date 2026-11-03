/**
 * Per-stem automation lanes (#2541, Remix Studio Pro S6e of #1903).
 *
 * Each source stem can carry a level lane (dB) and a filter lane (one DJ
 * filter knob: below 0 a low-pass closes, above 0 a high-pass opens). A lane
 * is a list of points on whole bars of the timeline (the beat maker's bars,
 * `timelineDownbeats`, so lanes follow the S6c grid correction); values
 * move in a straight line from point to point and hold before the first and
 * after the last. Level moves linearly in dB, the filter knob linearly,
 * which makes the cutoff sweep exponentially.
 *
 * The render runs after the Pro stages and before the section gate, in
 * output time (timeline ÷ speed): a per-frame `volume` expression for the
 * level and a stepped `asendcmd` sweep of a low-pass and a high-pass for the
 * filter (like build-ups, #1908). The preview runs the same curves on Web
 * Audio params (exponential ramps). Mirrored by
 * `web/src/lib/remixAutomation.ts`; `remix-automation-v1.parity.json` pins
 * point times, sampled values, cutoffs and the render steps for both.
 */
export const REMIX_AUTOMATION_SCHEMA_VERSION = "remix-automation/v1" as const;
export const REMIX_AUTOMATION_DSP_VERSION = "remix-automation-dsp/v1" as const;

export const AUTOMATION_LEVEL_MIN_DB = -24;
export const AUTOMATION_LEVEL_MAX_DB = 6;
export const AUTOMATION_LEVEL_STEP_DB = 0.5;
export const AUTOMATION_FILTER_MIN = -1;
export const AUTOMATION_FILTER_MAX = 1;
export const AUTOMATION_FILTER_STEP = 0.01;
/** Points per lane. */
export const AUTOMATION_MAX_POINTS = 32;
/** Filter points across the whole project (bounds the render's command list). */
export const AUTOMATION_MAX_FILTER_POINTS_TOTAL = 48;
export const AUTOMATION_MAX_BAR = 2000;

/** Filter mapping: the low-pass closes 20 kHz → 200 Hz, the high-pass opens 20 Hz → 2 kHz. */
export const AUTOMATION_LOWPASS_OPEN_HZ = 20000;
export const AUTOMATION_LOWPASS_CLOSED_HZ = 200;
export const AUTOMATION_HIGHPASS_OPEN_HZ = 20;
export const AUTOMATION_HIGHPASS_CLOSED_HZ = 2000;
export const AUTOMATION_FILTER_Q = 0.7071;
/** Render sweep: steps per second of a moving filter segment, and at most per segment. */
export const AUTOMATION_FILTER_STEPS_PER_SECOND = 8;
export const AUTOMATION_FILTER_MAX_STEPS_PER_SEGMENT = 24;

export type AutomationPoint = { bar: number; value: number };
export type StemAutomation = { level?: AutomationPoint[]; filter?: AutomationPoint[] };
export type RemixAutomation = {
  schemaVersion: typeof REMIX_AUTOMATION_SCHEMA_VERSION;
  stems: Record<string, StemAutomation>;
};
/** A point placed on the timeline (or output) clock. */
export type TimedPoint = { atSec: number; value: number };
/** One stem's lanes in seconds; null = no lane. */
export type TimedStemAutomation = { level: TimedPoint[] | null; filter: TimedPoint[] | null };

export class RemixAutomationValidationError extends Error {}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snap(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1e6) / 1e6;
}

function normalizeLane(
  raw: unknown,
  name: string,
  min: number,
  max: number,
  step: number,
): AutomationPoint[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new RemixAutomationValidationError(`${name} must be a list of points`);
  if (raw.length === 0) return undefined;
  if (raw.length > AUTOMATION_MAX_POINTS) {
    throw new RemixAutomationValidationError(`${name} has more than ${AUTOMATION_MAX_POINTS} points`);
  }
  const points = raw.map((point, i) => {
    if (!isPlainObject(point)) throw new RemixAutomationValidationError(`${name}[${i}] must be an object`);
    const { bar, value } = point;
    if (typeof bar !== "number" || !Number.isInteger(bar) || bar < 0 || bar > AUTOMATION_MAX_BAR) {
      throw new RemixAutomationValidationError(`${name}[${i}].bar must be a whole number from 0 to ${AUTOMATION_MAX_BAR}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new RemixAutomationValidationError(`${name}[${i}].value must be from ${min} to ${max}`);
    }
    return { bar, value: snap(value, step) };
  });
  points.sort((a, b) => a.bar - b.bar);
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].bar === points[i - 1].bar) {
      throw new RemixAutomationValidationError(`${name} has two points on bar ${points[i].bar + 1}`);
    }
  }
  return points;
}

/**
 * Validate a PATCH `automation` payload against the project's stem ids.
 * Empty lanes and stems are dropped; nothing left normalizes to null.
 */
export function normalizeRemixAutomationInput(
  raw: unknown,
  stemIds: readonly string[],
): RemixAutomation | null {
  if (raw === null) return null;
  if (!isPlainObject(raw)) throw new RemixAutomationValidationError("automation must be an object or null");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== REMIX_AUTOMATION_SCHEMA_VERSION) {
    throw new RemixAutomationValidationError(`automation.schemaVersion must be ${REMIX_AUTOMATION_SCHEMA_VERSION}`);
  }
  const rawStems = raw.stems ?? {};
  if (!isPlainObject(rawStems)) throw new RemixAutomationValidationError("automation.stems must be an object");
  const known = new Set(stemIds);
  const stems: Record<string, StemAutomation> = {};
  let filterPoints = 0;
  for (const stemId of Object.keys(rawStems).sort()) {
    if (!known.has(stemId)) {
      throw new RemixAutomationValidationError(`automation.stems has a stem that is not in this project: ${stemId}`);
    }
    const lanes = rawStems[stemId];
    if (!isPlainObject(lanes)) throw new RemixAutomationValidationError(`automation.stems.${stemId} must be an object`);
    const level = normalizeLane(lanes.level, `automation.stems.${stemId}.level`, AUTOMATION_LEVEL_MIN_DB, AUTOMATION_LEVEL_MAX_DB, AUTOMATION_LEVEL_STEP_DB);
    const filter = normalizeLane(lanes.filter, `automation.stems.${stemId}.filter`, AUTOMATION_FILTER_MIN, AUTOMATION_FILTER_MAX, AUTOMATION_FILTER_STEP);
    filterPoints += filter?.length ?? 0;
    if (level || filter) stems[stemId] = { ...(level ? { level } : {}), ...(filter ? { filter } : {}) };
  }
  if (filterPoints > AUTOMATION_MAX_FILTER_POINTS_TOTAL) {
    throw new RemixAutomationValidationError(
      `Filter lanes can have at most ${AUTOMATION_MAX_FILTER_POINTS_TOTAL} points in total`,
    );
  }
  return Object.keys(stems).length > 0 ? { schemaVersion: REMIX_AUTOMATION_SCHEMA_VERSION, stems } : null;
}

/** Read stored automation tolerantly (stems no longer in the project are dropped). */
export function parseRemixAutomation(raw: unknown, stemIds: readonly string[]): RemixAutomation | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.stems)) return null;
  const known = new Set(stemIds);
  const kept: Record<string, unknown> = {};
  for (const [stemId, lanes] of Object.entries(raw.stems)) if (known.has(stemId)) kept[stemId] = lanes;
  try {
    return normalizeRemixAutomationInput({ ...raw, stems: kept }, stemIds);
  } catch {
    return null;
  }
}

// --- Curves -------------------------------------------------------------------

/**
 * A lane on the clock: each point at its bar's downbeat ÷ speed. Points on
 * bars the timeline no longer has are dropped (a stale lane fails open);
 * null when nothing is left.
 */
export function timedLane(
  points: AutomationPoint[] | undefined,
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
  automation: RemixAutomation | null,
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

/** The lane's value at `t`: straight lines between points, held before the first and after the last. */
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

/** Low-pass and high-pass cutoffs for a filter knob value (exponential in the knob). */
export function filterCutoffs(value: number): { lowpassHz: number; highpassHz: number } {
  const v = Math.max(AUTOMATION_FILTER_MIN, Math.min(AUTOMATION_FILTER_MAX, value));
  return {
    lowpassHz: round6(
      v < 0
        ? AUTOMATION_LOWPASS_OPEN_HZ * Math.pow(AUTOMATION_LOWPASS_CLOSED_HZ / AUTOMATION_LOWPASS_OPEN_HZ, -v)
        : AUTOMATION_LOWPASS_OPEN_HZ,
    ),
    highpassHz: round6(
      v > 0
        ? AUTOMATION_HIGHPASS_OPEN_HZ * Math.pow(AUTOMATION_HIGHPASS_CLOSED_HZ / AUTOMATION_HIGHPASS_OPEN_HZ, v)
        : AUTOMATION_HIGHPASS_OPEN_HZ,
    ),
  };
}

/**
 * The render's filter steps: the starting cutoffs, then for each segment
 * whose value moves, steps at 8 per second (at most 24, at least 1) holding
 * the cutoffs of the value at the step's middle, and the exact cutoffs at
 * each point after a move.
 */
export function filterSteps(
  points: TimedPoint[],
): Array<{ atSec: number; lowpassHz: number; highpassHz: number }> {
  const steps = [{ atSec: 0, ...filterCutoffs(points[0].value) }];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.value === b.value) continue;
    const length = b.atSec - a.atSec;
    const n = Math.max(1, Math.min(AUTOMATION_FILTER_MAX_STEPS_PER_SEGMENT, Math.ceil(length * AUTOMATION_FILTER_STEPS_PER_SECOND)));
    for (let k = 0; k < n; k += 1) {
      const at = a.atSec + (length * k) / n;
      const mid = a.atSec + (length * (k + 0.5)) / n;
      steps.push({ atSec: round6(at), ...filterCutoffs(a.value + ((b.value - a.value) * (mid - a.atSec)) / length) });
    }
    steps.push({ atSec: b.atSec, ...filterCutoffs(b.value) });
  }
  return steps;
}

// --- Render (ffmpeg) -------------------------------------------------------------

const num = (value: number) => String(round6(value));

/** Per-frame `volume` expression of a level lane (linear in dB). */
export function levelVolumeExpression(points: TimedPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  const terms = [`${num(first.value)}*lt(t\\,${num(first.atSec)})`];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const slope = (b.value - a.value) / (b.atSec - a.atSec);
    terms.push(
      `gte(t\\,${num(a.atSec)})*lt(t\\,${num(b.atSec)})*(${num(a.value)}+${num(slope)}*(t-${num(a.atSec)}))`,
    );
  }
  terms.push(`${num(last.value)}*gte(t\\,${num(last.atSec)})`);
  return `pow(10\\,(${terms.join("+")})/20)`;
}

/**
 * The automation filters for one stem input (`index` keeps the filter
 * instance names unique), in output time. Empty without lanes.
 */
export function automationFilters(lanes: TimedStemAutomation | null, index: number): string[] {
  if (!lanes) return [];
  const out: string[] = [];
  if (lanes.level) out.push(`volume=volume='${levelVolumeExpression(lanes.level)}':eval=frame`);
  if (lanes.filter) {
    const steps = filterSteps(lanes.filter);
    const lp = `lowpass@alp${index}`;
    const hp = `highpass@ahp${index}`;
    const commands = steps
      .slice(1)
      .map((step) => `${num(step.atSec)} ${lp} f ${num(step.lowpassHz)}\\,${hp} f ${num(step.highpassHz)}`);
    const head = commands.length > 0 ? [`asendcmd=c='${commands.join("\\;")}'`] : [];
    out.push(
      ...head,
      `${lp}=f=${num(steps[0].lowpassHz)}:width_type=q:width=${AUTOMATION_FILTER_Q}:transform=di`,
      `${hp}=f=${num(steps[0].highpassHz)}:width_type=q:width=${AUTOMATION_FILTER_Q}:transform=di`,
    );
  }
  return out;
}
