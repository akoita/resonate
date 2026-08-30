import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLASSIFICATIONS,
  EvidenceError,
  RPC_URL_ENV,
  SCHEMA_VERSION,
  collectEvidenceFromDocument,
  validateEvidence,
} from "./lib.mjs";

const TEMPLATE_PATH = new URL("./evidence.template.json", import.meta.url);
const TEMPLATE = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

function evidence() {
  return structuredClone(TEMPLATE);
}

function observedEvidence() {
  const document = evidence();
  const observation = document.observations[0];
  const txHash = `0x${"1".repeat(64)}`;
  observation.txHash = txHash;
  observation.direct.estimateGas = 21_000;
  observation.direct.receipt = {
    txHash,
    status: 1,
    gasUsed: 21_000,
    blockNumber: 12,
  };
  observation.comparison = {
    baseline: { status: 1, gasUsed: 21_000 },
    candidate: { status: 1, gasUsed: 21_000 },
  };
  observation.classification = "unchanged";
  return document;
}

test("accepts the sanitized evidence template", () => {
  const summary = validateEvidence(evidence());
  assert.equal(summary.schemaVersion, SCHEMA_VERSION);
  assert.equal(summary.chainId, 31337);
  assert.equal(summary.observationCount, 3);
  assert.equal(summary.classifications.not_applicable, 3);
});

test("rejects missing required fields", () => {
  const missingRepo = evidence();
  delete missingRepo.repo;
  assert.throws(() => validateEvidence(missingRepo), /repo: must be an object/);

  const missingObservationField = evidence();
  delete missingObservationField.observations[0].stateVariant;
  assert.throws(() => validateEvidence(missingObservationField), /stateVariant/);

  const missingReceiptField = observedEvidence();
  delete missingReceiptField.observations[0].direct.receipt.gasUsed;
  assert.throws(() => validateEvidence(missingReceiptField), /gasUsed/);
});

test("rejects private fields, secrets, and URL leakage", () => {
  const privateField = evidence();
  privateField.observations[0].privateKey = "fixture-secret";
  assert.throws(() => validateEvidence(privateField), (error) => {
    assert.ok(error instanceof EvidenceError);
    assert.match(error.message, /secret-bearing fields/);
    return true;
  });

  const urlInNotes = evidence();
  urlInNotes.observations[0].notes = "rpc https://rpc.example.invalid/secret";
  assert.throws(() => validateEvidence(urlInNotes), /URLs are forbidden/);

  const urlAsRpcIdentifier = evidence();
  urlAsRpcIdentifier.chain.rpcIdentifier = "https://rpc.example.invalid";
  assert.throws(() => validateEvidence(urlAsRpcIdentifier), /URLs are forbidden/);
});

test("rejects invalid classifications", () => {
  const invalid = evidence();
  invalid.observations[0].classification = "succeeded";
  assert.throws(() => validateEvidence(invalid), /must be one of/);
  assert.deepEqual(CLASSIFICATIONS, [
    "unchanged",
    "succeeds_with_repriced_gas",
    "estimate_mismatch",
    "execution_failure",
    "not_applicable",
    "blocked",
  ]);
});

test("requires an explicit baseline comparison for unchanged evidence", () => {
  assert.equal(validateEvidence(observedEvidence()).observationCount, 3);

  const missingComparison = observedEvidence();
  missingComparison.observations[0].comparison = null;
  assert.throws(() => validateEvidence(missingComparison), /explicit successful baseline and candidate runs/);

  const failedStatus = observedEvidence();
  failedStatus.observations[0].direct.receipt.status = 0;
  assert.throws(() => validateEvidence(failedStatus), /status 0 requires execution_failure/);

  const invalidGas = observedEvidence();
  invalidGas.observations[0].direct.receipt.gasUsed = "21000";
  assert.throws(() => validateEvidence(invalidGas), /gasUsed: must be an integer/);

  const mismatchedCandidate = observedEvidence();
  mismatchedCandidate.observations[0].comparison.candidate.gasUsed = 22_000;
  assert.throws(() => validateEvidence(mismatchedCandidate), /matching baseline and candidate/);

  const changedFromBaseline = observedEvidence();
  changedFromBaseline.observations[0].comparison.baseline.gasUsed = 20_000;
  assert.throws(() => validateEvidence(changedFromBaseline), /matching baseline and candidate/);
});

test("accepts headroom estimates and classifies harmful underestimates", () => {
  const headroom = observedEvidence();
  headroom.observations[0].comparison = null;
  headroom.observations[0].direct.estimateGas = 22_000;
  headroom.observations[0].direct.receipt.gasUsed = 21_000;
  headroom.observations[0].classification = "succeeds_with_repriced_gas";
  assert.equal(validateEvidence(headroom).observationCount, 3);

  const underestimation = observedEvidence();
  underestimation.observations[0].comparison = null;
  underestimation.observations[0].direct.estimateGas = 20_000;
  underestimation.observations[0].direct.receipt.gasUsed = 21_000;
  underestimation.observations[0].classification = "estimate_mismatch";
  assert.equal(validateEvidence(underestimation).observationCount, 3);

  const overestimateMismatch = observedEvidence();
  overestimateMismatch.observations[0].comparison = null;
  overestimateMismatch.observations[0].direct.estimateGas = 22_000;
  overestimateMismatch.observations[0].direct.receipt.gasUsed = 21_000;
  overestimateMismatch.observations[0].classification = "estimate_mismatch";
  assert.throws(() => validateEvidence(overestimateMismatch), /estimate below receipt gas/);
});

test("accepts deterministic multi-block simulation evidence without inventing a receipt", () => {
  const simulated = evidence();
  const observation = simulated.observations[0];
  observation.simulation = {
    method: "eth_simulateV1",
    status: 1,
    gasUsed: 42_000,
    blockNumber: 20,
    timestamp: 1_788_099_650,
  };
  observation.classification = "succeeds_with_repriced_gas";
  assert.equal(validateEvidence(simulated).observationCount, 3);

  const blocked = structuredClone(simulated);
  blocked.observations[0].classification = "blocked";
  blocked.observations[0].blocker = "external prerequisite";
  assert.throws(() => validateEvidence(blocked), /cannot carry receipt or simulation evidence/);
});

test("collects chain metadata and receipts through the read-only method allowlist", async () => {
  const document = evidence();
  const observation = document.observations[0];
  observation.txHash = `0x${"2".repeat(64)}`;
  observation.direct.estimateGas = 22_000;
  const methods = [];
  const fetchImpl = async (_rpcUrl, request) => {
    const body = JSON.parse(request.body);
    methods.push(body.method);
    if (body.method === "eth_chainId") return { ok: true, json: async () => ({ result: "0x7a69" }) };
    if (body.method === "eth_blockNumber") return { ok: true, json: async () => ({ result: "0x2a" }) };
    if (body.method === "eth_getTransactionReceipt") {
      return {
        ok: true,
        json: async () => ({
          result: {
            transactionHash: observation.txHash,
            status: "0x1",
            gasUsed: "0x5208",
            blockNumber: "0x2a",
          },
        }),
      };
    }
    throw new Error(`unexpected method ${body.method}`);
  };

  const collected = await collectEvidenceFromDocument(document, {
    fetchImpl,
    env: { [RPC_URL_ENV]: "https://rpc.example.invalid", GLAMSTERDAM_RPC_IDENTIFIER: "local-anvil" },
  });
  assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber", "eth_getTransactionReceipt"]);
  assert.equal(collected.chain.chainId, 31_337);
  assert.equal(collected.chain.blockNumber, 42);
  assert.equal(collected.observations[0].direct.receipt.gasUsed, 21_000);
  assert.equal(collected.observations[0].classification, "succeeds_with_repriced_gas");
  assert.doesNotMatch(JSON.stringify(collected), /rpc\.example\.invalid/);
  assert.doesNotMatch(JSON.stringify(collected), /private|secret|token/i);

  methods.length = 0;
  observation.direct.estimateGas = 20_000;
  const underCollected = await collectEvidenceFromDocument(document, {
    fetchImpl,
    env: { [RPC_URL_ENV]: "https://rpc.example.invalid", GLAMSTERDAM_RPC_IDENTIFIER: "local-anvil" },
  });
  assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber", "eth_getTransactionReceipt"]);
  assert.equal(underCollected.observations[0].classification, "estimate_mismatch");
});

test("requires the RPC endpoint to come from the environment", async () => {
  await assert.rejects(
    () => collectEvidenceFromDocument(evidence(), { fetchImpl: async () => ({}) , env: {} }),
    /GLAMSTERDAM_RPC_URL/,
  );
});
