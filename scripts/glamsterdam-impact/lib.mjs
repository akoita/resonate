import { readFile } from "node:fs/promises";

export const SCHEMA_VERSION = "resonate-glamsterdam-repricing-evidence/v1";
export const RPC_URL_ENV = "GLAMSTERDAM_RPC_URL";
export const RPC_IDENTIFIER_ENV = "GLAMSTERDAM_RPC_IDENTIFIER";

export const CLASSIFICATIONS = Object.freeze([
  "unchanged",
  "succeeds_with_repriced_gas",
  "estimate_mismatch",
  "execution_failure",
  "not_applicable",
  "blocked",
]);

export const FLOW_IDS = Object.freeze([
  "aa_entrypoint_deployment",
  "kernel_factory_create2",
  "kernel_factory_initialization",
  "protocol_deployment",
  "stem_nft_mint",
  "stem_nft_authorized_mint",
  "stem_nft_remix",
  "content_protection_registration",
  "content_protection_stake",
  "content_protection_refund",
  "content_protection_slash",
  "content_protection_revoke_whole_array",
  "content_protection_revoke_paginated",
  "stem_marketplace_list",
  "stem_marketplace_partial_purchase",
  "stem_marketplace_full_purchase",
  "stem_marketplace_recovery",
  "revenue_escrow_deposit",
  "revenue_escrow_release",
  "revenue_escrow_redirect",
  "revenue_escrow_recovery",
  "show_campaign_create",
  "show_campaign_pledge",
  "show_campaign_release",
  "show_campaign_refund",
  "registry_storage_growth",
  "dispute_storage_growth",
  "curation_storage_growth",
]);

const SOURCE_SHA = /^[0-9a-f]{40}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const RPC_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Retained evidence is public and must never become a side channel for a
// credential, a signed URL, or an RPC endpoint. Check this recursively before
// shape validation so future schema additions remain fail-closed.
const FORBIDDEN_KEY = /(?:access.?token|refresh.?token|bearer|cookie|password|secret|credential|authorization|api.?key|private.?key|mnemonic|seed.?phrase|raw.?transaction|signed.?transaction|rpc.?url|endpoint.?url)/i;
const FORBIDDEN_VALUE = /(?:\b(?:https?|wss?|file|data|gs|s3|az):\/\/|\/\/[^/\s:@]+:[^@/\s]+@|(?:^|[?&#\s])(?:access[_-]?token|refresh[_-]?token|token|cookie|signature|sig|secret|api[_-]?key|private[_-]?key)=)/i;

export class EvidenceError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "EvidenceError";
    this.path = path;
  }
}

function fail(path, message) {
  throw new EvidenceError(path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value;
}

function exactKeys(value, allowed, path) {
  const entry = object(value, path);
  const unexpected = Object.keys(entry).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(path, `contains unsupported fields: ${unexpected.join(", ")}`);
  }
  return entry;
}

function string(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function nullableString(value, path) {
  if (value === null) return null;
  return string(value, path);
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `must be an integer from ${min} through ${max}`);
  }
  return value;
}

function nullableInteger(value, path, options = {}) {
  if (value === null) return null;
  return integer(value, path, options);
}

function hexAddress(value, path) {
  if (!ADDRESS.test(string(value, path))) fail(path, "must be a 20-byte hexadecimal address");
  return value;
}

function hexHash(value, path) {
  if (!HASH.test(string(value, path))) fail(path, "must be a 32-byte hexadecimal hash");
  return value;
}

function sourceSha(value, path) {
  if (!SOURCE_SHA.test(string(value, path))) {
    fail(path, "must be a full lowercase 40-character source SHA");
  }
  return value;
}

function rejectSensitiveShape(value, path = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE.test(value)) {
      fail(path, "secret-bearing values and URLs are forbidden in retained evidence");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      fail(`${path}.${key}`, "secret-bearing fields are forbidden in retained evidence");
    }
    rejectSensitiveShape(child, `${path}.${key}`);
  }
}

function validateReceipt(value, path, expectedTxHash = null) {
  if (value === null) return null;
  const receipt = exactKeys(value, ["txHash", "status", "gasUsed", "blockNumber"], path);
  const txHash = hexHash(receipt.txHash, `${path}.txHash`);
  if (expectedTxHash !== null && txHash.toLowerCase() !== expectedTxHash.toLowerCase()) {
    fail(`${path}.txHash`, "must equal the supplied transaction hash");
  }
  const status = integer(receipt.status, `${path}.status`, { min: 0, max: 1 });
  const gasUsed = integer(receipt.gasUsed, `${path}.gasUsed`, { min: 1 });
  const blockNumber = integer(receipt.blockNumber, `${path}.blockNumber`);
  return { txHash, status, gasUsed, blockNumber };
}

function validateDirect(value, path, observationTxHash) {
  const direct = exactKeys(value, ["estimateGas", "receipt"], path);
  const estimateGas = nullableInteger(direct.estimateGas, `${path}.estimateGas`, { min: 1 });
  const receipt = validateReceipt(direct.receipt, `${path}.receipt`, observationTxHash);
  return { estimateGas, receipt };
}

function validateSimulation(value, path) {
  if (value === undefined || value === null) return null;
  const simulation = exactKeys(value, ["method", "status", "gasUsed", "blockNumber", "timestamp"], path);
  if (string(simulation.method, `${path}.method`) !== "eth_simulateV1") {
    fail(`${path}.method`, "must be eth_simulateV1");
  }
  return {
    method: simulation.method,
    status: integer(simulation.status, `${path}.status`, { min: 0, max: 1 }),
    gasUsed: integer(simulation.gasUsed, `${path}.gasUsed`, { min: 1 }),
    blockNumber: integer(simulation.blockNumber, `${path}.blockNumber`),
    timestamp: integer(simulation.timestamp, `${path}.timestamp`, { min: 1 }),
  };
}

function validateUserOperation(value, path) {
  if (value === null) return null;
  const userOperation = exactKeys(value, ["estimateGas", "hash", "txHash", "receipt"], path);
  const estimateGas = nullableInteger(userOperation.estimateGas, `${path}.estimateGas`, { min: 1 });
  const hash = userOperation.hash === null ? null : hexHash(userOperation.hash, `${path}.hash`);
  const txHash = userOperation.txHash === null ? null : hexHash(userOperation.txHash, `${path}.txHash`);
  const receipt = validateReceipt(userOperation.receipt, `${path}.receipt`, txHash);
  if (receipt !== null && txHash === null) {
    fail(`${path}.txHash`, "is required when a UserOperation receipt is supplied");
  }
  if (hash === null && (estimateGas !== null || txHash !== null || receipt !== null)) {
    fail(`${path}.hash`, "is required when UserOperation evidence is supplied");
  }
  return { estimateGas, hash, txHash, receipt };
}

function validateComparison(value, path) {
  if (value === null) return null;
  const comparison = exactKeys(value, ["baseline", "candidate"], path);
  const runs = {};
  for (const name of ["baseline", "candidate"]) {
    const runPath = `${path}.${name}`;
    const run = exactKeys(comparison[name], ["status", "gasUsed"], runPath);
    runs[name] = {
      status: integer(run.status, `${runPath}.status`, { min: 0, max: 1 }),
      gasUsed: integer(run.gasUsed, `${runPath}.gasUsed`, { min: 1 }),
    };
  }
  return runs;
}

function validateContractSet(value) {
  if (!Array.isArray(value) || value.length === 0) fail("contracts", "must be a non-empty array");
  return value.map((rawContract, index) => {
    const path = `contracts[${index}]`;
    const contract = exactKeys(rawContract, ["role", "address"], path);
    string(contract.role, `${path}.role`);
    hexAddress(contract.address, `${path}.address`);
    return contract;
  });
}

function comparablePairs(observation) {
  const pairs = [];
  if (observation.direct.estimateGas !== null && observation.direct.receipt !== null) {
    pairs.push({ estimateGas: observation.direct.estimateGas, gasUsed: observation.direct.receipt.gasUsed });
  }
  if (
    observation.userOperation !== null &&
    observation.userOperation.estimateGas !== null &&
    observation.userOperation.receipt !== null
  ) {
    pairs.push({
      estimateGas: observation.userOperation.estimateGas,
      gasUsed: observation.userOperation.receipt.gasUsed,
    });
  }
  return pairs;
}

function validateObservation(value, index, chainRpcIdentifier) {
  const path = `observations[${index}]`;
  const observation = exactKeys(
    value,
    [
      "flow",
      "stateVariant",
      "contractRole",
      "contractAddress",
      "direct",
      "simulation",
      "userOperation",
      "txHash",
      "comparison",
      "classification",
      "rpcIdentifier",
      "notes",
      "blocker",
    ],
    path,
  );
  if (!FLOW_IDS.includes(observation.flow)) fail(`${path}.flow`, "is not a supported characterization flow");
  string(observation.stateVariant, `${path}.stateVariant`);
  string(observation.contractRole, `${path}.contractRole`);
  hexAddress(observation.contractAddress, `${path}.contractAddress`);
  const txHash = observation.txHash === null ? null : hexHash(observation.txHash, `${path}.txHash`);
  const direct = validateDirect(observation.direct, `${path}.direct`, txHash);
  const simulation = validateSimulation(observation.simulation, `${path}.simulation`);
  const userOperation = validateUserOperation(observation.userOperation, `${path}.userOperation`);
  const comparison = validateComparison(observation.comparison, `${path}.comparison`);
  const classification = string(observation.classification, `${path}.classification`);
  if (!CLASSIFICATIONS.includes(classification)) {
    fail(`${path}.classification`, `must be one of ${CLASSIFICATIONS.join(", ")}`);
  }
  const rpcIdentifier = string(observation.rpcIdentifier, `${path}.rpcIdentifier`);
  if (!RPC_IDENTIFIER.test(rpcIdentifier)) fail(`${path}.rpcIdentifier`, "must be a redacted identifier, not a URL");
  if (rpcIdentifier !== chainRpcIdentifier) fail(`${path}.rpcIdentifier`, "must equal chain.rpcIdentifier");
  string(observation.notes, `${path}.notes`);
  const blocker = nullableString(observation.blocker, `${path}.blocker`);

  const receipts = [direct.receipt, ...(userOperation === null ? [] : [userOperation.receipt])].filter(
    (receipt) => receipt !== null,
  );
  const executions = [...receipts, ...(simulation === null ? [] : [simulation])];
  const hasFailure = executions.some((execution) => execution.status === 0);
  const hasSuccess = executions.some((execution) => execution.status === 1);
  const pairs = comparablePairs({ direct, userOperation });
  const hasUserOperationEstimate = userOperation !== null && userOperation.estimateGas !== null;
  const hasUserOperationTransaction = userOperation !== null && userOperation.txHash !== null;
  const hasUserOperationReceipt = userOperation !== null && userOperation.receipt !== null;
  const hasEstimate = direct.estimateGas !== null || hasUserOperationEstimate;
  const hasTransaction =
    txHash !== null ||
    direct.receipt !== null ||
    hasUserOperationTransaction ||
    hasUserOperationReceipt;
  const hasExecution = hasTransaction || simulation !== null;
  // Estimates with ordinary headroom are valid. Only an estimate below the
  // mined gasUsed is a harmful mismatch that can underfund a transaction.
  const hasUnderestimate = pairs.some(({ estimateGas, gasUsed }) => estimateGas < gasUsed);

  if (direct.receipt !== null && txHash === null) {
    fail(`${path}.txHash`, "is required when a direct receipt is supplied");
  }
  if (classification !== "execution_failure" && hasFailure) {
    fail(`${path}.classification`, "a receipt with status 0 requires execution_failure");
  }
  if (classification === "unchanged") {
    const candidateReceipt = receipts.find(
      (receipt) =>
        comparison !== null &&
        receipt.status === comparison.candidate.status &&
        receipt.gasUsed === comparison.candidate.gasUsed,
    );
    if (comparison === null || comparison.baseline.status !== 1 || comparison.candidate.status !== 1) {
      fail(`${path}.comparison`, "unchanged requires explicit successful baseline and candidate runs");
    }
    if (
      comparison.baseline.status !== comparison.candidate.status ||
      comparison.baseline.gasUsed !== comparison.candidate.gasUsed
    ) {
      fail(`${path}.comparison`, "unchanged requires matching baseline and candidate status/gas evidence");
    }
    if (!hasSuccess || candidateReceipt === undefined) {
      fail(`${path}.classification`, "unchanged requires a successful target receipt and explicit baseline comparison");
    }
  } else if (classification === "succeeds_with_repriced_gas") {
    if (!hasSuccess) fail(`${path}.classification`, "requires a successful receipt");
  } else if (classification === "estimate_mismatch") {
    if (!hasSuccess || !hasUnderestimate) {
      fail(`${path}.classification`, "requires a successful receipt and an estimate below receipt gas");
    }
  } else if (classification === "execution_failure") {
    if (!hasFailure) fail(`${path}.classification`, "requires at least one receipt with status 0");
  } else if (classification === "not_applicable") {
    if (hasExecution || hasEstimate) {
      fail(`${path}.classification`, "cannot carry transaction or estimate evidence");
    }
  } else if (classification === "blocked") {
    if (blocker === null) fail(`${path}.blocker`, "is required for blocked evidence");
    if (executions.length > 0) fail(`${path}.classification`, "cannot carry receipt or simulation evidence");
  }

  if (classification !== "unchanged" && comparison !== null) {
    fail(`${path}.comparison`, "must be null unless classification is unchanged");
  }

  if (classification !== "blocked" && blocker !== null) {
    fail(`${path}.blocker`, "must be null unless classification is blocked");
  }
  return {
    flow: observation.flow,
    classification,
    hasReceipt: receipts.length > 0,
    hasSimulation: simulation !== null,
    hasFailure,
    hasSuccess,
    hasEstimate,
    hasUnderestimate,
  };
}

export function validateEvidence(document) {
  const evidence = exactKeys(
    document,
    ["schemaVersion", "generatedAt", "repo", "chain", "contracts", "observations"],
    "evidence",
  );
  rejectSensitiveShape(evidence);
  if (evidence.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion", `must be ${SCHEMA_VERSION}`);
  const generatedAt = string(evidence.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(generatedAt))) fail("generatedAt", "must be an ISO-8601 timestamp");

  const repo = exactKeys(evidence.repo, ["sha", "date", "specRevision"], "repo");
  sourceSha(repo.sha, "repo.sha");
  if (!DATE_ONLY.test(string(repo.date, "repo.date"))) fail("repo.date", "must be YYYY-MM-DD");
  string(repo.specRevision, "repo.specRevision");

  const chain = exactKeys(evidence.chain, ["chainId", "network", "blockNumber", "rpcIdentifier"], "chain");
  integer(chain.chainId, "chain.chainId", { min: 1 });
  string(chain.network, "chain.network");
  integer(chain.blockNumber, "chain.blockNumber");
  const rpcIdentifier = string(chain.rpcIdentifier, "chain.rpcIdentifier");
  if (!RPC_IDENTIFIER.test(rpcIdentifier)) {
    fail("chain.rpcIdentifier", "must be a redacted identifier, not a URL");
  }

  const contracts = validateContractSet(evidence.contracts);
  if (!Array.isArray(evidence.observations) || evidence.observations.length === 0) {
    fail("observations", "must be a non-empty array");
  }
  const observationSummary = evidence.observations.map((observation, index) =>
    validateObservation(observation, index, rpcIdentifier),
  );

  const seen = new Set();
  for (const [index, observation] of evidence.observations.entries()) {
    const key = `${observation.flow}:${observation.stateVariant}:${observation.contractAddress.toLowerCase()}`;
    if (seen.has(key)) fail(`observations[${index}]`, "duplicates an existing flow/state/contract observation");
    seen.add(key);
  }

  const classifications = Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]));
  for (const { classification } of observationSummary) classifications[classification] += 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    repoSha: repo.sha,
    chainId: chain.chainId,
    network: chain.network,
    rpcIdentifier,
    contractCount: contracts.length,
    observationCount: observationSummary.length,
    classifications,
  };
}

async function readJson(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    fail("evidence", "could not read the evidence JSON file");
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail("evidence", "could not parse valid JSON");
  }
}

export async function loadEvidence(path) {
  return validateEvidence(await readJson(path));
}

function parseRpcQuantity(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    fail(path, "must be a hexadecimal JSON-RPC quantity");
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  return integer(parsed, path);
}

async function rpcRequest(rpcUrl, fetchImpl, method, params) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    fail("rpc", "read-only JSON-RPC request failed");
  }
  if (!response || response.ok === false) fail("rpc", "read-only JSON-RPC request failed");
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("rpc", "read-only JSON-RPC response was not JSON");
  }
  if (!payload || payload.error || !("result" in payload)) {
    fail("rpc", "read-only JSON-RPC response contained an error");
  }
  return payload.result;
}

function mapRpcReceipt(rawReceipt, expectedTxHash, path) {
  if (rawReceipt === null) return null;
  const receipt = object(rawReceipt, path);
  const txHash = hexHash(receipt.transactionHash, `${path}.transactionHash`);
  if (txHash.toLowerCase() !== expectedTxHash.toLowerCase()) {
    fail(path, "returned receipt hash does not match the requested transaction");
  }
  return {
    txHash,
    status: parseRpcQuantity(receipt.status, `${path}.status`),
    gasUsed: parseRpcQuantity(receipt.gasUsed, `${path}.gasUsed`),
    blockNumber: parseRpcQuantity(receipt.blockNumber, `${path}.blockNumber`),
  };
}

function classifyCollectedObservation(observation) {
  const receipts = [
    observation.direct.receipt,
    ...(observation.userOperation === null ? [] : [observation.userOperation.receipt]),
  ].filter((receipt) => receipt !== null);
  if (receipts.some((receipt) => receipt.status === 0)) return "execution_failure";
  if (receipts.length === 0) {
    if (
      observation.txHash !== null ||
      (observation.userOperation !== null && observation.userOperation.txHash !== null) ||
      observation.direct.estimateGas !== null ||
      (observation.userOperation !== null && observation.userOperation.estimateGas !== null)
    ) {
      observation.blocker = "transaction receipt was not available from the configured read-only RPC";
      return "blocked";
    }
    observation.blocker = null;
    return "not_applicable";
  }

  const pairs = [];
  if (observation.direct.estimateGas !== null && observation.direct.receipt !== null) {
    pairs.push([observation.direct.estimateGas, observation.direct.receipt.gasUsed]);
  }
  if (
    observation.userOperation !== null &&
    observation.userOperation.estimateGas !== null &&
    observation.userOperation.receipt !== null
  ) {
    pairs.push([observation.userOperation.estimateGas, observation.userOperation.receipt.gasUsed]);
  }
  observation.blocker = null;
  if (pairs.some(([estimateGas, gasUsed]) => estimateGas < gasUsed)) return "estimate_mismatch";
  // A collector only sees one target-chain run. Equality (or headroom) cannot
  // establish the cross-run baseline/candidate comparison required by
  // `unchanged`, so every successful non-underestimate is reported as the
  // conservative durable category below.
  return "succeeds_with_repriced_gas";
}

/**
 * Enrich a sanitized evidence document using read-only JSON-RPC calls.
 *
 * The RPC endpoint is intentionally read only and can only be supplied through
 * GLAMSTERDAM_RPC_URL. It is never copied into the returned document or logs.
 * The method whitelist is limited to chain metadata and transaction receipts.
 */
export async function collectEvidenceFromDocument(document, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  rejectSensitiveShape(document);
  const rpcUrl = env[RPC_URL_ENV];
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    fail("rpc", `set ${RPC_URL_ENV} in the environment; RPC URLs are never accepted as evidence fields`);
  }
  if (typeof fetchImpl !== "function") fail("rpc", "a fetch implementation is required");

  const enriched = structuredClone(document);
  const chainId = parseRpcQuantity(
    await rpcRequest(rpcUrl, fetchImpl, "eth_chainId", []),
    "chain.chainId",
  );
  if (Number.isSafeInteger(enriched.chain?.chainId) && enriched.chain.chainId > 0 && enriched.chain.chainId !== chainId) {
    fail("chain.chainId", "does not match the read-only RPC chain ID");
  }
  enriched.chain.chainId = chainId;
  enriched.chain.blockNumber = parseRpcQuantity(
    await rpcRequest(rpcUrl, fetchImpl, "eth_blockNumber", []),
    "chain.blockNumber",
  );
  const configuredIdentifier = env[RPC_IDENTIFIER_ENV] ?? enriched.chain.rpcIdentifier ?? "env-configured";
  if (!RPC_IDENTIFIER.test(configuredIdentifier)) {
    fail("chain.rpcIdentifier", "must be a redacted identifier");
  }
  enriched.chain.rpcIdentifier = configuredIdentifier;

  for (const [index, observation] of enriched.observations.entries()) {
    observation.rpcIdentifier = configuredIdentifier;
    if (observation.txHash !== null && observation.direct.receipt === null) {
      const rawReceipt = await rpcRequest(rpcUrl, fetchImpl, "eth_getTransactionReceipt", [observation.txHash]);
      observation.direct.receipt = mapRpcReceipt(rawReceipt, observation.txHash, `observations[${index}].direct.receipt`);
    }
    if (
      observation.userOperation !== null &&
      observation.userOperation.txHash !== null &&
      observation.userOperation.receipt === null
    ) {
      const rawReceipt = await rpcRequest(rpcUrl, fetchImpl, "eth_getTransactionReceipt", [observation.userOperation.txHash]);
      observation.userOperation.receipt = mapRpcReceipt(
        rawReceipt,
        observation.userOperation.txHash,
        `observations[${index}].userOperation.receipt`,
      );
    }
    observation.classification = classifyCollectedObservation(observation);
  }

  validateEvidence(enriched);
  return enriched;
}

export async function collectEvidence(inputPath, outputPath, options = {}) {
  const input = await readJson(inputPath);
  const enriched = await collectEvidenceFromDocument(input, options);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return validateEvidence(enriched);
}
