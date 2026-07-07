import "dotenv/config";
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

interface Snapshot {
  rowCounts: Record<string, number>;
  identity: ResolvedIdentity | null;
  cursors: {
    indexerState: Array<{ chainId: number | string; lastBlockNumber: string }>;
    showEscrowIndexerState: Array<{ chainId: number | string; lastBlockNumber: string }>;
  };
  sampleContent: { users: boolean; tracks: boolean; releases: boolean; shows: boolean };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

async function tableNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '\\_prisma%'
     ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

async function countRows(table: string): Promise<number> {
  // Exact count; table name comes from information_schema (not user input).
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM "${table}"`,
  );
  return Number(rows[0]?.n ?? 0n);
}

async function snapshot(selector: IdentitySelector | null): Promise<Snapshot> {
  const rowCounts: Record<string, number> = {};
  for (const t of await tableNames()) {
    rowCounts[t] = await countRows(t);
  }

  const identity =
    selector && (selector.publicKeyHash || (selector.pubKeyX && selector.pubKeyY) || selector.wallet)
      ? await resolveIdentity(selector)
      : null;

  const indexerState = await prisma.indexerState.findMany({
    select: { chainId: true, lastBlockNumber: true },
  }).catch(() => []);
  const showEscrowIndexerState = await prisma.showEscrowIndexerState.findMany({
    select: { chainId: true, lastBlockNumber: true },
  }).catch(() => []);

  return {
    rowCounts,
    identity,
    cursors: {
      indexerState: indexerState.map((r: any) => ({ chainId: r.chainId, lastBlockNumber: String(r.lastBlockNumber) })),
      showEscrowIndexerState: showEscrowIndexerState.map((r: any) => ({ chainId: r.chainId, lastBlockNumber: String(r.lastBlockNumber) })),
    },
    sampleContent: {
      users: (rowCounts["User"] ?? 0) > 0,
      tracks: (rowCounts["Track"] ?? 0) > 0,
      releases: (rowCounts["Release"] ?? 0) > 0,
      shows: (rowCounts["ShowCampaign"] ?? 0) > 0,
    },
  };
}

/**
 * Compare a source snapshot against a target snapshot. Returns the list of
 * failures (empty = safe) plus warnings. Pure — no DB access, unit-testable.
 */
export function compareSnapshots(
  source: Snapshot,
  target: Snapshot,
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

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
      failures.push(`identity: sample user not found on target (userId ${source.identity.userId})`);
    } else if (
      target.identity.userId !== source.identity.userId ||
      target.identity.walletAddress !== source.identity.walletAddress ||
      target.identity.chainId !== source.identity.chainId
    ) {
      failures.push(
        `identity: mismatch — source ${JSON.stringify({ u: source.identity.userId, w: source.identity.walletAddress, c: source.identity.chainId })} vs target ${JSON.stringify({ u: target.identity.userId, w: target.identity.walletAddress, c: target.identity.chainId })}`,
      );
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
    for (const src of source.cursors[kind]) {
      const tgt = target.cursors[kind].find((t) => String(t.chainId) === String(src.chainId));
      if (!tgt) {
        failures.push(`${kind} cursor for chain ${src.chainId} missing on target (indexer would rescan from 0)`);
      } else if (BigInt(tgt.lastBlockNumber) < BigInt(src.lastBlockNumber)) {
        failures.push(`${kind} cursor for chain ${src.chainId} regressed: source ${src.lastBlockNumber} → target ${tgt.lastBlockNumber}`);
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
  if (has("snapshot")) {
    const out = arg("out");
    const snap = await snapshot(selectorFromArgs());
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
    const { failures, warnings } = compareSnapshots(source, target);

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

  console.error("Usage: verify_migration --snapshot [--out file] [--wallet 0x… | --public-key-hash <h>]  |  --compare <source.json> <target.json>");
  await prisma.$disconnect();
  process.exit(2);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("verify_migration failed:", err instanceof Error ? err.message : err);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(2);
  });
}
