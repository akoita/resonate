/**
 * The pure parts of the governance validation harness: phase parsing, the
 * production guard, the backdating plan, and the expectation checker.
 *
 * These are the parts that decide whether fake data may be written at all and
 * whether a job execution goes red, so they are tested without a database on
 * purpose — a guard that needs a connection in order to refuse is not a guard.
 */
import {
  AUDIT_EVENT_NAMES,
  DEFAULT_GOVERNANCE_VALIDATION_RUN_ID,
  Expectation,
  GOVERNANCE_VALIDATION_PHASES,
  GOVERNANCE_VALIDATION_PREFIX_ROOT,
  ORDINARY_EVENT_NAME,
  RETENTION_EXPIRY_MARGIN_DAYS,
  RetentionWindows,
  analyticsEnvironmentLabel,
  assessEnvironment,
  controlAgeDays,
  evaluateExpectations,
  parseInvocation,
  prefixesFor,
  retentionFixturePlan,
  verificationExitCode,
} from "../scripts/governance_validation_support";

const WINDOWS: RetentionWindows = { sensitiveDays: 90, personalDays: 395, pseudonymousDays: 730 };
const NOW = new Date("2026-09-19T00:00:00.000Z");

/** The minimum a staging job has to set for the harness to agree to run. */
const SAFE_ENV: NodeJS.ProcessEnv = {
  GOVERNANCE_VALIDATION_ENABLED: "true",
  RESONATE_ENVIRONMENT_ID: "staging",
};

describe("governance validation — phase parsing", () => {
  it("accepts every phase the infrastructure job can be given", () => {
    for (const phase of GOVERNANCE_VALIDATION_PHASES) {
      const parsed = parseInvocation([phase], {});
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.invocation.phase).toBe(phase);
    }
  });

  it("names the phases when none was given", () => {
    const parsed = parseInvocation([], {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("Missing phase");
      expect(parsed.error).toContain("seed-retention");
    }
  });

  it("rejects a phase that does not exist rather than guessing", () => {
    const parsed = parseInvocation(["verify"], {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('Unknown phase "verify"');
  });

  it("rejects an unknown flag, because a mistyped one must not be silently ignored", () => {
    const parsed = parseInvocation(["cleanup", "--force"], {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("--force");
  });

  it("takes the run id from the flag and does not mistake it for the phase", () => {
    const parsed = parseInvocation(["seed-retention", "--run-id", "sprint23"], {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.invocation.phase).toBe("seed-retention");
      expect(parsed.invocation.runId).toBe("sprint23");
    }
  });

  it("reads the run id from the environment when the flag is absent", () => {
    const parsed = parseInvocation(["cleanup"], { GOVERNANCE_VALIDATION_RUN_ID: "nightly" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.invocation.runId).toBe("nightly");
  });

  it("defaults the run id to a constant, because seed and verify are separate processes", () => {
    // Anything derived from the clock could not be rediscovered by the phase
    // that has to find the seeded rows again.
    const parsed = parseInvocation(["verify-retention"], {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.invocation.runId).toBe(DEFAULT_GOVERNANCE_VALIDATION_RUN_ID);
  });

  it("refuses a run id that could widen the delete prefix", () => {
    for (const runId of ["", "Run 1", "a_b", "%", "../x", "x".repeat(25)]) {
      const parsed = parseInvocation(["cleanup", "--run-id", runId], {});
      expect(parsed.ok).toBe(false);
    }
  });

  it("requires a value after --run-id", () => {
    const parsed = parseInvocation(["cleanup", "--run-id"], {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("--run-id requires a value");
  });

  it("derives every prefix from the one root that cleanup deletes on", () => {
    const parsed = parseInvocation(["seed-erasure", "--run-id", "abc"], {});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { prefix, retentionPrefix, erasurePrefix } = parsed.invocation;
    expect(prefix.startsWith(GOVERNANCE_VALIDATION_PREFIX_ROOT)).toBe(true);
    expect(retentionPrefix.startsWith(prefix)).toBe(true);
    expect(erasurePrefix.startsWith(prefix)).toBe(true);
    // The two fixture sets never overlap, so seeding one cannot wipe the other.
    expect(retentionPrefix.startsWith(erasurePrefix)).toBe(false);
    expect(erasurePrefix.startsWith(retentionPrefix)).toBe(false);
    expect(prefixesFor("abc")).toEqual({ prefix, retentionPrefix, erasurePrefix });
  });
});

describe("governance validation — the production guard", () => {
  it("refuses without the explicit opt-in", () => {
    const decision = assessEnvironment({ RESONATE_ENVIRONMENT_ID: "staging" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("GOVERNANCE_VALIDATION_ENABLED");
  });

  it("treats anything other than the exact string true as not opted in", () => {
    for (const value of ["TRUE", "1", "yes", "true ", ""]) {
      const decision = assessEnvironment({ ...SAFE_ENV, GOVERNANCE_VALIDATION_ENABLED: value });
      expect(decision.allowed).toBe(false);
    }
  });

  it("refuses when nothing labels the environment", () => {
    const decision = assessEnvironment({ GOVERNANCE_VALIDATION_ENABLED: "true" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("RESONATE_ENVIRONMENT_ID");
  });

  it("refuses on any label that looks like production, and says which one", () => {
    const cases: Array<[string, string]> = [
      ["RESONATE_ENVIRONMENT_ID", "prod"],
      ["RESONATE_ENVIRONMENT_ID", "production"],
      ["RESONATE_ENVIRONMENT_ID", "resonate-prod"],
      ["RESONATE_ENVIRONMENT_ID", "prd"],
      ["DEPLOY_ENV", "production"],
      ["APP_ENV", "live"],
    ];
    for (const [variable, value] of cases) {
      const decision = assessEnvironment({ GOVERNANCE_VALIDATION_ENABLED: "true", [variable]: value });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain(variable);
        expect(decision.reason).toContain("looks like production");
      }
    }
  });

  it("refuses when the database target looks like production even if the label does not", () => {
    const decision = assessEnvironment({
      ...SAFE_ENV,
      DATABASE_URL: "postgresql://app:secret@10.0.0.1:5432/resonate-production",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("DATABASE_URL");
  });

  it("does not let a credential containing prod block a staging run, or leak into the error", () => {
    const decision = assessEnvironment({
      ...SAFE_ENV,
      DATABASE_URL: "postgresql://app:prod-passw0rd@10.0.0.1:5432/resonate_staging",
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows a labelled non-production environment", () => {
    const decision = assessEnvironment(SAFE_ENV);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.environment).toBe("staging");
      expect(decision.signals).toEqual([{ variable: "RESONATE_ENVIRONMENT_ID", value: "staging" }]);
    }
  });

  it("ignores NODE_ENV, which the backend image sets to production in every environment", () => {
    // `backend/Dockerfile` has `ENV NODE_ENV=production`. Consulting it would
    // make the harness refuse to run in staging, which is the only place it is
    // meant to run.
    const decision = assessEnvironment({ ...SAFE_ENV, NODE_ENV: "production" });
    expect(decision.allowed).toBe(true);
  });

  it("does not let NODE_ENV alone stand in for an environment label", () => {
    const decision = assessEnvironment({ GOVERNANCE_VALIDATION_ENABLED: "true", NODE_ENV: "development" });
    expect(decision.allowed).toBe(false);
  });

  it("never stamps seeded analytics rows with the prod environment label", () => {
    expect(analyticsEnvironmentLabel("staging")).toBe("staging");
    expect(analyticsEnvironmentLabel("local")).toBe("local");
    expect(analyticsEnvironmentLabel("DEV")).toBe("dev");
    expect(analyticsEnvironmentLabel("whatever-else")).toBe("dev");
  });
});

describe("governance validation — the backdated retention plan", () => {
  const fixtures = retentionFixturePlan(WINDOWS, NOW);
  const ageOf = (key: string) => fixtures.find((fixture) => fixture.key === key)?.ageDays;

  it("covers all three tiers", () => {
    expect([...new Set(fixtures.map((fixture) => fixture.tier))].sort()).toEqual([
      "personal",
      "pseudonymous",
      "sensitive",
    ]);
  });

  it("backdates expired fixtures past each window, including the 730-day one", () => {
    expect(ageOf("sensitive_expired_ordinary")).toBe(90 + RETENTION_EXPIRY_MARGIN_DAYS);
    expect(ageOf("personal_expired_ordinary")).toBe(395 + RETENTION_EXPIRY_MARGIN_DAYS);
    expect(ageOf("pseudonymous_expired_ordinary")).toBe(730 + RETENTION_EXPIRY_MARGIN_DAYS);
  });

  it("puts a control row inside every window", () => {
    // Without these, a retention run that deleted the entire table would pass.
    for (const [tier, days] of [
      ["sensitive", 90],
      ["personal", 395],
      ["pseudonymous", 730],
    ] as const) {
      const control = fixtures.find((fixture) => fixture.key === `${tier}_control_ordinary`);
      expect(control?.disposition).toBe("survives");
      expect(control!.ageDays).toBeLessThan(days);
      expect(control!.ageDays).toBeGreaterThan(0);
    }
  });

  it("keeps a control inside a narrow configured window too", () => {
    // A flat 30-day margin would push the "control" past a 10-day cutoff, and
    // the harness would then assert that a correctly expired row survived.
    const narrow = retentionFixturePlan(
      { sensitiveDays: 10, personalDays: 3, pseudonymousDays: 1 },
      NOW,
    );
    for (const fixture of narrow.filter((candidate) => candidate.disposition === "survives")) {
      const windowDays = { sensitive: 10, personal: 3, pseudonymous: 1 }[fixture.tier];
      expect(fixture.ageDays).toBeLessThan(windowDays);
    }
    expect(controlAgeDays(10)).toBe(5);
    expect(controlAgeDays(3)).toBe(1);
    // Never exactly on the cutoff, where drift between seed and run decides it.
    expect(controlAgeDays(1)).toBe(0);
    expect(controlAgeDays(0)).toBe(0);
  });

  it("expects audit-preserved families to be redacted and ordinary events deleted", () => {
    const expired = fixtures.filter((fixture) => fixture.disposition !== "survives");
    for (const fixture of expired) {
      expect(fixture.disposition).toBe(fixture.auditPreserved ? "redacted" : "deleted");
    }
    const redactedNames = [
      ...new Set(expired.filter((fixture) => fixture.auditPreserved).map((fixture) => fixture.eventName)),
    ].sort();
    expect(redactedNames).toEqual([...AUDIT_EVENT_NAMES].sort());
    // Every audit family the service recognises: commerce, payment, rights, license.
    expect([...new Set(redactedNames.map((name) => name.split(".")[0]))].sort()).toEqual([
      "commerce",
      "license",
      "payment",
      "rights",
    ]);
    expect(expired.some((fixture) => fixture.eventName === ORDINARY_EVENT_NAME)).toBe(true);
  });

  it("follows the configured policy rather than the defaults", () => {
    const narrowed = retentionFixturePlan(
      { sensitiveDays: 30, personalDays: 60, pseudonymousDays: 120 },
      NOW,
    );
    const sensitive = narrowed.find((fixture) => fixture.key === "sensitive_expired_ordinary");
    expect(sensitive?.ageDays).toBe(30 + RETENTION_EXPIRY_MARGIN_DAYS);
  });

  it("derives occurredAt from the ages it reports", () => {
    for (const fixture of fixtures) {
      const expected = NOW.getTime() - fixture.ageDays * 24 * 60 * 60 * 1000;
      expect(fixture.occurredAt.getTime()).toBe(expected);
    }
  });

  it("gives every fixture a distinct key, because the verify phase looks rows up by it", () => {
    expect(new Set(fixtures.map((fixture) => fixture.key)).size).toBe(fixtures.length);
  });
});

describe("governance validation — the expectation checker", () => {
  const holds = (expectation: Expectation) =>
    evaluateExpectations("test", [expectation]).status === "pass";

  it("passes when every expectation holds", () => {
    const report = evaluateExpectations("verify-retention", [
      { id: "a", what: "", operator: "equals", expected: 0, actual: 0 },
      { id: "b", what: "", operator: "atLeast", expected: 1, actual: 3 },
    ]);
    expect(report.status).toBe("pass");
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
    expect(verificationExitCode(report)).toBe(0);
  });

  it("goes red and names the expectation that broke", () => {
    const report = evaluateExpectations("verify-retention", [
      { id: "retention.sensitive_control_ordinary.survived", what: "control row", operator: "equals", expected: 1, actual: 0 },
      { id: "fine", what: "", operator: "equals", expected: "x", actual: "x" },
    ]);
    expect(report.status).toBe("fail");
    expect(report.failed).toBe(1);
    expect(report.failures.map((failure) => failure.id)).toEqual([
      "retention.sensitive_control_ordinary.survived",
    ]);
    expect(verificationExitCode(report)).toBe(1);
  });

  it("fails an empty run rather than reporting a green execution that checked nothing", () => {
    const report = evaluateExpectations("verify-erasure", []);
    expect(report.checked).toBe(0);
    expect(verificationExitCode(report)).toBe(1);
  });

  it("compares equality without being fooled by types or key order", () => {
    expect(holds({ id: "", what: "", operator: "equals", expected: null, actual: null })).toBe(true);
    expect(holds({ id: "", what: "", operator: "equals", expected: null, actual: undefined })).toBe(false);
    expect(holds({ id: "", what: "", operator: "equals", expected: 0, actual: "0" })).toBe(false);
    expect(holds({ id: "", what: "", operator: "equals", expected: false, actual: false })).toBe(true);
    expect(
      holds({ id: "", what: "", operator: "equals", expected: { a: 1, b: 2 }, actual: { b: 2, a: 1 } }),
    ).toBe(true);
    expect(
      holds({
        id: "",
        what: "",
        operator: "equals",
        expected: new Date("2026-01-01T00:00:00.000Z"),
        actual: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("supports the containment operators the lineage checks use", () => {
    expect(
      holds({ id: "", what: "", operator: "contains", expected: "retention_deleted", actual: ["retention_deleted"] }),
    ).toBe(true);
    expect(
      holds({ id: "", what: "", operator: "contains", expected: "retention_deleted", actual: ["retention_redacted"] }),
    ).toBe(false);
    expect(holds({ id: "", what: "", operator: "contains", expected: "retention_deleted", actual: [] })).toBe(false);
    expect(
      holds({ id: "", what: "", operator: "notContains", expected: "failed", actual: ["ok", "skipped"] }),
    ).toBe(true);
  });

  it("does not pass a numeric comparison against a non-number", () => {
    expect(holds({ id: "", what: "", operator: "atLeast", expected: 1, actual: null })).toBe(false);
    expect(holds({ id: "", what: "", operator: "atMost", expected: 0, actual: undefined })).toBe(false);
  });

  it("carries observations through for the operator without asserting on them", () => {
    const report = evaluateExpectations("verify-retention", [], { warehouse: { statuses: ["skipped"] } });
    expect(report.observations).toEqual({ warehouse: { statuses: ["skipped"] } });
  });
});
