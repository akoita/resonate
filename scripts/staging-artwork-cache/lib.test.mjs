import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CACHE_STATUS_KEYS,
  EvidenceError,
  IMAGE_BUDGET_BYTES,
  SCHEMA_VERSION,
  validateEvidence,
} from "./lib.mjs";

const EXAMPLE_PATH = new URL("./evidence.template.json", import.meta.url);
const EXAMPLE = JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));

function evidence() {
  return structuredClone(EXAMPLE);
}

function firstPhase(value) {
  return value.phases[0];
}

test("accepts the sanitized two-phase evidence template", () => {
  const summary = validateEvidence(evidence());
  assert.equal(summary.schemaVersion, SCHEMA_VERSION);
  assert.equal(summary.gate, "pass");
  assert.deepEqual(summary.phases.map(({ kind }) => kind), ["baseline", "candidate"]);
  assert.deepEqual(summary.phases.map(({ ttlSeconds }) => ttlSeconds), [0, 60]);
  assert.equal(summary.production, false);
  assert.equal(summary.fixturesDisposable, true);
});

test("requires exact source, release, image, deploy, IaC, and live revision evidence", () => {
  const missingSource = evidence();
  delete missingSource.sourceSha;
  assert.throws(() => validateEvidence(missingSource), /sourceSha/);

  for (const field of ["release", "images", "deploy", "iac", "live"]) {
    const missing = evidence();
    delete firstPhase(missing)[field];
    assert.throws(() => validateEvidence(missing), new RegExp(`phases\\[0\\]\\.${field}`));
  }

  const missingLiveRevision = evidence();
  delete firstPhase(missingLiveRevision).live.revision;
  assert.throws(() => validateEvidence(missingLiveRevision), /phases\[0\]\.live\.revision/);
});

test("requires one TTL=0 baseline and at least one nonzero candidate phase", () => {
  const noCandidate = evidence();
  noCandidate.phases = [noCandidate.phases[0]];
  assert.throws(() => validateEvidence(noCandidate), /baseline and at least one candidate/);

  const badBaseline = evidence();
  badBaseline.phases[0].ttlSeconds = 1;
  assert.throws(() => validateEvidence(badBaseline), /baseline TTL/);

  const badCandidate = evidence();
  badCandidate.phases[1].ttlSeconds = 0;
  assert.throws(() => validateEvidence(badCandidate), /candidate TTL/);
});

test("reuses unchanged services and rebuilds only the frontend for the candidate", () => {
  const rebuiltBackend = evidence();
  rebuiltBackend.phases[1].images.services[0].digest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  rebuiltBackend.phases[1].live.services[0].digest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  assert.throws(() => validateEvidence(rebuiltBackend), /reuse the unchanged backend image/);

  const staleFrontend = evidence();
  staleFrontend.phases[1].images.services[1].digest = staleFrontend.phases[0].images.services[1].digest;
  staleFrontend.phases[1].live.services[1].digest = staleFrontend.phases[0].live.services[1].digest;
  assert.throws(() => validateEvidence(staleFrontend), /rebuilt frontend image/);
});

test("requires five accepted cold/warm pairs with complete cache status counts", () => {
  const tooFew = evidence();
  tooFew.phases[0].performance.rawRuns.pop();
  assert.throws(() => validateEvidence(tooFew), /exactly 5 accepted cold\/warm pairs/);

  const badStatus = evidence();
  badStatus.phases[0].performance.cold.optimizerCache.statuses.HIT = 11;
  assert.throws(() => validateEvidence(badStatus), /requestCount|sum of statuses/);

  const missingStatus = evidence();
  delete missingStatus.phases[0].performance.warm.optimizerCache.statuses["unknown"];
  assert.throws(() => validateEvidence(missingStatus), /statuses\.unknown/);

  const unexpectedStatus = evidence();
  unexpectedStatus.phases[0].performance.cold.optimizerCache.statuses.FRESH = 1;
  assert.throws(() => validateEvidence(unexpectedStatus), /unsupported fields: FRESH/);

  assert.deepEqual(CACHE_STATUS_KEYS, ["HIT", "MISS", "STALE", "REVALIDATED", "unknown"]);

  const wrongAggregate = evidence();
  wrongAggregate.phases[0].performance.cold.optimizerCache.requestCount = 9;
  wrongAggregate.phases[0].performance.cold.optimizerCache.statuses.MISS = 9;
  wrongAggregate.phases[0].performance.cold.optimizerCache.misses = 9;
  assert.throws(() => validateEvidence(wrongAggregate), /sum across the five accepted runs/);
});

test("requires the 100 KiB heavy-image list to be present and within budget", () => {
  const wrongBudget = evidence();
  wrongBudget.phases[0].performance.breakdown.images.heavyThresholdBytes = IMAGE_BUDGET_BYTES - 1;
  assert.throws(() => validateEvidence(wrongBudget), /heavyThresholdBytes/);

  const heavy = evidence();
  heavy.phases[0].performance.breakdown.images.heavy = [{
    url: "https://staging.example.invalid/_next/image",
    bytes: IMAGE_BUDGET_BYTES + 1,
  }];
  heavy.phases[0].performance.breakdown.images.heavyCount = 1;
  heavy.phases[0].performance.breakdown.images.heavyBytes = IMAGE_BUDGET_BYTES + 1;
  assert.throws(() => validateEvidence(heavy), /heavy.*empty/);
});

test("requires Release and Shows before/after/restore revision, key, and byte fingerprints", () => {
  const revisionDrift = evidence();
  revisionDrift.phases[0].artwork.release.restore.revision = 9;
  assert.throws(() => validateEvidence(revisionDrift), /restore\.revision/);

  const keyDrift = evidence();
  keyDrift.phases[0].artwork.shows.after.key = keyDrift.phases[0].artwork.shows.before.key;
  assert.throws(() => validateEvidence(keyDrift), /after\.key/);

  const privateFixtureId = evidence();
  privateFixtureId.phases[0].artwork.release.fixtureId = "real-private-release-id";
  assert.throws(() => validateEvidence(privateFixtureId), /sanitized alias/);

  const fingerprintDrift = evidence();
  fingerprintDrift.phases[0].artwork.release.restore.fingerprint = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  assert.throws(() => validateEvidence(fingerprintDrift), /restore\.fingerprint/);

  const missingShows = evidence();
  delete missingShows.phases[0].artwork.shows;
  assert.throws(() => validateEvidence(missingShows), /artwork\.shows/);
});

test("requires production=false, disposable fixtures, and TTL-0 rollback", () => {
  const production = evidence();
  production.production = true;
  assert.throws(() => validateEvidence(production), /production/);

  const fixture = evidence();
  fixture.fixturesDisposable = false;
  assert.throws(() => validateEvidence(fixture), /fixturesDisposable/);

  const rollback = evidence();
  rollback.rollback.ttlSeconds = 60;
  assert.throws(() => validateEvidence(rollback), /rollback\.ttlSeconds/);

  const unverified = evidence();
  unverified.rollback.fixturesRestored = false;
  assert.throws(() => validateEvidence(unverified), /fixturesRestored/);
});

test("rejects secrets, private storage references, and unmodeled fields", () => {
  for (const [key, value] of [
    ["accessToken", "do-not-retain"],
    ["cookies", "session=do-not-retain"],
    ["storageUri", "gs://private-bucket/object"],
    ["originalPrivateDigest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ]) {
    const secret = evidence();
    secret.phases[0].artwork.release[key] = value;
    assert.throws(() => validateEvidence(secret), (error) => {
      assert.ok(error instanceof EvidenceError);
      assert.match(error.message, /secret-bearing|private/);
      return true;
    });
  }

  const credentialUrl = evidence();
  credentialUrl.sourceEvidenceUrl = "https://user:password@evidence.example.invalid/source";
  assert.throws(() => validateEvidence(credentialUrl), /secret-bearing|URL credentials/);

  const unknown = evidence();
  unknown.phases[0].performance.unmodeled = "value";
  assert.throws(() => validateEvidence(unknown), /unsupported fields: unmodeled/);
});
