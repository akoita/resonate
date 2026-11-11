import {
  isValidChoiceRequest,
  isValidPredicateRequest,
  isValidScoreRequest,
  validateChoiceAnswer,
  validatePredicateAnswer,
  validateScoreAnswer,
  type ChoiceAnswer,
  type ChoiceRequest,
  type DecisionClient,
  type DecisionFailureReason,
  type DecisionResult,
  type PredicateAnswer,
  type PredicateRequest,
  type ScoreAnswer,
  type ScoreRequest,
} from "./decision_client";

type Scripted<Request> = unknown | ((request: Request) => unknown);

export interface FakeDecisionScript {
  /** What the "model" returns, raw. It goes through the real validators. */
  predicate?: Scripted<PredicateRequest>;
  choice?: Scripted<ChoiceRequest>;
  score?: Scripted<ScoreRequest>;
  /** Every call fails with this reason instead. */
  fail?: DecisionFailureReason;
}

/**
 * {@link DecisionClient} for tests: scripted raw answers, validated exactly
 * as a provider's are, so a spec can prove its caller survives an option that
 * was never offered or a failure reason. Records the requests it received.
 */
export class FakeDecisionClient implements DecisionClient {
  readonly calls: Array<
    | { kind: "predicate"; request: PredicateRequest }
    | { kind: "choice"; request: ChoiceRequest }
    | { kind: "score"; request: ScoreRequest }
  > = [];

  constructor(public script: FakeDecisionScript = {}) {}

  async predicate(request: PredicateRequest): Promise<DecisionResult<PredicateAnswer>> {
    this.calls.push({ kind: "predicate", request });
    if (!isValidPredicateRequest(request)) return { ok: false, reason: "invalid_request" };
    return this.answer(this.script.predicate, request, validatePredicateAnswer);
  }

  async choice(request: ChoiceRequest): Promise<DecisionResult<ChoiceAnswer>> {
    this.calls.push({ kind: "choice", request });
    if (!isValidChoiceRequest(request)) return { ok: false, reason: "invalid_request" };
    return this.answer(this.script.choice, request, (raw) => validateChoiceAnswer(raw, request));
  }

  async score(request: ScoreRequest): Promise<DecisionResult<ScoreAnswer>> {
    this.calls.push({ kind: "score", request });
    if (!isValidScoreRequest(request)) return { ok: false, reason: "invalid_request" };
    return this.answer(this.script.score, request, (raw) => validateScoreAnswer(raw, request));
  }

  private answer<Request, T>(
    scripted: Scripted<Request> | undefined,
    request: Request,
    validate: (raw: unknown) => T | null,
  ): DecisionResult<T> {
    if (this.script.fail) return { ok: false, reason: this.script.fail };
    if (scripted === undefined) return { ok: false, reason: "disabled" };
    const raw = typeof scripted === "function" ? (scripted as (request: Request) => unknown)(request) : scripted;
    const value = validate(raw);
    return value === null ? { ok: false, reason: "invalid_output" } : { ok: true, value };
  }
}
