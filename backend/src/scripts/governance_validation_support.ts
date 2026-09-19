/**
 * The pure half of the governance validation harness.
 *
 * Everything here is a function of its arguments: phase parsing, the
 * production guard, the fixture plan (including the backdating that makes a
 * 730-day window observable today), and the expectation checker. Nothing in
 * this file touches Postgres, so all of it is unit-testable, and the parts
 * that decide whether the harness is allowed to write fake data at all are
 * exactly the parts that must never depend on a database being reachable.
 *
 * `governance_validation.ts` is the half that talks to the database.
 */
import { FINANCIAL_AUDIT_EVENT_FAMILIES } from "../modules/analytics/analytics_audit_families";

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The phases, in the order an operator runs them.
 *
 * They are separate executions rather than one script because each verify
 * phase has to observe the effect of a *real* job run — `run_retention_cleanup`
 * or `run_due_erasures` — that happens between the seed and the check, outside
 * this process. A single script could only ever validate itself calling the
 * service, which is a weaker claim than validating the scheduled job.
 *
 * These names are the contract with the infrastructure job definition. Changing
 * one is a change to a deployed job argument.
 */
export const GOVERNANCE_VALIDATION_PHASES = [
  "seed-retention",
  "verify-retention",
  "seed-erasure",
  "verify-erasure",
  "cleanup",
] as const;

export type GovernancePhase = (typeof GOVERNANCE_VALIDATION_PHASES)[number];

/**
 * Every row the harness writes is named with this root.
 *
 * Cleanup deletes on `startsWith(prefix)` and nothing else, and every prefix
 * this module can produce begins here, so a cleanup can only ever reach rows
 * the harness created. That invariant is worth more than any amount of care
 * at the call sites.
 */
export const GOVERNANCE_VALIDATION_PREFIX_ROOT = "govval_";

/** Run ids are part of a `LIKE` prefix, so they are deliberately narrow. */
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,23}$/;

export const DEFAULT_GOVERNANCE_VALIDATION_RUN_ID = "default";

export interface GovernanceValidationInvocation {
  phase: GovernancePhase;
  runId: string;
  /** `govval_<runId>_` — the root every sub-prefix extends. */
  prefix: string;
  /** Rows belonging to the retention fixtures. */
  retentionPrefix: string;
  /** Rows belonging to the erasure fixtures. */
  erasurePrefix: string;
}

export type ParsedInvocation =
  | { ok: true; invocation: GovernanceValidationInvocation }
  | { ok: false; error: string };

export function prefixesFor(runId: string) {
  const prefix = `${GOVERNANCE_VALIDATION_PREFIX_ROOT}${runId}_`;
  return { prefix, retentionPrefix: `${prefix}ret_`, erasurePrefix: `${prefix}era_` };
}

/**
 * `<phase> [--run-id <id>]`.
 *
 * The run id lets two validation runs share an environment without colliding
 * on the unique columns the fixtures occupy (`StemPurchase.transactionHash`,
 * `AnalyticsEvent.eventId`). It defaults to a constant rather than to a
 * timestamp on purpose: seed and verify are separate processes, so anything
 * derived from the clock could not be rediscovered by the phase that has to
 * find the rows again.
 */
export function parseInvocation(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedInvocation {
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const flagged = new Set(argv.filter((argument) => argument.startsWith("--")));
  const runIdIndex = argv.indexOf("--run-id");
  const runIdArgument = runIdIndex === -1 ? undefined : argv[runIdIndex + 1];

  // `--run-id x` puts `x` in the positional list too; it is not the phase.
  const phaseCandidate = positional.find((value) => value !== runIdArgument);

  if (!phaseCandidate) {
    return { ok: false, error: `Missing phase. Expected one of: ${GOVERNANCE_VALIDATION_PHASES.join(", ")}` };
  }
  if (!isGovernancePhase(phaseCandidate)) {
    return {
      ok: false,
      error: `Unknown phase "${phaseCandidate}". Expected one of: ${GOVERNANCE_VALIDATION_PHASES.join(", ")}`,
    };
  }
  if (runIdIndex !== -1 && !runIdArgument) {
    return { ok: false, error: "--run-id requires a value" };
  }
  for (const flag of flagged) {
    if (flag !== "--run-id") {
      return { ok: false, error: `Unknown flag "${flag}". The only flag is --run-id.` };
    }
  }

  const runId = (runIdArgument ?? env.GOVERNANCE_VALIDATION_RUN_ID ?? DEFAULT_GOVERNANCE_VALIDATION_RUN_ID).trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    return {
      ok: false,
      error: `Invalid run id "${runId}". Use 1-24 characters of [a-z0-9-], starting with a letter or digit.`,
    };
  }

  return { ok: true, invocation: { phase: phaseCandidate, runId, ...prefixesFor(runId) } };
}

export function isGovernancePhase(value: string): value is GovernancePhase {
  return (GOVERNANCE_VALIDATION_PHASES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The production guard
// ---------------------------------------------------------------------------

export const GOVERNANCE_VALIDATION_ENABLED_FLAG = "GOVERNANCE_VALIDATION_ENABLED";

/**
 * The variables this codebase actually uses to name a deployment.
 *
 * `RESONATE_ENVIRONMENT_ID` is the documented per-environment identity
 * (`health.controller.ts` returns it, `docs/deployment/environment.md` defines
 * it as `staging`, `prod`, …). `DEPLOY_ENV` and `APP_ENV` are the pair
 * `create_sample_show_campaigns.ts` already guards on, so a deployment that
 * sets either is already understood.
 *
 * **`NODE_ENV` is deliberately not in this list.** `backend/Dockerfile` sets
 * `ENV NODE_ENV=production` in the image, so every deployed environment —
 * staging included — reports `production` there. Treating it as the production
 * signal would make the harness refuse to run in the only place it is meant to
 * run, and treating its absence as safety would be worse. It names a Node build
 * mode, not a deployment.
 */
export const ENVIRONMENT_LABEL_VARIABLES = ["RESONATE_ENVIRONMENT_ID", "DEPLOY_ENV", "APP_ENV"] as const;

/** `prod`, `production`, `prd`, `live` as a whole word anywhere in the value. */
const PRODUCTION_LOOKING = /(^|[^a-z0-9])(prod|production|prd|live)([^a-z0-9]|$)/i;

export interface EnvironmentSignal {
  variable: string;
  value: string;
}

export type GuardDecision =
  | { allowed: true; environment: string; signals: EnvironmentSignal[] }
  | { allowed: false; reason: string };

/**
 * Decide whether this process may write fake governance fixtures.
 *
 * Fails closed three ways: without the explicit opt-in, without any
 * environment label at all, and on any label that looks like production. The
 * middle one matters as much as the last — an unlabelled deployment is not a
 * safe one, and the infrastructure job that sets the opt-in exists only in
 * non-production, so requiring a label costs a staging job one variable and
 * costs a mistake everything.
 */
export function assessEnvironment(env: NodeJS.ProcessEnv = process.env): GuardDecision {
  if (env[GOVERNANCE_VALIDATION_ENABLED_FLAG] !== "true") {
    return {
      allowed: false,
      reason:
        `Refusing to run: ${GOVERNANCE_VALIDATION_ENABLED_FLAG} is not "true". ` +
        "This harness writes fake analytics events and fake accounts; it must be opted into explicitly, " +
        "and only in a non-production environment.",
    };
  }

  const signals: EnvironmentSignal[] = [];
  for (const variable of ENVIRONMENT_LABEL_VARIABLES) {
    const value = env[variable]?.trim();
    if (value) signals.push({ variable, value });
  }

  if (signals.length === 0) {
    return {
      allowed: false,
      reason:
        `Refusing to run: no environment label is set. Set ${ENVIRONMENT_LABEL_VARIABLES[0]} (or ` +
        `${ENVIRONMENT_LABEL_VARIABLES.slice(1).join(" / ")}) so this can prove it is not production. ` +
        "NODE_ENV is not consulted: the backend image sets it to \"production\" in every environment.",
    };
  }

  for (const signal of signals) {
    if (PRODUCTION_LOOKING.test(signal.value)) {
      return {
        allowed: false,
        reason: `Refusing to run: ${signal.variable}="${signal.value}" looks like production.`,
      };
    }
  }

  const databaseHint = productionLookingDatabaseUrl(env.DATABASE_URL);
  if (databaseHint) {
    return {
      allowed: false,
      reason: `Refusing to run: DATABASE_URL points at something that looks like production (${databaseHint}).`,
    };
  }

  return { allowed: true, environment: signals[0].value, signals };
}

/**
 * Scan the database target, credentials removed.
 *
 * A false positive here costs a staging run one renamed variable; a false
 * negative costs a production database a set of fabricated accounts. The
 * password is stripped first so a credential containing "prod" cannot both
 * block the run and get quoted into an error message.
 */
function productionLookingDatabaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const withoutCredentials = value.replace(/\/\/[^/@]*@/, "//");
  const target = withoutCredentials.split("?")[0];
  return PRODUCTION_LOOKING.test(target) ? target : undefined;
}

/**
 * The `AnalyticsEvent.environment` label to stamp on seeded rows.
 *
 * Constrained to the ingest enum so the fixtures look like events the pipeline
 * could have produced, and never `prod` — the guard has already refused if the
 * environment says production, so mapping an unrecognised label to `dev` cannot
 * mislabel a production row.
 */
export function analyticsEnvironmentLabel(environment: string): "local" | "dev" | "staging" {
  const normalized = environment.trim().toLowerCase();
  if (normalized === "local" || normalized === "dev" || normalized === "staging") return normalized;
  return "dev";
}

// ---------------------------------------------------------------------------
// The retention fixture plan
// ---------------------------------------------------------------------------

export type RetentionTier = "sensitive" | "personal" | "pseudonymous";

export const RETENTION_TIERS: readonly RetentionTier[] = ["sensitive", "personal", "pseudonymous"];

export interface RetentionWindows {
  personalDays: number;
  sensitiveDays: number;
  pseudonymousDays: number;
}

export function retentionDaysFor(windows: RetentionWindows, tier: RetentionTier): number {
  if (tier === "personal") return windows.personalDays;
  if (tier === "sensitive") return windows.sensitiveDays;
  return windows.pseudonymousDays;
}

/**
 * What the policy promises should happen to a seeded row.
 *
 * `survives` is the one that matters. A retention run that deleted the whole
 * table would satisfy every `deleted` and every `redacted` expectation; only
 * the control rows can tell a policy from a truncate.
 */
export type RetentionDisposition = "deleted" | "redacted" | "survives";

/**
 * How far past the window an expired fixture is backdated.
 *
 * Generous because seed and the real job run are separate executions that may
 * be days apart — a fixture one hour past the cutoff would stop being expired
 * if someone ran the seed and then went home.
 */
export const RETENTION_EXPIRY_MARGIN_DAYS = 30;

/** How far inside the window a control fixture sits, for the same reason. */
export const RETENTION_CONTROL_MARGIN_DAYS = 30;

/** Deleted outright: nothing about a playback is a financial record. */
export const ORDINARY_EVENT_NAME = "playback.completed";

/**
 * One name per audit-preserved family, so all four of
 * `FINANCIAL_AUDIT_EVENT_FAMILIES` are exercised in every tier rather than
 * whichever one a fixture happened to pick.
 */
/**
 * One event name per audit-preserved family, derived from the governance rule
 * rather than restated here. Add a family there and these fixtures cover it on
 * the next run; a hand-maintained copy would have gone on passing while
 * testing less than it claimed.
 */
export const AUDIT_EVENT_NAMES: readonly string[] = [...FINANCIAL_AUDIT_EVENT_FAMILIES].map(
  (family) => `${family}.validation_fixture`,
);

export interface RetentionFixture {
  /** Stable within a run: the seed writes it, the verify phase looks it up. */
  key: string;
  tier: RetentionTier;
  eventName: string;
  auditPreserved: boolean;
  /** Days before `now`, which is the whole trick: 730-day expiry, observable today. */
  ageDays: number;
  occurredAt: Date;
  disposition: RetentionDisposition;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backdate a control row far enough inside the window to stay there.
 *
 * Clamped for short configured windows: with `ANALYTICS_RETENTION_SENSITIVE_DAYS=10`
 * a flat 30-day margin would put the "control" *past* the cutoff, and the
 * harness would assert that a correctly expired row had survived. The margin is
 * at least one day so a one-day window does not place the control exactly on
 * the cutoff, where a few seconds of drift between seeding and the job run
 * decides the outcome.
 */
export function controlAgeDays(windowDays: number): number {
  const margin = Math.max(1, Math.min(RETENTION_CONTROL_MARGIN_DAYS, Math.ceil(windowDays / 2)));
  return Math.max(0, windowDays - margin);
}

/**
 * The fixtures for one seeding, derived from the policy that is actually
 * configured rather than from the 90/395/730 defaults — a deployment that
 * narrowed a window must be validated against the window it narrowed to.
 */
export function retentionFixturePlan(windows: RetentionWindows, now: Date): RetentionFixture[] {
  const fixtures: RetentionFixture[] = [];
  const at = (ageDays: number) => new Date(now.getTime() - ageDays * DAY_MS);

  for (const tier of RETENTION_TIERS) {
    const windowDays = retentionDaysFor(windows, tier);
    const expiredAge = windowDays + RETENTION_EXPIRY_MARGIN_DAYS;
    const controlAge = controlAgeDays(windowDays);

    fixtures.push({
      key: `${tier}_expired_ordinary`,
      tier,
      eventName: ORDINARY_EVENT_NAME,
      auditPreserved: false,
      ageDays: expiredAge,
      occurredAt: at(expiredAge),
      disposition: "deleted",
    });

    for (const eventName of AUDIT_EVENT_NAMES) {
      fixtures.push({
        key: `${tier}_expired_audit_${eventName.split(".")[0]}`,
        tier,
        eventName,
        auditPreserved: true,
        ageDays: expiredAge,
        occurredAt: at(expiredAge),
        disposition: "redacted",
      });
    }

    fixtures.push({
      key: `${tier}_control_ordinary`,
      tier,
      eventName: ORDINARY_EVENT_NAME,
      auditPreserved: false,
      ageDays: controlAge,
      occurredAt: at(controlAge),
      disposition: "survives",
    });
    fixtures.push({
      key: `${tier}_control_audit`,
      tier,
      eventName: AUDIT_EVENT_NAMES[0],
      auditPreserved: true,
      ageDays: controlAge,
      occurredAt: at(controlAge),
      disposition: "survives",
    });
  }

  return fixtures;
}

/** What the governance service writes into `AnalyticsEvent` when it redacts. */
export const REDACTED_VALUE = "[redacted]";

/** Lineage actions `runRetentionCleanup` writes, which the verify phase asserts on. */
export const RETENTION_DELETED_ACTION = "retention_deleted";
export const RETENTION_REDACTED_ACTION = "retention_redacted";
export const WAREHOUSE_ERASURE_ACTION = "warehouse_erasure";

/**
 * A payload key the redactor leaves alone.
 *
 * `isSensitiveAnalyticsField` matches /(user|actor|email|wallet|session|trace|ip|device|cohort)/i,
 * and "marker" matches none of them. A redaction that emptied the whole payload
 * would be indistinguishable from a correct one without this.
 */
export const PAYLOAD_KEPT_KEY = "marker";

/** A payload key the redactor must empty. */
export const PAYLOAD_REDACTED_KEY = "userId";

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

export type ExpectationOperator = "equals" | "atLeast" | "atMost" | "contains" | "notContains";

export interface Expectation {
  /** Stable identifier, so a red job execution names the promise it broke. */
  id: string;
  /** Why this matters, in one line, for whoever reads the failure. */
  what: string;
  operator: ExpectationOperator;
  expected: unknown;
  actual: unknown;
}

export interface ExpectationOutcome extends Expectation {
  passed: boolean;
}

export interface VerificationReport {
  phase: string;
  status: "pass" | "fail";
  checked: number;
  passed: number;
  failed: number;
  failures: ExpectationOutcome[];
  outcomes: ExpectationOutcome[];
  /** Context worth logging that is not itself an assertion (warehouse status, counts). */
  observations: Record<string, unknown>;
}

/**
 * The whole verification step, as a pure function over observed-versus-expected.
 *
 * The database work is the part that collects `actual`; the part that decides
 * whether the policy was honoured is here, where it can be tested without a
 * container and cannot be accidentally softened by a query returning nothing.
 */
export function evaluateExpectations(
  phase: string,
  expectations: Expectation[],
  observations: Record<string, unknown> = {},
): VerificationReport {
  const outcomes: ExpectationOutcome[] = expectations.map((expectation) => ({
    ...expectation,
    passed: satisfies(expectation),
  }));
  const failures = outcomes.filter((outcome) => !outcome.passed);

  return {
    phase,
    status: failures.length === 0 ? "pass" : "fail",
    checked: outcomes.length,
    passed: outcomes.length - failures.length,
    failed: failures.length,
    failures,
    outcomes,
    observations,
  };
}

/**
 * An empty expectation list is a failure, not a pass.
 *
 * A verify phase whose queries all threw and left nothing to check would
 * otherwise report a green execution, which is the exact failure mode this
 * harness exists to remove.
 */
export function verificationExitCode(report: VerificationReport): 0 | 1 {
  return report.status === "pass" && report.checked > 0 ? 0 : 1;
}

function satisfies(expectation: Expectation): boolean {
  const { operator, expected, actual } = expectation;
  switch (operator) {
    case "equals":
      return deepEquals(actual, expected);
    case "atLeast":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "atMost":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":
      return containment(actual, expected);
    case "notContains":
      return !containment(actual, expected);
  }
}

function containment(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => deepEquals(item, expected));
  if (typeof actual === "string") return actual.includes(String(expected));
  return false;
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return normalizeDate(left) === normalizeDate(right);
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  return JSON.stringify(sortedKeys(left)) === JSON.stringify(sortedKeys(right));
}

function normalizeDate(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortedKeys(item)]),
  );
}
