import "dotenv/config";
import { chmodSync, writeFileSync } from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import {
  casingClassOf,
  listReferenceColumns,
  parseDetailsFile,
  quoteIdentifier,
  type ReferenceColumn,
} from "./report_case_variant_users";

/**
 * #2180 - merge `User` ids that are equal under lowercase.
 *
 * Wallet-account user ids are lowercase addresses. Before the id was
 * normalised at every creation point, a checksummed spelling of the same
 * address created a second `User` (an orphan: nobody signs in as it). This
 * script moves everything that references the mixed-case "variant" onto the
 * all-lowercase "canonical" user and deletes the variant row. The read-only
 * companion `report_case_variant_users.ts` finds and sizes the groups.
 *
 * Safety model:
 *
 * - **Dry-run is the default.** Nothing is written unless `--apply` is given.
 *   A dry-run computes the same plan inside a transaction that is always rolled
 *   back, so its per-group outcomes are what `--apply` would do.
 * - **One transaction per group**, with the two `User` rows locked. Every
 *   reference column (see the report script for how they are discovered) is
 *   updated under its own SAVEPOINT so a unique-violation can be resolved by
 *   policy without losing the rest of the group. Anything the policy does not
 *   cover rolls back the whole group and marks it `manual`.
 * - **Canonical = the all-lowercase id.** A group with no lowercase member,
 *   more than two members, an erased or non-live variant, or an erased
 *   canonical is `manual`.
 * - **Unique-conflict policy** (the only rows this script ever deletes besides
 *   the variant `User`): when the canonical user already has the row a
 *   reference would collide with,
 *     - a 1:1 row (unique on the user column alone, `Wallet`, settings,
 *       profile, credit account, ...) keeps the canonical row and drops the
 *       variant's only if the variant's row holds no money-like value other
 *       than zero (`Wallet` also requires the same address, ignoring case);
 *     - a composite-unique row (user column plus other key columns) drops the
 *       variant's duplicate only if the canonical row with the same other key
 *       has the same money-like values;
 *     - the doomed row must have no dependent rows in any table;
 *     - anything else is `manual`.
 *   "Money-like" = a numeric column whose name says balance, usd, cents,
 *   price, ... (`MONEY_COLUMN_PATTERN`).
 * - **Verified delete.** After the moves the variant must have zero references
 *   left; only then is its `User` row deleted. Otherwise: rollback + `manual`.
 *
 * Logs carry COUNTS AND CLASSES ONLY, never an id, address or email, and never
 * a database error message (those can quote the conflicting values).
 * `--details-file <path>` writes the per-group plan/outcome, including ids, to a
 * local JSON file with owner-only permissions.
 *
 * Needs only a database URL (`DATABASE_URL`); no application boot.
 *
 * Exit codes: `0` ok (including "no duplicates"), `1` unexpected error or bad
 * arguments, `2` at least one group needs a manual decision.
 *
 * Usage:
 *   node dist/scripts/merge_case_variant_users.js [--dry-run | --apply]
 *     [--limit <groups>] [--details-file <path>]
 */

export type MergeMode = "dry-run" | "apply";

export interface MergeOptions {
  mode: MergeMode;
  limit?: number;
  detailsFile?: string;
}

export interface MergedGroupOutcome {
  key: string;
  status: "merged";
  canonicalId: string;
  variantId: string;
  /** Rows re-pointed at the canonical user, keyed `Table.column`; zero counts omitted. */
  moved: Record<string, number>;
  /** Variant rows dropped as duplicates of canonical rows, keyed by table. */
  deleted: Record<string, number>;
}

export interface ManualGroupOutcome {
  key: string;
  status: "manual";
  /** Reason class: no ids. */
  reason: string;
  /** `Table.column` the reason refers to, when there is one. */
  reference?: string;
  memberIds: string[];
}

export type GroupOutcome = MergedGroupOutcome | ManualGroupOutcome;

export interface MergeTotals {
  mode: MergeMode;
  groupsFound: number;
  groupsProcessed: number;
  merged: number;
  manual: number;
  variantUsersDeleted: number;
  rowsMoved: number;
  rowsDeleted: number;
  movedByReference: Record<string, number>;
  deletedByTable: Record<string, number>;
  manualByReason: Array<{ reason: string; reference?: string; groups: number }>;
}

export interface MergeResult {
  outcomes: GroupOutcome[];
  totals: MergeTotals;
}

/** Numeric column names that carry value. Matching rows are never silently dropped. */
const MONEY_COLUMN_PATTERN =
  /balance|usd|cents|spent|cap|price|paid|amount|credit|fee|payout|earn|revenue|wei|stake|deposit|royalt|refund|cost|budget/i;
const NUMERIC_TYPES = new Set([
  "smallint",
  "integer",
  "bigint",
  "numeric",
  "real",
  "double precision",
]);

/** Table-specific extra requirement before a variant's 1:1 row may be dropped. */
const ROW_MATCH_GUARDS: Record<string, (variant: JsonRow, canonical: JsonRow) => string | null> = {
  Wallet: (variant, canonical) =>
    String(variant.address ?? "").toLowerCase() === String(canonical.address ?? "").toLowerCase()
      ? null
      : "wallet_address_differs",
};

type JsonRow = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

/** A bad command line: the message names a flag, never data, so it may be logged. */
class MergeArgumentError extends Error {}

class ManualDecision extends Error {
  constructor(
    readonly reason: string,
    readonly reference?: string,
  ) {
    super(reason);
  }
}

/** Thrown at the end of a dry-run so the transaction rolls back. */
class DryRunRollback extends Error {
  constructor(readonly outcome: MergedGroupOutcome) {
    super("dry-run rollback");
  }
}

export function parseMergeOptions(argv: string[]): MergeOptions {
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run");
  if (apply && dryRun) throw new MergeArgumentError("--apply and --dry-run are mutually exclusive");

  let limit: number | undefined;
  const index = argv.indexOf("--limit");
  if (index !== -1) {
    const raw = argv[index + 1];
    if (!raw || !/^[1-9][0-9]*$/.test(raw)) {
      throw new MergeArgumentError("--limit needs a positive whole number of groups");
    }
    limit = Number(raw);
  }
  let detailsFile: string | undefined;
  try {
    detailsFile = parseDetailsFile(argv);
  } catch (error) {
    throw new MergeArgumentError(error instanceof Error ? error.message : "invalid --details-file");
  }
  return { mode: apply ? "apply" : "dry-run", limit, detailsFile };
}

/** The SQLSTATE of a failed raw query, if Prisma exposes one. Never the message. */
export function sqlStateOf(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown; message?: unknown } | undefined;
    if (typeof meta?.code === "string") return meta.code;
    const match = /Code: `([0-9A-Z]{5})`/.exec(error.message);
    if (match) return match[1];
  }
  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === "23505";
}

function ref(table: string, column: string): string {
  return `${table}.${column}`;
}

function isMoneyZero(value: unknown): boolean {
  return value === null || value === undefined || Number(value) === 0;
}

interface UniqueIndex {
  /** Columns of the index, in order. */
  columns: string[];
  /** True when the index cannot be reasoned about (partial or expression). */
  unsupported: boolean;
}

async function uniqueIndexesIncluding(tx: Tx, table: string, column: string): Promise<UniqueIndex[]> {
  const rows = await tx.$queryRawUnsafe<
    Array<{ columns: string[]; partial: boolean; key_count: number }>
  >(
    `
    SELECT array_agg(a.attname ORDER BY k.ord) AS columns,
           (i.indpred IS NOT NULL) AS partial,
           i.indnkeyatts::int AS key_count
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE i.indisunique
      AND c.relname = $1
      AND ns.nspname = current_schema()
      AND k.ord <= i.indnkeyatts
    GROUP BY i.indexrelid, i.indpred, i.indnkeyatts
    `,
    table,
  );
  return rows
    .filter((row) => row.columns.includes(column))
    .map((row) => ({
      columns: row.columns,
      unsupported: row.partial || row.columns.length !== row.key_count,
    }));
}

async function moneyColumns(tx: Tx, table: string): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    table,
  );
  return rows
    .filter((row) => NUMERIC_TYPES.has(row.data_type) && MONEY_COLUMN_PATTERN.test(row.column_name))
    .map((row) => row.column_name);
}

/** Rows (by ctid) that block moving `column` from variant to canonical, per one unique index. */
async function conflictingPairs(
  tx: Tx,
  table: string,
  column: string,
  otherColumns: string[],
  variantId: string,
  canonicalId: string,
): Promise<Array<{ ctid: string; variant: JsonRow; canonical: JsonRow }>> {
  const t = quoteIdentifier(table);
  const col = quoteIdentifier(column);
  const matches = otherColumns
    .map((other) => `c.${quoteIdentifier(other)} = v.${quoteIdentifier(other)}`)
    .join(" AND ");
  const rows = await tx.$queryRawUnsafe<Array<{ ctid: string; variant: JsonRow; canonical: JsonRow }>>(
    `
    SELECT v.ctid::text AS ctid, to_jsonb(v) AS variant, to_jsonb(c) AS canonical
    FROM ${t} v
    JOIN ${t} c ON c.${col} = $2 ${matches ? `AND ${matches}` : ""}
    WHERE v.${col} = $1
    FOR UPDATE OF v, c
    `,
    variantId,
    canonicalId,
  );
  return rows;
}

/** Number of rows, in any table, whose foreign key points at one of the given rows of `table`. */
async function dependentRowCount(tx: Tx, table: string, ctids: string[]): Promise<number> {
  const fks = await tx.$queryRawUnsafe<
    Array<{ child_table: string; child_col: string | null; parent_col: string | null; width: number }>
  >(
    `
    SELECT child.relname AS child_table, ca.attname AS child_col, pa.attname AS parent_col,
           array_length(con.conkey, 1)::int AS width
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = parent.relnamespace
    LEFT JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
    LEFT JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND parent.relname = $1 AND ns.nspname = current_schema()
    `,
    table,
  );
  let total = 0;
  for (const fk of fks) {
    // A composite key cannot be checked column-by-column here: be conservative.
    if (fk.width !== 1 || !fk.child_col || !fk.parent_col) return Number.MAX_SAFE_INTEGER;
    const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n
       FROM ${quoteIdentifier(fk.child_table)} ch
       WHERE ch.${quoteIdentifier(fk.child_col)} IN (
         SELECT p.${quoteIdentifier(fk.parent_col)}
         FROM ${quoteIdentifier(table)} p
         WHERE p.ctid::text = ANY($1::text[])
       )`,
      ctids,
    );
    total += Number(rows[0]?.n ?? 0);
  }
  return total;
}

async function updateColumn(
  tx: Tx,
  { table, column }: ReferenceColumn,
  variantId: string,
  canonicalId: string,
): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = $1 WHERE ${quoteIdentifier(column)} = $2`,
    canonicalId,
    variantId,
  );
}

/**
 * Resolves a unique violation on `table.column` by policy: deletes the
 * variant's rows that duplicate a canonical row, or throws `ManualDecision`.
 * Returns the number of rows deleted.
 */
async function resolveUniqueConflict(
  tx: Tx,
  { table, column }: ReferenceColumn,
  variantId: string,
  canonicalId: string,
): Promise<number> {
  const reference = ref(table, column);
  const indexes = await uniqueIndexesIncluding(tx, table, column);
  if (indexes.length === 0) throw new ManualDecision("unknown_conflict", reference);
  if (indexes.some((index) => index.unsupported)) {
    throw new ManualDecision("conflict_unsupported_index", reference);
  }

  const money = await moneyColumns(tx, table);
  const doomed = new Map<string, true>();
  for (const index of indexes) {
    const others = index.columns.filter((name) => name !== column);
    const pairs = await conflictingPairs(tx, table, column, others, variantId, canonicalId);
    for (const pair of pairs) {
      if (others.length === 0) {
        // 1:1 row: the canonical row stays; the variant's goes only if it holds no value.
        if (!money.every((name) => isMoneyZero(pair.variant[name]))) {
          throw new ManualDecision("conflict_variant_holds_value", reference);
        }
        const guard = ROW_MATCH_GUARDS[table]?.(pair.variant, pair.canonical);
        if (guard) throw new ManualDecision(`conflict_${guard}`, reference);
      } else if (money.some((name) => Number(pair.variant[name] ?? 0) !== Number(pair.canonical[name] ?? 0))) {
        // Composite key: a duplicate only if no money-like value differs.
        throw new ManualDecision("conflict_values_differ", reference);
      }
      doomed.set(pair.ctid, true);
    }
  }
  if (doomed.size === 0) throw new ManualDecision("unknown_conflict", reference);

  const ctids = [...doomed.keys()];
  if ((await dependentRowCount(tx, table, ctids)) > 0) {
    throw new ManualDecision("conflict_row_has_dependents", reference);
  }
  const deleted = await tx.$executeRawUnsafe(
    `DELETE FROM ${quoteIdentifier(table)} WHERE ctid::text = ANY($1::text[])`,
    ctids,
  );
  if (deleted !== ctids.length) throw new ManualDecision("conflict_row_changed", reference);
  return deleted;
}

async function countReferences(
  tx: Tx,
  columns: ReferenceColumn[],
  userId: string,
): Promise<number> {
  let total = 0;
  for (const { table, column } of columns) {
    const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} = $1`,
      userId,
    );
    total += Number(rows[0]?.n ?? 0);
  }
  return total;
}

interface GroupMember {
  id: string;
  erasedAt: Date | null;
  closedAt: Date | null;
  accountStatus: string;
}

/** Decides canonical/variant for a group, or throws `ManualDecision` with the shape problem. */
function classifyGroup(members: GroupMember[]): { canonical: GroupMember; variant: GroupMember } {
  if (members.length > 2) throw new ManualDecision("more_than_two_members");
  const lowercase = members.filter((member) => casingClassOf(member.id) === "lowercase");
  if (lowercase.length === 0) throw new ManualDecision("no_lowercase_member");
  if (lowercase.length > 1 || members.length !== 2) throw new ManualDecision("group_shape_unsupported");
  const canonical = lowercase[0];
  const variant = members.find((member) => member !== canonical)!;
  if (canonical.erasedAt) throw new ManualDecision("canonical_erased");
  if (variant.erasedAt || variant.closedAt || variant.accountStatus !== "active") {
    throw new ManualDecision("variant_not_live");
  }
  return { canonical, variant };
}

async function mergeGroupInTransaction(
  tx: Tx,
  key: string,
  columns: ReferenceColumn[],
  mode: MergeMode,
): Promise<MergedGroupOutcome> {
  const members = await tx.$queryRawUnsafe<GroupMember[]>(
    `SELECT id, "erasedAt", "closedAt", "accountStatus"::text AS "accountStatus"
     FROM "User" WHERE lower(id) = $1 ORDER BY id FOR UPDATE`,
    key,
  );
  const { canonical, variant } = classifyGroup(members);

  const moved: Record<string, number> = {};
  const deleted: Record<string, number> = {};

  for (const target of columns) {
    const reference = ref(target.table, target.column);
    await tx.$executeRawUnsafe("SAVEPOINT cvm_column");
    try {
      const count = await updateColumn(tx, target, variant.id, canonical.id);
      if (count > 0) moved[reference] = count;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cvm_column");
      const removed = await resolveUniqueConflict(tx, target, variant.id, canonical.id);
      deleted[target.table] = (deleted[target.table] ?? 0) + removed;
      try {
        const count = await updateColumn(tx, target, variant.id, canonical.id);
        if (count > 0) moved[reference] = count;
      } catch (retryError) {
        if (isUniqueViolation(retryError)) throw new ManualDecision("unknown_conflict", reference);
        throw retryError;
      }
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT cvm_column");
  }

  if ((await countReferences(tx, columns, variant.id)) !== 0) {
    throw new ManualDecision("residual_references");
  }
  const removedUsers = await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE id = $1`, variant.id);
  if (removedUsers !== 1) throw new ManualDecision("variant_user_not_deleted");

  const outcome: MergedGroupOutcome = {
    key,
    status: "merged",
    canonicalId: canonical.id,
    variantId: variant.id,
    moved,
    deleted,
  };
  if (mode === "dry-run") throw new DryRunRollback(outcome);
  return outcome;
}

async function mergeGroup(key: string, columns: ReferenceColumn[], mode: MergeMode): Promise<GroupOutcome> {
  try {
    return await prisma.$transaction((tx) => mergeGroupInTransaction(tx, key, columns, mode), {
      maxWait: 10_000,
      timeout: 120_000,
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome;
    const memberIds = await memberIdsOf(key);
    if (error instanceof ManualDecision) {
      return { key, status: "manual", reason: error.reason, reference: error.reference, memberIds };
    }
    // Never the message: a database error can quote the conflicting values.
    const state = sqlStateOf(error);
    return {
      key,
      status: "manual",
      reason: state ? `database_error_${state}` : "database_error",
      memberIds,
    };
  }
}

async function memberIdsOf(key: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "User" WHERE lower(id) = $1 ORDER BY id`,
    key,
  );
  return rows.map((row) => row.id);
}

async function listGroupKeys(limit?: number): Promise<{ keys: string[]; total: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(`
    SELECT lower(id) AS key
    FROM "User"
    GROUP BY lower(id)
    HAVING count(*) > 1
    ORDER BY lower(id)
  `);
  const keys = rows.map((row) => row.key);
  return { keys: limit ? keys.slice(0, limit) : keys, total: keys.length };
}

function addTo(target: Record<string, number>, key: string, amount: number) {
  target[key] = (target[key] ?? 0) + amount;
}

export function totalsOf(
  mode: MergeMode,
  groupsFound: number,
  outcomes: GroupOutcome[],
): MergeTotals {
  const movedByReference: Record<string, number> = {};
  const deletedByTable: Record<string, number> = {};
  const manualReasons = new Map<string, { reason: string; reference?: string; groups: number }>();
  let merged = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "merged") {
      merged += 1;
      for (const [reference, n] of Object.entries(outcome.moved)) addTo(movedByReference, reference, n);
      for (const [table, n] of Object.entries(outcome.deleted)) addTo(deletedByTable, table, n);
    } else {
      const id = `${outcome.reason}|${outcome.reference ?? ""}`;
      const entry = manualReasons.get(id) ?? { reason: outcome.reason, reference: outcome.reference, groups: 0 };
      entry.groups += 1;
      manualReasons.set(id, entry);
    }
  }
  const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);
  return {
    mode,
    groupsFound,
    groupsProcessed: outcomes.length,
    merged,
    manual: outcomes.length - merged,
    variantUsersDeleted: merged,
    rowsMoved: sum(movedByReference),
    rowsDeleted: sum(deletedByTable),
    movedByReference,
    deletedByTable,
    manualByReason: [...manualReasons.values()],
  };
}

export async function mergeCaseVariantUsers(options: MergeOptions): Promise<MergeResult> {
  const columns = await listReferenceColumns();
  const { keys, total } = await listGroupKeys(options.limit);
  const outcomes: GroupOutcome[] = [];
  for (const key of keys) {
    outcomes.push(await mergeGroup(key, columns, options.mode));
  }
  return { outcomes, totals: totalsOf(options.mode, total, outcomes) };
}

function logResult(totals: MergeTotals, detailsFileWritten: boolean) {
  const applied = totals.mode === "apply";
  for (const [reference, rows] of Object.entries(totals.movedByReference)) {
    writeStructuredLog({
      level: "info",
      event: "identity.case_variant_users.merge.moved",
      message: `${applied ? "Moved" : "Would move"} ${rows} row(s) in ${reference}`,
      mode: totals.mode,
      reference,
      rows,
    });
  }
  for (const [table, rows] of Object.entries(totals.deletedByTable)) {
    writeStructuredLog({
      level: "info",
      event: "identity.case_variant_users.merge.deleted",
      message: `${applied ? "Deleted" : "Would delete"} ${rows} duplicate row(s) in ${table}`,
      mode: totals.mode,
      table,
      rows,
    });
  }
  for (const entry of totals.manualByReason) {
    writeStructuredLog({
      level: "warn",
      event: "identity.case_variant_users.merge.manual",
      message: `${entry.groups} group(s) need a manual decision: ${entry.reason}`,
      mode: totals.mode,
      reason: entry.reason,
      reference: entry.reference ?? null,
      groups: entry.groups,
    });
  }
  const { movedByReference, deletedByTable, manualByReason, ...scalars } = totals;
  void movedByReference;
  void deletedByTable;
  void manualByReason;
  writeStructuredLog({
    level: "info",
    event: "identity.case_variant_users.merge",
    message:
      totals.groupsFound === 0
        ? "No case-variant user ids found"
        : `${applied ? "Merged" : "Dry-run: would merge"} ${totals.merged} of ${totals.groupsProcessed} group(s)`,
    detailsFileWritten,
    ...scalars,
  });
}

export async function runMergeCaseVariantUsers(argv: string[] = process.argv.slice(2)) {
  try {
    const options = parseMergeOptions(argv);
    const result = await mergeCaseVariantUsers(options);

    if (options.detailsFile) {
      // Ids are wallet addresses (personal data): owner-only, local file.
      const body = { generatedAt: new Date().toISOString(), mode: options.mode, groups: result.outcomes };
      writeFileSync(options.detailsFile, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      chmodSync(options.detailsFile, 0o600);
    }
    logResult(result.totals, Boolean(options.detailsFile));
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runMergeCaseVariantUsers()
    .then(({ totals }) => {
      process.exit(totals.manual > 0 ? 2 : 0);
    })
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "identity.case_variant_users.merge.crashed",
        message: "Case-variant user merge could not complete",
        // Database errors can quote the conflicting values: log only their class.
        error:
          error instanceof MergeArgumentError
            ? error.message
            : error instanceof Error
              ? error.constructor.name
              : typeof error,
      });
      process.exit(1);
    });
}
