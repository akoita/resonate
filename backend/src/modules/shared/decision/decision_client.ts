/**
 * Structured decision calls (#2580, #2582): a provider-neutral port for the
 * three answers the backend asks a model for when it does not want prose.
 *
 * - `predicate`: yes or no, with a confidence.
 * - `choice`: one or more options from a fixed set, with a confidence.
 * - `score`: a number in a declared range for each candidate.
 *
 * The rules are the ones the model-assisted code already follows:
 *
 * - The caller writes the question. Everything else goes in `input` as bounded
 *   JSON and is data, never instructions, whoever typed it.
 * - Every answer is validated field by field. An option that was not offered,
 *   a score outside the range or a candidate that was not sent is dropped,
 *   never repaired.
 * - A call never throws. A failure is a typed reason the caller can branch
 *   on, and the caller falls back to its deterministic code.
 * - Money, payouts, upload rights and watermark gates do not go through this
 *   port. A decision can at most flag something for a person to review.
 */

/** Why a decision call produced no answer. Fixed codes; safe to log. */
export const DECISION_FAILURE_REASONS = [
  "disabled",
  "missing_api_key",
  "invalid_request",
  "over_capacity",
  "timeout",
  "provider_error",
  "invalid_output",
] as const;
export type DecisionFailureReason = (typeof DECISION_FAILURE_REASONS)[number];

export type DecisionResult<T> = { ok: true; value: T } | { ok: false; reason: DecisionFailureReason };

/** Bounded JSON the model reads as data. */
export type DecisionInput = Record<string, unknown>;

interface DecisionRequestBase {
  /**
   * What is being decided, written by the developer. Never built from
   * listener- or artist-controlled text: that belongs in `input`.
   */
  question: string;
  input: DecisionInput;
  /** Aborts the provider call (the client also applies its own timeout). */
  signal?: AbortSignal;
}

export type PredicateRequest = DecisionRequestBase;
export interface PredicateAnswer {
  answer: boolean;
  /** 0 to 1. */
  confidence: number;
}

export interface ChoiceRequest extends DecisionRequestBase {
  /** The only values the answer may contain. */
  options: readonly string[];
  /** At least this many options must come back (default 1; 0 allows "none"). */
  min?: number;
  /** At most this many options are kept (default 1). */
  max?: number;
}
export interface ChoiceAnswer {
  /** Offered options only, in the model's order, without duplicates. */
  selected: string[];
  /** 0 to 1. */
  confidence: number;
}

export interface ScoreCandidate {
  /** An opaque id the caller can map back; echoed by the model. */
  id: string;
  data: DecisionInput;
}
export interface ScoreRequest extends DecisionRequestBase {
  candidates: readonly ScoreCandidate[];
  range: { min: number; max: number };
}
export interface ScoreAnswer {
  /** One entry per candidate the model scored inside the range. */
  scores: Array<{ id: string; score: number }>;
}

export interface DecisionClient {
  predicate(request: PredicateRequest): Promise<DecisionResult<PredicateAnswer>>;
  choice(request: ChoiceRequest): Promise<DecisionResult<ChoiceAnswer>>;
  score(request: ScoreRequest): Promise<DecisionResult<ScoreAnswer>>;
}

/** Injection token for the configured {@link DecisionClient}. */
export const DECISION_CLIENT = Symbol("DECISION_CLIENT");

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const DECISION_MAX_QUESTION_LENGTH = 600;
/** Serialized size of `input`, and of each candidate's `data`. */
export const DECISION_MAX_INPUT_BYTES = 8 * 1024;
export const DECISION_MAX_OPTIONS = 64;
export const DECISION_MAX_OPTION_LENGTH = 80;
export const DECISION_MAX_CANDIDATES = 50;
export const DECISION_MAX_CANDIDATE_ID_LENGTH = 100;
/** Everything sent in one score call. */
export const DECISION_MAX_SCORE_BYTES = 64 * 1024;

function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? Buffer.byteLength(text, "utf8") : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBase(request: DecisionRequestBase): boolean {
  if (typeof request.question !== "string") return false;
  const question = request.question.trim();
  if (!question || question.length > DECISION_MAX_QUESTION_LENGTH) return false;
  if (!isRecord(request.input)) return false;
  const bytes = jsonBytes(request.input);
  return bytes !== null && bytes <= DECISION_MAX_INPUT_BYTES;
}

export function isValidPredicateRequest(request: PredicateRequest): boolean {
  return validBase(request);
}

/** The effective `min` and `max` of a choice request. */
export function choiceBounds(request: Pick<ChoiceRequest, "min" | "max">): { min: number; max: number } {
  return { min: request.min ?? 1, max: request.max ?? 1 };
}

export function isValidChoiceRequest(request: ChoiceRequest): boolean {
  if (!validBase(request)) return false;
  const options = request.options;
  if (!Array.isArray(options) || options.length === 0 || options.length > DECISION_MAX_OPTIONS) return false;
  if (new Set(options).size !== options.length) return false;
  if (
    options.some(
      (option) => typeof option !== "string" || !option || option.length > DECISION_MAX_OPTION_LENGTH,
    )
  ) {
    return false;
  }
  const { min, max } = choiceBounds(request);
  return Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= 1 && min <= max && max <= options.length;
}

export function isValidScoreRequest(request: ScoreRequest): boolean {
  if (!validBase(request)) return false;
  const { range, candidates } = request;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return false;
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > DECISION_MAX_CANDIDATES) {
    return false;
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string") return false;
    if (!candidate.id || candidate.id.length > DECISION_MAX_CANDIDATE_ID_LENGTH || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
    if (!isRecord(candidate.data)) return false;
    const bytes = jsonBytes(candidate.data);
    if (bytes === null || bytes > DECISION_MAX_INPUT_BYTES) return false;
  }
  const total = jsonBytes(candidates);
  return total !== null && total <= DECISION_MAX_SCORE_BYTES;
}

// ---------------------------------------------------------------------------
// Answer validation. Pure, shared by every implementation: what a provider
// returns is untrusted until it has been through one of these.
// ---------------------------------------------------------------------------

function parseObject(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function confidenceOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function validatePredicateAnswer(raw: unknown): PredicateAnswer | null {
  const parsed = parseObject(raw);
  if (!parsed || typeof parsed.answer !== "boolean") return null;
  const confidence = confidenceOf(parsed.confidence);
  return confidence === null ? null : { answer: parsed.answer, confidence };
}

export function validateChoiceAnswer(
  raw: unknown,
  request: Pick<ChoiceRequest, "options" | "min" | "max">,
): ChoiceAnswer | null {
  const parsed = parseObject(raw);
  if (!parsed || !Array.isArray(parsed.selected)) return null;
  const confidence = confidenceOf(parsed.confidence);
  if (confidence === null) return null;
  const { min, max } = choiceBounds(request);
  const offered = new Set(request.options);
  const selected: string[] = [];
  for (const value of parsed.selected) {
    // Not offered, repeated or over the limit: dropped, never mapped to a near match.
    if (typeof value !== "string" || !offered.has(value) || selected.includes(value)) continue;
    if (selected.length < max) selected.push(value);
  }
  return selected.length < min ? null : { selected, confidence };
}

export function validateScoreAnswer(
  raw: unknown,
  request: Pick<ScoreRequest, "candidates" | "range">,
): ScoreAnswer | null {
  const parsed = parseObject(raw);
  if (!parsed || !Array.isArray(parsed.scores)) return null;
  const sent = new Set(request.candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const scores: ScoreAnswer["scores"] = [];
  for (const entry of parsed.scores) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !sent.has(entry.id) || seen.has(entry.id)) continue;
    const score = entry.score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    // Outside the declared range: dropped, not clamped.
    if (score < request.range.min || score > request.range.max) continue;
    seen.add(entry.id);
    scores.push({ id: entry.id, score });
  }
  return scores.length === 0 ? null : { scores };
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

/**
 * The values a `*_STRATEGY` flag can hold. `decision` is the third, next to
 * the two every model call already has. A caller that has no decision path
 * yet reads `decision` as `deterministic`, as it reads any unknown value.
 */
export const MODEL_STRATEGIES = ["deterministic", "model-assisted", "decision"] as const;
export type ModelStrategy = (typeof MODEL_STRATEGIES)[number];

/** Reads a `*_STRATEGY` value. Anything unrecognised is `deterministic`. */
export function modelStrategyFrom(value: string | undefined | null): ModelStrategy {
  const normalized = value?.trim().toLowerCase().replace(/_/g, "-");
  return (MODEL_STRATEGIES as readonly string[]).includes(normalized ?? "")
    ? (normalized as ModelStrategy)
    : "deterministic";
}

/** The client used when decisions are off: every call answers `disabled`. */
export class DisabledDecisionClient implements DecisionClient {
  constructor(private readonly reason: Extract<DecisionFailureReason, "disabled" | "missing_api_key"> = "disabled") {}

  async predicate(): Promise<DecisionResult<PredicateAnswer>> {
    return { ok: false, reason: this.reason };
  }
  async choice(): Promise<DecisionResult<ChoiceAnswer>> {
    return { ok: false, reason: this.reason };
  }
  async score(): Promise<DecisionResult<ScoreAnswer>> {
    return { ok: false, reason: this.reason };
  }
}
