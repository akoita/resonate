import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_EXPECTED_SELECTORS,
  classifyLoad,
  classifyPair,
  collectRuns,
  ensureUsableRuns,
  expectedSelectorsForRoute,
  summarize,
} from "./measure-home-performance.mjs";

const completeHome = (status = 200) =>
  classifyLoad({
    status,
    expectedSelectors: HOME_EXPECTED_SELECTORS,
    presentSelectors: HOME_EXPECTED_SELECTORS,
  });

const incompleteHome = (presentSelectors = [], status = 200) =>
  classifyLoad({
    status,
    expectedSelectors: HOME_EXPECTED_SELECTORS,
    presentSelectors,
  });

function attempt(coldCheck, warmCheck, label = "sample") {
  const pair = classifyPair(coldCheck, warmCheck);
  return {
    label,
    coldCheck,
    warmCheck,
    ok: pair.ok,
    reasons: pair.reasons,
  };
}

test("accepts a complete 2xx Home load", () => {
  const check = completeHome();

  assert.equal(check.ok, true);
  assert.equal(check.validation, "selectors");
  assert.deepEqual(check.missingSelectors, []);
  assert.deepEqual(check.reasons, []);
});

test("rejects a 2xx Home load with one missing landmark", () => {
  const missing = HOME_EXPECTED_SELECTORS.at(-1);
  const check = incompleteHome(HOME_EXPECTED_SELECTORS.slice(0, -1));

  assert.equal(check.statusOk, true);
  assert.equal(check.structurallyComplete, false);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missingSelectors, [missing]);
  assert.deepEqual(check.reasons, [`missing expected selector(s): ${missing}`]);
});

test("rejects a 2xx response when the entire Home root is absent", () => {
  const check = incompleteHome();

  assert.equal(check.ok, false);
  assert.deepEqual(check.presentSelectors, []);
  assert.deepEqual(check.missingSelectors, HOME_EXPECTED_SELECTORS);
});

test("rejects a structurally complete non-2xx response", () => {
  const check = completeHome(429);

  assert.equal(check.statusOk, false);
  assert.equal(check.structurallyComplete, true);
  assert.equal(check.ok, false);
  assert.deepEqual(check.reasons, ["document status 429 (expected 2xx)"]);
});

test("rejects a pair when cold is complete but warm is incomplete", () => {
  const missing = HOME_EXPECTED_SELECTORS[1];
  const warm = incompleteHome(HOME_EXPECTED_SELECTORS.filter((selector) => selector !== missing));
  const pair = classifyPair(completeHome(), warm);

  assert.equal(pair.ok, false);
  assert.deepEqual(pair.reasons, [`warm: missing expected selector(s): ${missing}`]);
});

test("retries after a structural rejection and accepts the next complete pair", async () => {
  const rejected = attempt(incompleteHome(), completeHome(), "partial");
  const accepted = attempt(completeHome(), completeHome(), "complete");
  const attempts = [rejected, accepted];

  const result = await collectRuns({
    requestedRuns: 1,
    maxRetries: 1,
    measureAttempt: async (attemptNumber) => attempts[attemptNumber - 1],
  });

  assert.deepEqual(
    result.runs.map((run) => run.label),
    ["complete"],
  );
  assert.equal(result.discarded.length, 1);
  assert.equal(result.discarded[0].attempt, 1);
  assert.deepEqual(result.discarded[0].cold.missingSelectors, HOME_EXPECTED_SELECTORS);
  assert.match(result.discarded[0].reasons[0], /^cold: missing expected selector/);
});

test("fails before an empty sample set can be summarized", () => {
  assert.throws(() => ensureUsableRuns([]), /No usable performance runs/);
  assert.throws(() => summarize([]), /No usable performance runs/);
});

test("uses an explicit selector for alternate routes", () => {
  const expected = expectedSelectorsForRoute("/catalog", ".home-ng.ng-catalog-page");
  const check = classifyLoad({
    status: 200,
    expectedSelectors: expected,
    presentSelectors: [".home-ng.ng-catalog-page"],
  });

  assert.deepEqual(expected, [".home-ng.ng-catalog-page"]);
  assert.equal(check.validation, "selectors");
  assert.equal(check.ok, true);
});

test("falls back to status-only validation for alternate routes without a selector", () => {
  const expected = expectedSelectorsForRoute("/catalog");
  const ok = classifyLoad({ status: 204, expectedSelectors: expected });
  const rejected = classifyLoad({ status: 500, expectedSelectors: expected });

  assert.deepEqual(expected, []);
  assert.equal(ok.validation, "status-only");
  assert.equal(ok.ok, true);
  assert.equal(rejected.ok, false);
});

test("discard diagnostics retain exact cold and warm checks", async () => {
  const missing = HOME_EXPECTED_SELECTORS[2];
  const cold = completeHome(503);
  const warm = incompleteHome(HOME_EXPECTED_SELECTORS.filter((selector) => selector !== missing));
  const rejected = attempt(cold, warm);

  const result = await collectRuns({
    requestedRuns: 1,
    maxRetries: 0,
    measureAttempt: async () => rejected,
  });

  assert.deepEqual(result.runs, []);
  assert.deepEqual(result.discarded[0].reasons, [
    "cold: document status 503 (expected 2xx)",
    `warm: missing expected selector(s): ${missing}`,
  ]);
  assert.equal(result.discarded[0].cold.status, 503);
  assert.deepEqual(result.discarded[0].warm.missingSelectors, [missing]);
  assert.throws(() => ensureUsableRuns(result.runs), /No usable performance runs/);
});
