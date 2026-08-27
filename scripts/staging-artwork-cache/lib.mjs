import { readFile } from "node:fs/promises";

export const SCHEMA_VERSION = "resonate-staging-artwork-cache-evidence/v1";
export const CACHE_STATUS_KEYS = Object.freeze([
  "HIT",
  "MISS",
  "STALE",
  "REVALIDATED",
  "unknown",
]);
export const REQUIRED_IMAGE_SERVICES = Object.freeze(["backend", "frontend", "demucs"]);
export const OPTIONAL_IMAGE_SERVICES = Object.freeze(["stable-audio"]);
export const IMAGE_BUDGET_BYTES = 102400;

const ALL_IMAGE_SERVICES = Object.freeze([
  ...REQUIRED_IMAGE_SERVICES,
  ...OPTIONAL_IMAGE_SERVICES,
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

// Retained evidence is public, sanitized release evidence. These names are
// rejected recursively before shape validation so a future schema extension
// cannot accidentally make a credential-bearing field acceptable.
const FORBIDDEN_KEY = /(?:access.?token|refresh.?token|bearer|token|cookie|password|secret|credential|authorization|api.?key|private.?key|storage.?uri|storage.?url|signed.?url|(?:original|private|rollback).*(?:digest|bytes|image))/i;
const FORBIDDEN_VALUE = /(?:\b(?:gs|s3|az|file|data):\/\/|\/\/(?:storage\.googleapis\.com|storage\.cloud\.google\.com)(?:\/|$)|(?:[?&#]|^)\s*(?:access[_-]?token|refresh[_-]?token|token|cookie|signature|sig|secret|api[_-]?key)\s*=)/i;

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

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `must be an integer from ${min} through ${max}`);
  }
  return value;
}

function exactBoolean(value, expected, path) {
  if (value !== expected) fail(path, `must be ${expected}`);
}

function sourceSha(value, path) {
  if (!SOURCE_SHA.test(string(value, path))) {
    fail(path, "must be a full lowercase 40-character source SHA");
  }
  return value;
}

function digest(value, path) {
  if (!SHA256.test(string(value, path))) {
    fail(path, "must be sha256 followed by 64 lowercase hexadecimal characters");
  }
  return value;
}

function runId(value, path) {
  if (!RUN_ID.test(string(value, path))) {
    fail(path, "must be a bounded release, deploy, or IaC run identifier");
  }
  return value;
}

function revision(value, path) {
  if (!REVISION.test(string(value, path))) {
    fail(path, "has an invalid live or IaC revision");
  }
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
  if ([...url.searchParams.keys()].some((key) => /(?:token|cookie|secret|sig|signature|key|credential)/i.test(key))) {
    fail(path, "must not contain credential-bearing query parameters");
  }
  return text;
}

function publicUrl(value, path) {
  const text = evidenceUrl(value, path);
  const url = new URL(text);
  if (url.search || url.hash) fail(path, "must not contain a query string or fragment");
  return text;
}

function rejectSensitiveShape(value, path = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^@/\s]+@/i.test(value)) {
      fail(path, "secret-bearing or private storage values are forbidden in retained evidence");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      fail(`${path}.${key}`, "secret-bearing or private fixture fields are forbidden in retained evidence");
    }
    rejectSensitiveShape(child, `${path}.${key}`);
  }
}

function requirePass(value, path) {
  if (value !== "pass") fail(path, "must be pass");
}

function validateRelease(value, source, path) {
  const release = exactKeys(value, ["status", "runId", "sourceSha", "evidenceUrl"], path);
  requirePass(release.status, `${path}.status`);
  runId(release.runId, `${path}.runId`);
  if (sourceSha(release.sourceSha, `${path}.sourceSha`) !== source) {
    fail(`${path}.sourceSha`, "must equal the phase sourceSha");
  }
  evidenceUrl(release.evidenceUrl, `${path}.evidenceUrl`);
}

function validateImages(value, source, path) {
  const images = exactKeys(value, ["status", "runId", "sourceSha", "services", "evidenceUrl"], path);
  requirePass(images.status, `${path}.status`);
  runId(images.runId, `${path}.runId`);
  if (sourceSha(images.sourceSha, `${path}.sourceSha`) !== source) {
    fail(`${path}.sourceSha`, "must equal the phase sourceSha");
  }
  evidenceUrl(images.evidenceUrl, `${path}.evidenceUrl`);
  if (!Array.isArray(images.services) || images.services.length === 0) {
    fail(`${path}.services`, "must be a non-empty array");
  }

  const seen = new Set();
  const digests = new Map();
  for (const [index, rawService] of images.services.entries()) {
    const servicePath = `${path}.services[${index}]`;
    const service = exactKeys(rawService, ["name", "sourceSha", "digest", "evidenceUrl"], servicePath);
    const name = string(service.name, `${servicePath}.name`);
    if (!ALL_IMAGE_SERVICES.includes(name)) fail(`${servicePath}.name`, "is not a supported service");
    if (seen.has(name)) fail(`${servicePath}.name`, "must not be duplicated");
    seen.add(name);
    if (sourceSha(service.sourceSha, `${servicePath}.sourceSha`) !== source) {
      fail(`${servicePath}.sourceSha`, "must equal the phase sourceSha");
    }
    digests.set(name, digest(service.digest, `${servicePath}.digest`));
    evidenceUrl(service.evidenceUrl, `${servicePath}.evidenceUrl`);
  }
  for (const name of REQUIRED_IMAGE_SERVICES) {
    if (!seen.has(name)) fail(`${path}.services`, `must include ${name}`);
  }
  return digests;
}

function validateDeploy(value, source, path) {
  const deploy = exactKeys(value, ["status", "runId", "sourceSha", "manifestSha256", "evidenceUrl"], path);
  requirePass(deploy.status, `${path}.status`);
  runId(deploy.runId, `${path}.runId`);
  if (sourceSha(deploy.sourceSha, `${path}.sourceSha`) !== source) {
    fail(`${path}.sourceSha`, "must equal the phase sourceSha");
  }
  digest(deploy.manifestSha256, `${path}.manifestSha256`);
  evidenceUrl(deploy.evidenceUrl, `${path}.evidenceUrl`);
}

function validateIac(value, source, path) {
  const iac = exactKeys(value, ["status", "repository", "runId", "revision", "sourceSha", "evidenceUrl"], path);
  requirePass(iac.status, `${path}.status`);
  const repository = string(iac.repository, `${path}.repository`);
  if (repository.includes("@") || repository.includes("#")) {
    fail(`${path}.repository`, "must identify the IaC repository without credentials or fragments");
  }
  runId(iac.runId, `${path}.runId`);
  revision(iac.revision, `${path}.revision`);
  if (sourceSha(iac.sourceSha, `${path}.sourceSha`) !== source) {
    fail(`${path}.sourceSha`, "must equal the phase sourceSha");
  }
  evidenceUrl(iac.evidenceUrl, `${path}.evidenceUrl`);
}

function validateLive(value, source, imageDigests, path) {
  const live = exactKeys(value, ["status", "sourceSha", "revision", "services", "evidenceUrl"], path);
  requirePass(live.status, `${path}.status`);
  if (sourceSha(live.sourceSha, `${path}.sourceSha`) !== source) {
    fail(`${path}.sourceSha`, "must equal the phase sourceSha");
  }
  revision(live.revision, `${path}.revision`);
  evidenceUrl(live.evidenceUrl, `${path}.evidenceUrl`);
  if (!Array.isArray(live.services) || live.services.length === 0) {
    fail(`${path}.services`, "must be a non-empty array");
  }

  const seen = new Set();
  for (const [index, rawService] of live.services.entries()) {
    const servicePath = `${path}.services[${index}]`;
    const service = exactKeys(rawService, ["name", "sourceSha", "revision", "digest", "evidenceUrl"], servicePath);
    const name = string(service.name, `${servicePath}.name`);
    if (!ALL_IMAGE_SERVICES.includes(name)) fail(`${servicePath}.name`, "is not a supported service");
    if (seen.has(name)) fail(`${servicePath}.name`, "must not be duplicated");
    seen.add(name);
    if (sourceSha(service.sourceSha, `${servicePath}.sourceSha`) !== source) {
      fail(`${servicePath}.sourceSha`, "must equal the phase sourceSha");
    }
    revision(service.revision, `${servicePath}.revision`);
    const liveDigest = digest(service.digest, `${servicePath}.digest`);
    if (liveDigest !== imageDigests.get(name)) {
      fail(`${servicePath}.digest`, "must equal the retained image digest for the service");
    }
    evidenceUrl(service.evidenceUrl, `${servicePath}.evidenceUrl`);
  }
  for (const name of REQUIRED_IMAGE_SERVICES) {
    if (!seen.has(name)) fail(`${path}.services`, `must include ${name}`);
  }
}

function validateOptimizerCache(value, path) {
  const cache = exactKeys(value, ["requestCount", "statuses", "hits", "misses"], path);
  const statuses = exactKeys(cache.statuses, CACHE_STATUS_KEYS, `${path}.statuses`);
  let total = 0;
  for (const key of CACHE_STATUS_KEYS) {
    total += integer(statuses[key], `${path}.statuses.${key}`);
  }
  integer(cache.requestCount, `${path}.requestCount`);
  if (cache.requestCount !== total) fail(`${path}.requestCount`, "must equal the sum of statuses");
  integer(cache.hits, `${path}.hits`);
  integer(cache.misses, `${path}.misses`);
  if (cache.hits !== statuses.HIT) fail(`${path}.hits`, "must equal statuses.HIT");
  if (cache.misses !== statuses.MISS) fail(`${path}.misses`, "must equal statuses.MISS");
  if (cache.requestCount === 0) fail(`${path}.requestCount`, "must record at least one optimizer request");
  return cache;
}

const PERFORMANCE_LOAD_KEYS = [
  "lcpMs",
  "cls",
  "fcpMs",
  "ttfbMs",
  "domContentLoadedMs",
  "loadMs",
  "tbtProxyMs",
  "longTaskCount",
  "totalBytes",
  "jsBytes",
  "requests",
  "optimizerCache",
];

function validatePerformanceLoad(value, path) {
  const load = exactKeys(value, PERFORMANCE_LOAD_KEYS, path);
  for (const name of PERFORMANCE_LOAD_KEYS.slice(0, -1)) {
    if (name === "cls") {
      if (typeof load[name] !== "number" || !Number.isFinite(load[name]) || load[name] < 0) {
        fail(`${path}.${name}`, "must be a finite non-negative number");
      }
    } else {
      if (typeof load[name] !== "number" || !Number.isFinite(load[name]) || load[name] < 0) {
        fail(`${path}.${name}`, "must be a finite non-negative number");
      }
    }
  }
  return validateOptimizerCache(load.optimizerCache, `${path}.optimizerCache`);
}

function emptyCacheTotals() {
  return {
    requestCount: 0,
    statuses: Object.fromEntries(CACHE_STATUS_KEYS.map((key) => [key, 0])),
    hits: 0,
    misses: 0,
  };
}

function addCacheTotals(total, cache) {
  total.requestCount += cache.requestCount;
  total.hits += cache.hits;
  total.misses += cache.misses;
  for (const key of CACHE_STATUS_KEYS) total.statuses[key] += cache.statuses[key];
}

function assertCacheTotals(summary, total, path) {
  for (const key of ["requestCount", "hits", "misses"]) {
    if (summary[key] !== total[key]) fail(`${path}.${key}`, "must equal the sum across the five accepted runs");
  }
  for (const key of CACHE_STATUS_KEYS) {
    if (summary.statuses[key] !== total.statuses[key]) {
      fail(`${path}.statuses.${key}`, "must equal the sum across the five accepted runs");
    }
  }
}

function validatePerformance(value, path) {
  const performance = exactKeys(value, [
    "status",
    "schema",
    "target",
    "route",
    "runs",
    "requestedRuns",
    "discardedAttempts",
    "viewport",
    "settleMs",
    "cold",
    "warm",
    "breakdown",
    "rawRuns",
    "evidenceUrl",
  ], path);
  requirePass(performance.status, `${path}.status`);
  if (performance.schema !== "resonate.home-performance/2") {
    fail(`${path}.schema`, "must be resonate.home-performance/2");
  }
  publicUrl(performance.target, `${path}.target`);
  if (string(performance.route, `${path}.route`) !== "/") {
    fail(`${path}.route`, "must record the Home route /");
  }
  if (integer(performance.runs, `${path}.runs`) !== 5) fail(`${path}.runs`, "must be exactly 5 accepted pairs");
  if (integer(performance.requestedRuns, `${path}.requestedRuns`) !== 5) {
    fail(`${path}.requestedRuns`, "must request exactly 5 pairs");
  }
  if (!Array.isArray(performance.discardedAttempts)) {
    fail(`${path}.discardedAttempts`, "must be an array");
  }
  const viewport = exactKeys(performance.viewport, ["width", "height"], `${path}.viewport`);
  integer(viewport.width, `${path}.viewport.width`, { min: 1 });
  integer(viewport.height, `${path}.viewport.height`, { min: 1 });
  integer(performance.settleMs, `${path}.settleMs`);
  const coldSummaryCache = validatePerformanceLoad(performance.cold, `${path}.cold`);
  const warmSummaryCache = validatePerformanceLoad(performance.warm, `${path}.warm`);

  const breakdown = exactKeys(
    performance.breakdown,
    ["basis", "representativeRun", "byType", "topResponses", "images"],
    `${path}.breakdown`,
  );
  if (breakdown.basis !== "cold") fail(`${path}.breakdown.basis`, "must be cold");
  integer(breakdown.representativeRun, `${path}.breakdown.representativeRun`, { min: 1, max: 5 });
  if (!Array.isArray(breakdown.byType)) fail(`${path}.breakdown.byType`, "must be an array");
  if (!Array.isArray(breakdown.topResponses)) fail(`${path}.breakdown.topResponses`, "must be an array");
  const images = exactKeys(breakdown.images, [
    "totalBytes",
    "responseCount",
    "distinctCount",
    "duplicateRequests",
    "medianBytes",
    "maxBytes",
    "heavyThresholdBytes",
    "heavyCount",
    "heavyBytes",
    "heavy",
  ], `${path}.breakdown.images`);
  for (const name of ["totalBytes", "responseCount", "distinctCount", "duplicateRequests", "medianBytes", "maxBytes", "heavyCount", "heavyBytes"]) {
    integer(images[name], `${path}.breakdown.images.${name}`);
  }
  if (images.heavyThresholdBytes !== IMAGE_BUDGET_BYTES) {
    fail(`${path}.breakdown.images.heavyThresholdBytes`, `must be ${IMAGE_BUDGET_BYTES}`);
  }
  if (!Array.isArray(images.heavy)) fail(`${path}.breakdown.images.heavy`, "must be an array");
  if (images.heavyCount !== images.heavy.length) {
    fail(`${path}.breakdown.images.heavyCount`, "must equal heavy.length");
  }
  let heavyBytes = 0;
  for (const [index, rawImage] of images.heavy.entries()) {
    const imagePath = `${path}.breakdown.images.heavy[${index}]`;
    const image = exactKeys(rawImage, ["url", "bytes"], imagePath);
    // Optimizer resource URLs normally carry the harmless width/quality and
    // source parameters emitted by Next. evidenceUrl still rejects
    // credential-bearing query parameters and URL credentials.
    evidenceUrl(image.url, `${imagePath}.url`);
    const bytes = integer(image.bytes, `${imagePath}.bytes`);
    if (bytes <= IMAGE_BUDGET_BYTES) fail(`${imagePath}.bytes`, "must exceed the heavy-image budget");
    heavyBytes += bytes;
  }
  if (images.heavyBytes !== heavyBytes) fail(`${path}.breakdown.images.heavyBytes`, "must equal the sum of heavy image bytes");
  // The evidence is an acceptance receipt, so a budget violation is a failed
  // phase rather than an observation that can silently pass validation.
  if (images.heavy.length !== 0) fail(`${path}.breakdown.images.heavy`, "must be empty under the 100 KiB acceptance budget");

  if (!Array.isArray(performance.rawRuns) || performance.rawRuns.length !== 5) {
    fail(`${path}.rawRuns`, "must contain exactly 5 accepted cold/warm pairs");
  }
  const coldTotals = emptyCacheTotals();
  const warmTotals = emptyCacheTotals();
  for (const [index, rawRun] of performance.rawRuns.entries()) {
    const runPath = `${path}.rawRuns[${index}]`;
    const run = exactKeys(rawRun, ["cold", "warm", "checks"], runPath);
    addCacheTotals(coldTotals, validatePerformanceLoad(run.cold, `${runPath}.cold`));
    addCacheTotals(warmTotals, validatePerformanceLoad(run.warm, `${runPath}.warm`));
    const checks = exactKeys(run.checks, ["cold", "warm"], `${runPath}.checks`);
    for (const name of ["cold", "warm"]) {
      const check = object(checks[name], `${runPath}.checks.${name}`);
      if (check.ok !== true) fail(`${runPath}.checks.${name}.ok`, "must be true for an accepted pair");
      if (check.status !== undefined && (!Number.isInteger(check.status) || check.status < 200 || check.status >= 300)) {
        fail(`${runPath}.checks.${name}.status`, "must be a successful 2xx response when present");
      }
    }
  }
  assertCacheTotals(coldSummaryCache, coldTotals, `${path}.cold.optimizerCache`);
  assertCacheTotals(warmSummaryCache, warmTotals, `${path}.warm.optimizerCache`);
  evidenceUrl(performance.evidenceUrl, `${path}.evidenceUrl`);
}

function validateArtworkProof(value, path) {
  const proof = exactKeys(value, ["revision", "key", "fingerprint", "evidenceUrl"], path);
  integer(proof.revision, `${path}.revision`, { min: 1 });
  string(proof.key, `${path}.key`);
  // Retain a privately salted HMAC/fingerprint of the byte digest, not the
  // original artwork digest that #1666 requires operators to keep private.
  digest(proof.fingerprint, `${path}.fingerprint`);
  evidenceUrl(proof.evidenceUrl, `${path}.evidenceUrl`);
  return proof;
}

function validateArtworkFixture(value, path) {
  const fixture = exactKeys(value, [
    "fixtureId",
    "visualKey",
    "before",
    "after",
    "restore",
    "legacyReadable",
    "replacementImmediate",
    "evidenceUrl",
  ], path);
  const expectedFixtureId = path.endsWith(".release") ? "release-fixture-1666" : "shows-fixture-1666";
  if (string(fixture.fixtureId, `${path}.fixtureId`) !== expectedFixtureId) {
    fail(`${path}.fixtureId`, `must use the sanitized alias ${expectedFixtureId}`);
  }
  const visualKey = string(fixture.visualKey, `${path}.visualKey`);
  if (!/^[A-Za-z0-9_-]+$/.test(visualKey)) fail(`${path}.visualKey`, "must be a sanitized visual alias");
  const before = validateArtworkProof(fixture.before, `${path}.before`);
  const after = validateArtworkProof(fixture.after, `${path}.after`);
  const restore = validateArtworkProof(fixture.restore, `${path}.restore`);
  exactBoolean(fixture.legacyReadable, true, `${path}.legacyReadable`);
  exactBoolean(fixture.replacementImmediate, true, `${path}.replacementImmediate`);
  evidenceUrl(fixture.evidenceUrl, `${path}.evidenceUrl`);
  if (after.revision !== before.revision + 1) fail(`${path}.after.revision`, "must advance exactly one revision from before");
  if (restore.revision !== after.revision + 1) fail(`${path}.restore.revision`, "must advance exactly one revision from after");
  for (const [name, proof] of [["before", before], ["after", after], ["restore", restore]]) {
    const expectedKey = path.endsWith(".release")
      ? `/catalog/releases/${expectedFixtureId}/artwork/v${proof.revision}`
      : `/shows/campaigns/${expectedFixtureId}/visuals/${visualKey}/v${proof.revision}`;
    if (proof.key !== expectedKey) fail(`${path}.${name}.key`, `must equal the sanitized canonical key ${expectedKey}`);
  }
  if (after.key === before.key) fail(`${path}.after.key`, "must change the canonical optimizer source key");
  if (restore.key === after.key || restore.key === before.key) fail(`${path}.restore.key`, "must change again for the restored revision");
  if (after.fingerprint === before.fingerprint) {
    fail(`${path}.after.fingerprint`, "must prove different replacement bytes");
  }
  if (restore.fingerprint !== before.fingerprint) {
    fail(`${path}.restore.fingerprint`, "must prove the original bytes were restored");
  }
  return fixture;
}

function validateArtwork(value, path) {
  const artwork = exactKeys(value, ["release", "shows"], path);
  const release = validateArtworkFixture(artwork.release, `${path}.release`);
  const shows = validateArtworkFixture(artwork.shows, `${path}.shows`);
  if (release.fixtureId === shows.fixtureId) fail(`${path}.shows.fixtureId`, "must use a distinct disposable fixture");
}

function validatePhase(value, rootSource, path) {
  const phase = exactKeys(value, [
    "name",
    "kind",
    "status",
    "ttlSeconds",
    "sourceSha",
    "release",
    "images",
    "deploy",
    "iac",
    "live",
    "performance",
    "artwork",
  ], path);
  const name = string(phase.name, `${path}.name`);
  if (phase.kind !== "baseline" && phase.kind !== "candidate") fail(`${path}.kind`, "must be baseline or candidate");
  requirePass(phase.status, `${path}.status`);
  const ttl = integer(phase.ttlSeconds, `${path}.ttlSeconds`, { max: 86400 });
  if (phase.kind === "baseline" && ttl !== 0) fail(`${path}.ttlSeconds`, "baseline TTL must be exactly 0");
  if (phase.kind === "candidate" && ttl === 0) fail(`${path}.ttlSeconds`, "candidate TTL must be nonzero");
  const phaseSource = sourceSha(phase.sourceSha, `${path}.sourceSha`);
  if (phaseSource !== rootSource) fail(`${path}.sourceSha`, "must equal the document sourceSha");
  validateRelease(phase.release, phaseSource, `${path}.release`);
  const imageDigests = validateImages(phase.images, phaseSource, `${path}.images`);
  validateDeploy(phase.deploy, phaseSource, `${path}.deploy`);
  validateIac(phase.iac, phaseSource, `${path}.iac`);
  validateLive(phase.live, phaseSource, imageDigests, `${path}.live`);
  validatePerformance(phase.performance, `${path}.performance`);
  validateArtwork(phase.artwork, `${path}.artwork`);
  return { name, kind: phase.kind, ttlSeconds: ttl, imageDigests };
}

function validateRollback(value, path) {
  const rollback = exactKeys(value, [
    "status",
    "ttlSeconds",
    "production",
    "fixturesRestored",
    "sourceRetained",
    "trigger",
    "evidenceUrl",
  ], path);
  requirePass(rollback.status, `${path}.status`);
  if (integer(rollback.ttlSeconds, `${path}.ttlSeconds`) !== 0) fail(`${path}.ttlSeconds`, "rollback must restore TTL 0");
  exactBoolean(rollback.production, false, `${path}.production`);
  exactBoolean(rollback.fixturesRestored, true, `${path}.fixturesRestored`);
  exactBoolean(rollback.sourceRetained, true, `${path}.sourceRetained`);
  string(rollback.trigger, `${path}.trigger`);
  evidenceUrl(rollback.evidenceUrl, `${path}.evidenceUrl`);
}

export function validateEvidence(document) {
  rejectSensitiveShape(document);
  const evidence = exactKeys(document, [
    "schemaVersion",
    "generatedAt",
    "issueUrl",
    "production",
    "fixturesDisposable",
    "sourceSha",
    "sourceEvidenceUrl",
    "phases",
    "rollback",
  ], "evidence");
  if (evidence.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion", `must be ${SCHEMA_VERSION}`);
  const generatedAt = string(evidence.generatedAt, "generatedAt");
  if (Number.isNaN(Date.parse(generatedAt))) fail("generatedAt", "must be an ISO-8601 timestamp");
  evidenceUrl(evidence.issueUrl, "issueUrl");
  exactBoolean(evidence.production, false, "production");
  exactBoolean(evidence.fixturesDisposable, true, "fixturesDisposable");
  const rootSource = sourceSha(evidence.sourceSha, "sourceSha");
  evidenceUrl(evidence.sourceEvidenceUrl, "sourceEvidenceUrl");

  if (!Array.isArray(evidence.phases) || evidence.phases.length < 2) {
    fail("phases", "must contain a TTL=0 baseline and at least one candidate phase");
  }
  const seenNames = new Set();
  const phases = evidence.phases.map((phase, index) => {
    const result = validatePhase(phase, rootSource, `phases[${index}]`);
    if (seenNames.has(result.name)) fail(`phases[${index}].name`, "must not be duplicated");
    seenNames.add(result.name);
    return result;
  });
  if (phases.filter(({ kind }) => kind === "baseline").length !== 1) {
    fail("phases", "must contain exactly one baseline phase");
  }
  if (!phases.some(({ kind }) => kind === "candidate")) {
    fail("phases", "must contain at least one candidate phase");
  }
  const baseline = phases.find(({ kind }) => kind === "baseline");
  for (const candidate of phases.filter(({ kind }) => kind === "candidate")) {
    for (const service of ["backend", "demucs"]) {
      if (candidate.imageDigests.get(service) !== baseline.imageDigests.get(service)) {
        fail("phases", `candidate must reuse the unchanged ${service} image digest`);
      }
    }
    if (candidate.imageDigests.get("frontend") === baseline.imageDigests.get("frontend")) {
      fail("phases", "candidate must use a rebuilt frontend image for the build-time TTL change");
    }
  }
  validateRollback(evidence.rollback, "rollback");

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sourceSha: rootSource,
    production: false,
    fixturesDisposable: true,
    phases: phases.map(({ imageDigests: _imageDigests, ...phase }) => phase),
    rollbackTtlSeconds: 0,
    gate: "pass",
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
