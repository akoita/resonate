import "dotenv/config";
import { createHash } from "crypto";
import { writeFileSync, readFileSync } from "fs";
import { prisma } from "../db/prisma";
import { resolveIdentity, type IdentitySelector, type ResolvedIdentity } from "./resolve_identity";

/**
 * #1408 — Migration verification gate.
 *
 * Proves data + identity integrity on the TARGET before the source project is
 * decommissioned. Because source and target databases live in different
 * (network-isolated) GCP projects, this uses a snapshot→compare model rather
 * than one simultaneous cross-project connection (mirrors the iac migration
 * tool's fingerprint pattern):
 *
 *   # on the SOURCE db (before/at freeze):
 *   npm run verify:migration -- --snapshot --out source.json [--wallet 0x… | --public-key-hash <h>]
 *   # on the TARGET db (after restore):
 *   npm run verify:migration -- --snapshot --out target.json [same selector]
 *   # anywhere:
 *   npm run verify:migration -- --compare source.json target.json
 *
 * Compare exits 0 = SAFE TO CUT OVER, 1 = BLOCK (data loss / identity break /
 * cursor reset). It never writes to any database.
 */

export interface ForbiddenReferenceLocation {
  table: string;
  column: string;
  count: number;
}

export interface ForbiddenReferenceEvidence {
  label: string;
  valueSha256: string;
  totalMatches: number;
  locations: ForbiddenReferenceLocation[];
}

export interface StrictSampleEvidence {
  track: { found: boolean };
  release: { found: boolean };
  showCampaign: { found: boolean };
  analytics?: { found: boolean };
}

export interface StrictCutoverEvidence {
  mode: "strict-cutover";
  analyticsRequired: boolean;
  identity: { found: boolean };
  samples: StrictSampleEvidence;
  forbiddenReferences: ForbiddenReferenceEvidence[];
}

export interface Snapshot {
  rowCounts: Record<string, number>;
  identity: ResolvedIdentity | null;
  cursors: {
    indexerState: Array<{ chainId: number | string; lastBlockNumber: string }>;
    showEscrowIndexerState: Array<{
      chainId: number | string;
      contractAddress?: string;
      lastBlockNumber: string;
    }>;
  };
  sampleContent: { users: boolean; tracks: boolean; releases: boolean; shows: boolean };
  /** Present only when the snapshot was made with --strict-cutover. */
  strictCutover?: StrictCutoverEvidence;
}

export interface SampleSelectors {
  track?: string;
  release?: string;
  showCampaign?: string;
  analytics?: string;
}

export interface ForbiddenReferenceInput {
  label: string;
  /** Kept in memory only while scanning; never included in Snapshot. */
  value: string;
}

export function forbiddenReferenceValueSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface SnapshotOptions {
  strictCutover?: boolean;
  analyticsRequired?: boolean;
  sampleSelectors?: SampleSelectors;
  forbiddenReferences?: string[];
}

export interface CompareOptions {
  strictCutover?: boolean;
  analyticsRequired?: boolean;
}

export const REQUIRED_FORBIDDEN_REFERENCE_LABELS = ["source-project", "source-bucket"] as const;

const SAFE_FORBIDDEN_REFERENCE_LABEL = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN_REFERENCE_VALUE_SHA256 = /^[0-9a-f]{64}$/;
const SAMPLE_SELECTOR_FLAGS: Record<keyof SampleSelectors, string[]> = {
  track: ["sample-track", "sample-track-id", "track-sample", "track-sample-id"],
  release: ["sample-release", "sample-release-id", "release-sample", "release-sample-id"],
  showCampaign: [
    "sample-show-campaign",
    "sample-show-campaign-id",
    "sample-show",
    "sample-show-id",
    "sample-campaign",
    "sample-campaign-id",
  ],
  analytics: [
    "sample-analytics",
    "sample-analytics-id",
    "sample-analytics-event",
    "sample-analytics-event-id",
  ],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function args(name: string): string[] {
  const values: string[] = [];
  const flag = `--${name}`;
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === flag && i + 1 < process.argv.length) values.push(process.argv[i + 1]);
  }
  return values;
}

function quoteIdentifier(identifier: string): string {
  // Identifiers are read from information_schema. Quoting and escaping here
  // keeps the dynamic identifier portion separate from all caller values.
  return `"${identifier.replace(/"/g, '""')}"`;
}

function hasIdentitySelector(selector: IdentitySelector): boolean {
  return Boolean(
    selector.publicKeyHash?.trim() ||
      selector.wallet?.trim() ||
      (selector.pubKeyX?.trim() && selector.pubKeyY?.trim()),
  );
}

function selectorValue(name: keyof SampleSelectors): string | undefined {
  const values = SAMPLE_SELECTOR_FLAGS[name].flatMap((flag) => args(flag));
  const nonEmpty = values.filter((value) => value.trim().length > 0);
  if (nonEmpty.length > 1) throw new Error(`duplicate ${name} sample selector`);
  return nonEmpty[0]?.trim();
}

export function sampleSelectorsFromArgs(): SampleSelectors {
  return {
    track: selectorValue("track"),
    release: selectorValue("release"),
    showCampaign: selectorValue("showCampaign"),
    analytics: selectorValue("analytics"),
  };
}

/**
 * Parse the caller-facing LABEL=VALUE inputs. Values are intentionally not
 * part of the snapshot schema; they are consumed only by the DB scan.
 */
export function parseForbiddenReferences(inputs: string[]): ForbiddenReferenceInput[] {
  const seen = new Set<string>();
  const references: ForbiddenReferenceInput[] = [];

  for (const input of inputs) {
    const separator = input.indexOf("=");
    if (separator <= 0) throw new Error("malformed forbidden reference (expected LABEL=VALUE)");

    const rawLabel = input.slice(0, separator).trim();
    const value = input.slice(separator + 1);
    if (!SAFE_FORBIDDEN_REFERENCE_LABEL.test(rawLabel) || value.length === 0) {
      throw new Error("malformed forbidden reference (expected safe LABEL=VALUE)");
    }

    const label = rawLabel.toLowerCase();
    if (seen.has(label)) throw new Error("duplicate forbidden reference label");
    seen.add(label);
    references.push({ label, value });
  }

  return references;
}

export function validateStrictSnapshotInputs(
  selector: IdentitySelector,
  sampleSelectors: SampleSelectors,
  analyticsRequired: boolean,
  forbiddenReferences: ForbiddenReferenceInput[],
): void {
  if (!hasIdentitySelector(selector)) {
    throw new Error(
      "strict-cutover requires an identity selector (--wallet, --public-key-hash, or --pubkey-x plus --pubkey-y)",
    );
  }
  if (!sampleSelectors.track || !sampleSelectors.release || !sampleSelectors.showCampaign) {
    throw new Error(
      "strict-cutover requires reviewed sample selectors for track, release, and Show campaign",
    );
  }
  if (analyticsRequired && !sampleSelectors.analytics) {
    throw new Error("--analytics-required requires a reviewed analytics sample selector");
  }

  const labels = new Set(forbiddenReferences.map((reference) => reference.label));
  for (const label of REQUIRED_FORBIDDEN_REFERENCE_LABELS) {
    if (!labels.has(label)) {
      throw new Error(`strict-cutover requires forbidden reference label ${label}`);
    }
  }
}

async function tableNames(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '\\_prisma%'
       ORDER BY table_name`,
    );
    return rows.map((r) => r.table_name);
  } catch {
    throw new Error("database query failed while listing tables");
  }
}

async function countRows(table: string): Promise<number> {
  // Exact count; table name comes from information_schema (not user input).
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM ${quoteIdentifier(table)}`,
    );
    return Number(rows[0]?.n ?? 0n);
  } catch {
    throw new Error("database query failed while counting rows");
  }
}

interface TextColumn {
  table_name: string;
  column_name: string;
}

async function textColumns(): Promise<TextColumn[]> {
  try {
    return await prisma.$queryRawUnsafe<TextColumn[]>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name NOT LIKE '\\_prisma%'
         AND (
           data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
           OR udt_name IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
         )
       ORDER BY table_name, ordinal_position`,
    );
  } catch {
    throw new Error("database query failed while listing text columns");
  }
}

export async function scanForbiddenReference(reference: ForbiddenReferenceInput): Promise<ForbiddenReferenceEvidence> {
  const locations: ForbiddenReferenceLocation[] = [];
  for (const column of await textColumns()) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n
         FROM ${quoteIdentifier(column.table_name)}
         WHERE strpos(CAST(${quoteIdentifier(column.column_name)} AS text), $1) > 0`,
        reference.value,
      );
      const count = Number(rows[0]?.n ?? 0n);
      if (count > 0) {
        locations.push({ table: column.table_name, column: column.column_name, count });
      }
    } catch {
      throw new Error("database query failed while scanning forbidden references");
    }
  }

  return {
    label: reference.label,
    valueSha256: forbiddenReferenceValueSha256(reference.value),
    totalMatches: locations.reduce((sum, location) => sum + location.count, 0),
    locations,
  };
}

async function resolveSnapshotIdentity(selector: IdentitySelector | null): Promise<ResolvedIdentity | null> {
  if (!selector || !hasIdentitySelector(selector)) return null;
  try {
    return await resolveIdentity(selector);
  } catch {
    throw new Error("database query failed while resolving identity");
  }
}

async function queryStrictSampleEvidence(sampleSelectors: SampleSelectors, analyticsRequired: boolean): Promise<StrictSampleEvidence> {
  if (!sampleSelectors.track || !sampleSelectors.release || !sampleSelectors.showCampaign) {
    throw new Error("strict-cutover sample selectors were not provided");
  }

  try {
    const [track, release, showCampaign] = await Promise.all([
      prisma.track.findUnique({ where: { id: sampleSelectors.track }, select: { id: true } }),
      prisma.release.findUnique({ where: { id: sampleSelectors.release }, select: { id: true } }),
      prisma.showCampaign.findUnique({ where: { id: sampleSelectors.showCampaign }, select: { id: true } }),
    ]);

    const evidence: StrictSampleEvidence = {
      track: { found: Boolean(track) },
      release: { found: Boolean(release) },
      showCampaign: { found: Boolean(showCampaign) },
    };

    if (analyticsRequired) {
      if (!sampleSelectors.analytics) {
        throw new Error("strict-cutover analytics sample selector was not provided");
      }
      const analyticsByEventId = await prisma.analyticsEvent.findUnique({
        // Analytics event IDs are the stable reviewed selector for this check.
        where: { eventId: sampleSelectors.analytics },
        select: { eventId: true },
      });
      const analytics =
        analyticsByEventId ??
        (await prisma.analyticsEvent.findUnique({
          // Accept a database id as well for operators whose reviewed fixture
          // records the primary key instead of the envelope eventId.
          where: { id: sampleSelectors.analytics },
          select: { id: true },
        }));
      evidence.analytics = { found: Boolean(analytics) };
    }

    return evidence;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("strict-cutover analytics")) throw error;
    throw new Error("database query failed while resolving strict sample evidence");
  }
}

async function snapshot(selector: IdentitySelector | null, options: SnapshotOptions = {}): Promise<Snapshot> {
  const strictCutover = Boolean(options.strictCutover);
  const analyticsRequired = Boolean(options.analyticsRequired);
  const sampleSelectors = options.sampleSelectors ?? {};
  const forbiddenReferences = parseForbiddenReferences(options.forbiddenReferences ?? []);

  if (strictCutover) validateStrictSnapshotInputs(selector ?? {}, sampleSelectors, analyticsRequired, forbiddenReferences);

  const rowCounts: Record<string, number> = {};
  for (const t of await tableNames()) {
    rowCounts[t] = await countRows(t);
  }

  const identity = await resolveSnapshotIdentity(selector);

  let indexerState: Array<{ chainId: number; lastBlockNumber: bigint }>;
  let showEscrowIndexerState: Array<{ chainId: number; contractAddress: string; lastBlockNumber: bigint }>;
  try {
    indexerState = await prisma.indexerState.findMany({
      select: { chainId: true, lastBlockNumber: true },
    });
    showEscrowIndexerState = await prisma.showEscrowIndexerState.findMany({
      select: { chainId: true, contractAddress: true, lastBlockNumber: true },
    });
  } catch {
    throw new Error("database query failed while reading indexer cursors");
  }

  const strictEvidence = strictCutover
    ? {
        mode: "strict-cutover" as const,
        analyticsRequired,
        identity: { found: Boolean(identity?.found) },
        samples: await queryStrictSampleEvidence(sampleSelectors, analyticsRequired),
        forbiddenReferences: await Promise.all(forbiddenReferences.map(scanForbiddenReference)),
      }
    : undefined;

  const result: Snapshot = {
    rowCounts,
    identity,
    cursors: {
      indexerState: indexerState.map((r: any) => ({ chainId: r.chainId, lastBlockNumber: String(r.lastBlockNumber) })),
      showEscrowIndexerState: showEscrowIndexerState.map((r: any) => ({
        chainId: r.chainId,
        contractAddress: r.contractAddress,
        lastBlockNumber: String(r.lastBlockNumber),
      })),
    },
    sampleContent: {
      users: (rowCounts["User"] ?? 0) > 0,
      tracks: (rowCounts["Track"] ?? 0) > 0,
      releases: (rowCounts["Release"] ?? 0) > 0,
      shows: (rowCounts["ShowCampaign"] ?? 0) > 0,
    },
  };

  if (strictEvidence) result.strictCutover = strictEvidence;
  return result;
}

/**
 * Compare a source snapshot against a target snapshot. Returns the list of
 * failures (empty = safe) plus warnings. Pure — no DB access, unit-testable.
 */
function strictEvidenceFailures(snapshot: Snapshot, side: "source" | "target", analyticsRequired: boolean): string[] {
  const failures: string[] = [];
  const evidence = snapshot.strictCutover;
  if (!evidence || evidence.mode !== "strict-cutover") {
    failures.push(`strict-cutover: ${side} snapshot is legacy/non-strict`);
    return failures;
  }

  if (typeof evidence.analyticsRequired !== "boolean") {
    failures.push(`strict-cutover: ${side} snapshot is missing analytics mode evidence`);
  } else if (evidence.analyticsRequired !== analyticsRequired) {
    failures.push(`strict-cutover: ${side} snapshot analytics mode does not match compare mode`);
  }

  if (!evidence.identity || evidence.identity.found !== true || !snapshot.identity || snapshot.identity.found !== true) {
    failures.push(`strict-cutover: ${side} snapshot is missing a found identity sample`);
  }

  const samples = evidence.samples;
  if (!samples || typeof samples !== "object") {
    failures.push(`strict-cutover: ${side} snapshot is missing exact sample evidence`);
  } else {
    for (const key of ["track", "release", "showCampaign"] as const) {
      if (!samples[key] || samples[key].found !== true) {
        failures.push(`strict-cutover: ${side} snapshot is missing a found ${key} sample`);
      }
    }
    if (analyticsRequired && (!samples.analytics || samples.analytics.found !== true)) {
      failures.push(`strict-cutover: ${side} snapshot is missing a found analytics sample`);
    }
  }

  const references = evidence.forbiddenReferences;
  if (!Array.isArray(references)) {
    failures.push(`strict-cutover: ${side} snapshot is missing forbidden-reference evidence`);
  } else {
    const labels = new Set<string>();
    for (const reference of references) {
      if (
        !reference ||
        typeof reference.label !== "string" ||
        !SAFE_FORBIDDEN_REFERENCE_LABEL.test(reference.label) ||
        labels.has(reference.label.toLowerCase())
      ) {
        failures.push(`strict-cutover: ${side} snapshot has malformed or duplicate forbidden-reference evidence`);
        continue;
      }
      labels.add(reference.label.toLowerCase());
      if (!FORBIDDEN_REFERENCE_VALUE_SHA256.test(reference.valueSha256)) {
        failures.push(`strict-cutover: ${side} snapshot has invalid forbidden-reference value digest`);
      }
      if (!Number.isSafeInteger(reference.totalMatches) || reference.totalMatches < 0) {
        failures.push(`strict-cutover: ${side} snapshot has invalid forbidden-reference count`);
      }
      if (!Array.isArray(reference.locations)) {
        failures.push(`strict-cutover: ${side} snapshot is missing forbidden-reference locations`);
      } else {
        let locationTotal = 0;
        for (const location of reference.locations) {
          if (
            !location ||
            typeof location.table !== "string" ||
            typeof location.column !== "string" ||
            !Number.isSafeInteger(location.count) ||
            location.count <= 0
          ) {
            failures.push(`strict-cutover: ${side} snapshot has invalid forbidden-reference location evidence`);
          } else {
            locationTotal += location.count;
          }
        }
        if (
          Number.isSafeInteger(reference.totalMatches) &&
          reference.totalMatches >= 0 &&
          reference.totalMatches !== locationTotal
        ) {
          failures.push(`strict-cutover: ${side} snapshot has inconsistent forbidden-reference totals`);
        }
      }
    }
    for (const label of REQUIRED_FORBIDDEN_REFERENCE_LABELS) {
      if (!labels.has(label)) {
        failures.push(`strict-cutover: ${side} snapshot is missing forbidden-reference label ${label}`);
      }
    }
  }

  return failures;
}

function strictForbiddenReferenceFailures(source: Snapshot, target: Snapshot): string[] {
  const failures: string[] = [];
  const sourceReferences = source.strictCutover?.forbiddenReferences;
  const targetReferences = target.strictCutover?.forbiddenReferences;
  if (!Array.isArray(sourceReferences) || !Array.isArray(targetReferences)) return failures;

  const targetByLabel = new Map(
    targetReferences
      .filter((reference) => reference && typeof reference.label === "string")
      .map((reference) => [reference.label.toLowerCase(), reference]),
  );
  for (const sourceReference of sourceReferences) {
    if (!sourceReference || typeof sourceReference.label !== "string") continue;
    const label = sourceReference.label.toLowerCase();
    const targetReference = targetByLabel.get(label);
    if (!targetReference) {
      failures.push(`strict-cutover: target is missing forbidden-reference evidence for label ${label}`);
      continue;
    }
    if (sourceReference.valueSha256 !== targetReference.valueSha256) {
      failures.push(`strict-cutover: forbidden reference ${label} value digest differs between source and target`);
    }
    if (targetReference.totalMatches > 0) {
      const locationCount = Array.isArray(targetReference.locations) ? targetReference.locations.length : 0;
      failures.push(
        `strict-cutover: target contains forbidden reference ${label} in ${targetReference.totalMatches} row(s) across ${locationCount} column location(s)`,
      );
    }
  }
  for (const targetReference of targetReferences) {
    if (
      targetReference &&
      typeof targetReference.label === "string" &&
      targetReference.totalMatches > 0 &&
      !sourceReferences.some(
        (sourceReference) =>
          sourceReference &&
          typeof sourceReference.label === "string" &&
          sourceReference.label.toLowerCase() === targetReference.label.toLowerCase(),
      )
    ) {
      const label = targetReference.label.toLowerCase();
      const locationCount = Array.isArray(targetReference.locations) ? targetReference.locations.length : 0;
      failures.push(
        `strict-cutover: target contains forbidden reference ${label} in ${targetReference.totalMatches} row(s) across ${locationCount} column location(s)`,
      );
    }
  }
  return failures;
}

export function compareSnapshots(
  source: Snapshot,
  target: Snapshot,
  options: CompareOptions = {},
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  const strictCutover = Boolean(options.strictCutover);
  const analyticsRequired = options.analyticsRequired ?? source.strictCutover?.analyticsRequired ?? false;
  if (strictCutover) {
    failures.push(...strictEvidenceFailures(source, "source", analyticsRequired));
    failures.push(...strictEvidenceFailures(target, "target", analyticsRequired));
    failures.push(...strictForbiddenReferenceFailures(source, target));
  }

  // 1. Row-count parity. Target < source on any table = data loss = FAIL.
  //    Target > source (e.g. signups during the window) = WARN, not loss.
  for (const [table, srcCount] of Object.entries(source.rowCounts)) {
    const tgtCount = target.rowCounts[table];
    if (tgtCount === undefined) {
      failures.push(`table "${table}" is missing on target`);
    } else if (tgtCount < srcCount) {
      failures.push(`table "${table}" lost rows: source ${srcCount} → target ${tgtCount}`);
    } else if (tgtCount > srcCount) {
      warnings.push(`table "${table}" grew: source ${srcCount} → target ${tgtCount} (new writes since snapshot?)`);
    }
  }
  for (const table of Object.keys(target.rowCounts)) {
    if (!(table in source.rowCounts)) {
      warnings.push(`table "${table}" exists on target but not in the source snapshot`);
    }
  }

  // 2. Identity continuity: the sample passkey must resolve to the SAME account.
  if (source.identity) {
    if (!target.identity) {
      failures.push("identity: source snapshot has a sample identity but target does not");
    } else if (!target.identity.found) {
      failures.push("identity: sample user not found on target");
    } else if (
      target.identity.userId !== source.identity.userId ||
      target.identity.walletAddress !== source.identity.walletAddress ||
      target.identity.chainId !== source.identity.chainId
    ) {
      failures.push("identity: mismatch between source and target sample accounts");
    }
  } else {
    warnings.push("identity: no sample selector provided — identity continuity not asserted (pass --wallet or --public-key-hash to both snapshots)");
  }

  // 3. Indexer cursors migrated (not reset to 0 → avoids a full re-scan and
  //    duplicate-event risk). Each source cursor must be present on target with
  //    lastBlockNumber >= the source value.
  const cursorCheck = (
    kind: "indexerState" | "showEscrowIndexerState",
  ) => {
    type Cursor = { chainId: number | string; contractAddress?: string; lastBlockNumber: string };
    const sourceCursors = source.cursors[kind] as Cursor[];
    const targetCursors = target.cursors[kind] as Cursor[];
    for (const src of sourceCursors) {
      const sourceAddress = src.contractAddress?.toLowerCase();
      const chainMatches = targetCursors.filter((t) => String(t.chainId) === String(src.chainId));
      if (kind === "showEscrowIndexerState" && !sourceAddress && chainMatches.length > 1) {
        failures.push(
          `${kind} cursor for chain ${src.chainId} is ambiguous on target; take a fresh source snapshot with contract addresses`,
        );
        continue;
      }
      const tgt = sourceAddress
        ? chainMatches.find((t) => t.contractAddress?.toLowerCase() === sourceAddress)
        : chainMatches[0];
      const cursorLabel = sourceAddress
        ? `chain ${src.chainId} contract ${sourceAddress}`
        : `chain ${src.chainId}`;
      if (!tgt) {
        failures.push(`${kind} cursor for ${cursorLabel} missing on target (indexer would rescan from 0)`);
      } else if (BigInt(tgt.lastBlockNumber) < BigInt(src.lastBlockNumber)) {
        failures.push(`${kind} cursor for ${cursorLabel} regressed: source ${src.lastBlockNumber} → target ${tgt.lastBlockNumber}`);
      }
    }
  };
  cursorCheck("indexerState");
  cursorCheck("showEscrowIndexerState");

  // 4. Sample content present on target where the source had it.
  for (const key of ["users", "tracks", "releases", "shows"] as const) {
    if (source.sampleContent[key] && !target.sampleContent[key]) {
      failures.push(`sample content: source had ${key} but target has none`);
    }
  }

  return { failures, warnings };
}

function selectorFromArgs(): IdentitySelector {
  return {
    publicKeyHash: arg("public-key-hash"),
    pubKeyX: arg("pubkey-x"),
    pubKeyY: arg("pubkey-y"),
    wallet: arg("wallet"),
  };
}

async function main() {
  const strictCutover = has("strict-cutover");
  const analyticsRequired = has("analytics-required");

  if (has("snapshot")) {
    const out = arg("out");
    const snap = await snapshot(selectorFromArgs(), {
      strictCutover,
      analyticsRequired,
      sampleSelectors: strictCutover ? sampleSelectorsFromArgs() : undefined,
      forbiddenReferences: strictCutover ? args("forbidden-reference") : undefined,
    });
    const json = JSON.stringify(snap, null, 2);
    if (out) {
      writeFileSync(out, json);
      console.log(`[verify] snapshot written to ${out} (${Object.keys(snap.rowCounts).length} tables)`);
    } else {
      console.log(json);
    }
    await prisma.$disconnect();
    process.exit(0);
  }

  if (has("compare")) {
    const rest = process.argv.slice(process.argv.indexOf("--compare") + 1).filter((a) => !a.startsWith("--"));
    const [sourcePath, targetPath] = rest;
    if (!sourcePath || !targetPath) {
      console.error("verify_migration --compare <source.json> <target.json>");
      process.exit(2);
    }
    const source: Snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));
    const target: Snapshot = JSON.parse(readFileSync(targetPath, "utf8"));
    const { failures, warnings } = compareSnapshots(source, target, {
      strictCutover,
      analyticsRequired: strictCutover ? analyticsRequired : undefined,
    });

    for (const w of warnings) console.log(`[verify] WARN  ${w}`);
    if (failures.length === 0) {
      console.log("[verify] ✅ SAFE TO CUT OVER — data + identity integrity verified on target.");
      await prisma.$disconnect();
      process.exit(0);
    }
    for (const f of failures) console.error(`[verify] FAIL  ${f}`);
    console.error(`[verify] ⛔ BLOCK CUTOVER — ${failures.length} failure(s). Do NOT decommission the source.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.error(
    "Usage: verify_migration --snapshot [--out file] [--wallet 0x… | --public-key-hash <h>] [--strict-cutover --sample-track <id> --sample-release <id> --sample-show-campaign <id> --forbidden-reference source-project=<value> --forbidden-reference source-bucket=<value> [--analytics-required --sample-analytics-event-id <id>]] | --compare <source.json> <target.json> [--strict-cutover [--analytics-required]]",
  );
  await prisma.$disconnect();
  process.exit(2);
}

if (require.main === module) {
  main().catch(async (err) => {
    const message = err instanceof Error ? err.message : "unexpected verification error";
    console.error("verify_migration failed:", message);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(2);
  });
}
