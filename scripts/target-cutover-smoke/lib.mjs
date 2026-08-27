import { readFile } from "node:fs/promises";

export const SCHEMA_VERSION = "resonate-target-cutover-evidence/v1";

export const CONFIGURATION_CHECKS = Object.freeze([
  "environment_identity",
  "data_epoch",
  "public_origins",
  "cors_webauthn",
  "chain_aa_contracts",
  "x402_payment",
  "storage",
  "demucs",
  "analytics_mode",
  "runtime_allowlists",
]);

export const SMOKE_CHECKS = Object.freeze([
  "health",
  "passkey_reauthentication",
  "upload",
  "playback_download",
  "demucs",
  "analytics",
  "x402_payment_configuration",
  "origin_edge",
]);

const REQUIRED_SERVICES = Object.freeze(["backend", "frontend", "demucs"]);
const OPTIONAL_SERVICES = Object.freeze(["stable-audio"]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
const FORBIDDEN_KEY = /(?:secret|password|private.?key|database.?url|access.?token|refresh.?token|allowlist.?members?|wallet.?addresses?)/i;

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
  if (unexpected.length > 0) fail(path, `contains unsupported fields: ${unexpected.join(", ")}`);
  return entry;
}

function string(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function exactBoolean(value, expected, path) {
  if (value !== expected) fail(path, `must be ${expected}`);
}

function digest(value, path) {
  if (!SHA256.test(string(value, path))) fail(path, "must be sha256 followed by 64 lowercase hexadecimal characters");
  return value;
}

function sourceSha(value, path) {
  if (!SOURCE_SHA.test(string(value, path))) fail(path, "must be a full lowercase 40-character source SHA");
  return value;
}

function evidenceUrl(value, path) {
  const text = string(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(path, "must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") fail(path, "must use HTTPS");
  if (url.username || url.password) fail(path, "must not contain URL credentials");
  return text;
}

function passCheck(value, path, { comparisons = false, extraFields = [] } = {}) {
  const check = exactKeys(
    value,
    ["status", "evidenceUrl", ...(comparisons ? ["comparison"] : []), ...extraFields],
    path,
  );
  if (check.status !== "pass") fail(`${path}.status`, "must be pass");
  if (comparisons && !["equal", "reviewed-change"].includes(check.comparison)) {
    fail(`${path}.comparison`, "must be equal or reviewed-change");
  }
  evidenceUrl(check.evidenceUrl, `${path}.evidenceUrl`);
  return check;
}

function rejectSensitiveShape(value, path = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key}`, "secret-bearing fields are forbidden in retained evidence");
    rejectSensitiveShape(child, `${path}.${key}`);
  }
}

function validateConfiguration(value) {
  const configuration = exactKeys(value, CONFIGURATION_CHECKS, "configuration");
  for (const name of CONFIGURATION_CHECKS) {
    passCheck(configuration[name], `configuration.${name}`, { comparisons: true });
  }
}

function validateMigration(value) {
  const migration = exactKeys(value, [
    "status",
    "strictCutover",
    "identityContinuity",
    "rowParity",
    "indexerCursors",
    "sampleContent",
    "sourceSnapshotSha256",
    "targetSnapshotSha256",
    "receiptSha256",
    "evidenceUrl",
  ], "migration");
  if (migration.status !== "pass") fail("migration.status", "must be pass");
  exactBoolean(migration.strictCutover, true, "migration.strictCutover");
  for (const name of ["identityContinuity", "rowParity", "indexerCursors", "sampleContent"]) {
    exactBoolean(migration[name], true, `migration.${name}`);
  }
  for (const name of ["sourceSnapshotSha256", "targetSnapshotSha256", "receiptSha256"]) {
    digest(migration[name], `migration.${name}`);
  }
  evidenceUrl(migration.evidenceUrl, "migration.evidenceUrl");
}

function validateSourceReferences(value) {
  const references = exactKeys(value, ["status", "checks", "evidenceUrl"], "sourceReferences");
  if (references.status !== "pass") fail("sourceReferences.status", "must be pass");
  const checks = exactKeys(references.checks, ["source-project", "source-bucket"], "sourceReferences.checks");
  for (const label of ["source-project", "source-bucket"]) {
    const check = exactKeys(checks[label], ["remaining"], `sourceReferences.checks.${label}`);
    if (!Number.isSafeInteger(check.remaining) || check.remaining !== 0) {
      fail(`sourceReferences.checks.${label}.remaining`, "must be the integer 0");
    }
  }
  evidenceUrl(references.evidenceUrl, "sourceReferences.evidenceUrl");
}

function validateSmoke(value) {
  const smoke = exactKeys(value, SMOKE_CHECKS, "smoke");
  for (const name of SMOKE_CHECKS) {
    passCheck(smoke[name], `smoke.${name}`, {
      extraFields: name === "analytics" ? ["mode", "outcome"] : [],
    });
  }
  const mode = smoke.analytics.mode;
  if (!["streaming", "batch", "disabled"].includes(mode)) {
    fail("smoke.analytics.mode", "must be streaming, batch, or disabled");
  }
  if (mode === "disabled" && smoke.analytics.outcome !== "disabled-reviewed") {
    fail("smoke.analytics.outcome", "must be disabled-reviewed when analytics mode is disabled");
  }
}

function validateDeployment(value) {
  const deployment = exactKeys(value, [
    "acceptedSourceSha",
    "liveSourceSha",
    "manifestSha256",
    "evidenceUrl",
    "services",
  ], "deployment");
  const accepted = sourceSha(deployment.acceptedSourceSha, "deployment.acceptedSourceSha");
  const live = sourceSha(deployment.liveSourceSha, "deployment.liveSourceSha");
  if (live !== accepted) fail("deployment.liveSourceSha", "must equal acceptedSourceSha");
  digest(deployment.manifestSha256, "deployment.manifestSha256");
  evidenceUrl(deployment.evidenceUrl, "deployment.evidenceUrl");

  if (!Array.isArray(deployment.services) || deployment.services.length === 0) {
    fail("deployment.services", "must be a non-empty array");
  }
  const seen = new Set();
  for (const [index, rawService] of deployment.services.entries()) {
    const path = `deployment.services[${index}]`;
    const service = exactKeys(rawService, [
      "name",
      "expectedDigest",
      "liveDigest",
      "liveRevision",
      "evidenceUrl",
    ], path);
    const name = string(service.name, `${path}.name`);
    if (![...REQUIRED_SERVICES, ...OPTIONAL_SERVICES].includes(name)) fail(`${path}.name`, "is not a supported service");
    if (seen.has(name)) fail(`${path}.name`, "must not be duplicated");
    seen.add(name);
    const expected = digest(service.expectedDigest, `${path}.expectedDigest`);
    const observed = digest(service.liveDigest, `${path}.liveDigest`);
    if (observed !== expected) fail(`${path}.liveDigest`, "must equal expectedDigest");
    if (!REVISION.test(string(service.liveRevision, `${path}.liveRevision`))) {
      fail(`${path}.liveRevision`, "has an invalid revision name");
    }
    evidenceUrl(service.evidenceUrl, `${path}.evidenceUrl`);
  }
  for (const name of REQUIRED_SERVICES) {
    if (!seen.has(name)) fail("deployment.services", `must include ${name}`);
  }
}

function validateRollback(value) {
  const rollback = exactKeys(value, [
    "failureBlocksCutover",
    "sourceRetained",
    "trigger",
    "observationWindow",
    "sourceRetentionWindow",
    "evidenceUrl",
  ], "rollback");
  exactBoolean(rollback.failureBlocksCutover, true, "rollback.failureBlocksCutover");
  exactBoolean(rollback.sourceRetained, true, "rollback.sourceRetained");
  string(rollback.trigger, "rollback.trigger");
  string(rollback.observationWindow, "rollback.observationWindow");
  string(rollback.sourceRetentionWindow, "rollback.sourceRetentionWindow");
  evidenceUrl(rollback.evidenceUrl, "rollback.evidenceUrl");
}

function validateAuthorization(value) {
  const authorization = exactKeys(value, [
    "migrationAuthorized",
    "deploymentAuthorized",
    "contractChangesAuthorized",
    "productionGoLiveAuthorized",
  ], "authorization");
  for (const name of ["migrationAuthorized", "deploymentAuthorized", "contractChangesAuthorized", "productionGoLiveAuthorized"]) {
    exactBoolean(authorization[name], false, `authorization.${name}`);
  }
}

export function validateEvidence(document) {
  const evidence = exactKeys(document, [
    "schemaVersion",
    "generatedAt",
    "issueUrl",
    "configuration",
    "migration",
    "sourceReferences",
    "smoke",
    "deployment",
    "rollback",
    "authorization",
  ], "evidence");
  rejectSensitiveShape(evidence);
  if (evidence.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion", `must be ${SCHEMA_VERSION}`);
  const generatedAt = string(evidence.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(generatedAt))) fail("generatedAt", "must be an ISO-8601 timestamp");
  evidenceUrl(evidence.issueUrl, "issueUrl");
  validateConfiguration(evidence.configuration);
  validateMigration(evidence.migration);
  validateSourceReferences(evidence.sourceReferences);
  validateSmoke(evidence.smoke);
  validateDeployment(evidence.deployment);
  validateRollback(evidence.rollback);
  validateAuthorization(evidence.authorization);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sourceSha: evidence.deployment.acceptedSourceSha,
    services: evidence.deployment.services.map(({ name, liveRevision }) => ({ name, liveRevision })),
    analyticsMode: evidence.smoke.analytics.mode,
    cutoverGate: "pass",
    authorization: "none",
  };
}

export async function loadEvidence(path) {
  let document;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail("evidence", `could not read valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateEvidence(document);
}
