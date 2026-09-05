import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_CHECKS,
  EvidenceError,
  SCHEMA_VERSION,
  SMOKE_CHECKS,
  validateEvidence,
} from "./lib.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const SOURCE_SHA = "1".repeat(40);
const URL = "https://github.com/akoita/resonate/actions/runs/123";

function pass(comparison) {
  return {
    status: "pass",
    ...(comparison ? { comparison } : {}),
    evidenceUrl: URL,
  };
}

function validEvidence() {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-08-27T20:00:00Z",
    issueUrl: "https://github.com/akoita/resonate/issues/1663",
    configuration: Object.fromEntries(CONFIGURATION_CHECKS.map((name) => [name, pass("equal")])),
    migration: {
      status: "pass",
      strictCutover: true,
      identityContinuity: true,
      rowParity: true,
      indexerCursors: true,
      sampleContent: true,
      sourceSnapshotSha256: DIGEST_A,
      targetSnapshotSha256: DIGEST_B,
      receiptSha256: DIGEST_A,
      evidenceUrl: URL,
    },
    sourceReferences: {
      status: "pass",
      checks: {
        "source-project": { remaining: 0 },
        "source-bucket": { remaining: 0 },
      },
      evidenceUrl: URL,
    },
    smoke: {
      ...Object.fromEntries(SMOKE_CHECKS.map((name) => [name, pass()])),
      analytics: { ...pass(), mode: "batch" },
    },
    deployment: {
      acceptedSourceSha: SOURCE_SHA,
      liveSourceSha: SOURCE_SHA,
      manifestSha256: DIGEST_A,
      evidenceUrl: URL,
      services: ["backend", "frontend", "demucs"].map((name, index) => ({
        name,
        expectedDigest: index === 0 ? DIGEST_A : DIGEST_B,
        liveDigest: index === 0 ? DIGEST_A : DIGEST_B,
        liveRevision: `resonate-prod-${name}-00001`,
        evidenceUrl: URL,
      })),
    },
    rollback: {
      failureBlocksCutover: true,
      sourceRetained: true,
      trigger: "Any red gate repoints edge traffic to the retained source.",
      observationWindow: "Owner-approved window recorded in the private run log.",
      sourceRetentionWindow: "Source retained through the observation window.",
      evidenceUrl: URL,
    },
    authorization: {
      migrationAuthorized: false,
      deploymentAuthorized: false,
      contractChangesAuthorized: false,
      productionGoLiveAuthorized: false,
    },
  };
}

test("accepts a complete secret-free fail-closed receipt", () => {
  const evidence = validEvidence();
  evidence.smoke.analytics.mode = "batch";
  const summary = validateEvidence(evidence);
  assert.equal(summary.cutoverGate, "pass");
  assert.equal(summary.authorization, "none");
  assert.deepEqual(summary.services.map(({ name }) => name), ["backend", "frontend", "demucs"]);
});

test("accepts reviewed disabled analytics without pretending a live path ran", () => {
  const evidence = validEvidence();
  evidence.smoke.analytics.mode = "disabled";
  evidence.smoke.analytics.outcome = "disabled-reviewed";
  assert.equal(validateEvidence(evidence).analyticsMode, "disabled");
});

test("rejects incomplete configuration evidence", () => {
  const evidence = validEvidence();
  delete evidence.configuration.runtime_allowlists;
  assert.throws(() => validateEvidence(evidence), /configuration\.runtime_allowlists/);
});

test("rejects stale source references", () => {
  const evidence = validEvidence();
  evidence.sourceReferences.checks["source-bucket"].remaining = 1;
  assert.throws(() => validateEvidence(evidence), /source-bucket\.remaining/);
});

test("rejects live source or image identity drift", () => {
  const sourceDrift = validEvidence();
  sourceDrift.deployment.liveSourceSha = "2".repeat(40);
  assert.throws(() => validateEvidence(sourceDrift), /liveSourceSha/);

  const digestDrift = validEvidence();
  digestDrift.deployment.services[0].liveDigest = DIGEST_B;
  assert.throws(() => validateEvidence(digestDrift), /liveDigest/);
});

test("requires backend, frontend, and Demucs live revisions", () => {
  const evidence = validEvidence();
  evidence.deployment.services = evidence.deployment.services.filter(({ name }) => name !== "demucs");
  assert.throws(() => validateEvidence(evidence), /must include demucs/);
});

test("rejects any failed smoke gate", () => {
  const evidence = validEvidence();
  evidence.smoke.passkey_reauthentication.status = "fail";
  assert.throws(() => validateEvidence(evidence), /passkey_reauthentication\.status/);
});

test("rejects missing rollback boundaries or accidental authorization", () => {
  const rollback = validEvidence();
  rollback.rollback.sourceRetained = false;
  assert.throws(() => validateEvidence(rollback), /sourceRetained/);

  const authorized = validEvidence();
  authorized.authorization.productionGoLiveAuthorized = true;
  assert.throws(() => validateEvidence(authorized), /productionGoLiveAuthorized/);
});

test("rejects secret-bearing fields and credentialed evidence URLs", () => {
  const secret = validEvidence();
  secret.configuration.storage.secretValue = "do-not-retain";
  assert.throws(() => validateEvidence(secret), (error) => {
    assert.ok(error instanceof EvidenceError);
    assert.match(error.message, /secret-bearing fields/);
    return true;
  });

  const credentialed = validEvidence();
  credentialed.smoke.health.evidenceUrl = "https://user:password@example.com/run";
  assert.throws(() => validateEvidence(credentialed), /must not contain URL credentials/);
});

test("rejects unmodeled retained values even when their key does not look secret", () => {
  const evidence = validEvidence();
  evidence.configuration.storage.value = "project-specific-runtime-value";
  assert.throws(() => validateEvidence(evidence), /contains unsupported fields: value/);
});
