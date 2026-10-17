import "dotenv/config";
import { chmodSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma";
import { DANGLING_PERSON_COLUMNS } from "../modules/privacy/personal_data_erasure_manifest";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2180 - read-only report of `User` ids that are equal under lowercase.
 *
 * Wallet-account user ids are lowercase addresses. Before the id was
 * normalised at every creation point, a checksummed spelling of the same
 * address could create a second `User` (and a second wallet). This script
 * finds those groups so an operator can review them; it changes nothing and
 * merges nothing.
 *
 * Logs carry COUNTS ONLY (groups, users, referencing rows per table). The
 * ids themselves are wallet addresses, i.e. personal data, so they never reach
 * the logs. `--details-file <path>` writes the per-group detail (each variant's
 * id, casing class and the number of rows referencing it per table column) to a
 * local JSON file with owner-only permissions, for operator review.
 *
 * References are every single-column foreign key that points at `"User"."id"`
 * (read from the database catalog, so a newly added relation is included) plus
 * the person-id columns without a relation listed in the privacy erasure
 * manifest's `DANGLING_PERSON_COLUMNS`.
 *
 * Needs only a database URL (`DATABASE_URL`); no application boot.
 *
 * `--summary` additionally logs, per referencing `Table.column`, how many rows
 * point at lowercase variants and how many at mixed-case variants (aggregated
 * over all groups, counts only), to size a merge before running it
 * (`merge_case_variant_users.ts`).
 *
 * Exit codes: `0` when the report completed (including "no duplicates"), `1`
 * on an unexpected error or a missing `--details-file` value.
 *
 * Usage: `node dist/scripts/report_case_variant_users.js [--summary] [--details-file <path>]`
 */

export type CasingClass = "lowercase" | "mixed";

export interface ReferenceColumn {
  table: string;
  column: string;
}

export interface CaseVariantDetail {
  id: string;
  casing: CasingClass;
  createdAt: string;
  /** Rows referencing this id, keyed `Table.column`; zero counts are omitted. */
  references: Record<string, number>;
  referenceTotal: number;
}

export interface CaseVariantGroupDetail {
  /** The lowercase form shared by every variant in the group. */
  key: string;
  variants: CaseVariantDetail[];
}

export interface CaseVariantReport {
  generatedAt: string;
  groups: CaseVariantGroupDetail[];
}

/** Counts only: no ids reach the log. */
export interface CaseVariantSummary {
  groups: number;
  users: number;
  lowercaseVariants: number;
  mixedVariants: number;
  referenceColumnsScanned: number;
  referencingRows: number;
  tablesWithReferences: number;
}

export function parseDetailsFile(argv: string[]): string | undefined {
  const index = argv.indexOf("--details-file");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--details-file needs a file path");
  }
  return value;
}

export function hasSummaryFlag(argv: string[]): boolean {
  return argv.includes("--summary");
}

/** Rows referencing a lowercase variant vs a mixed-case variant, for one column. */
export interface ReferenceCasingCount {
  reference: string;
  lowercase: number;
  mixed: number;
}

/** Aggregates the per-variant reference counts by column and casing class. Counts only. */
export function summarizeReferencesByCasing(report: CaseVariantReport): ReferenceCasingCount[] {
  const byReference = new Map<string, ReferenceCasingCount>();
  for (const group of report.groups) {
    for (const variant of group.variants) {
      for (const [reference, count] of Object.entries(variant.references)) {
        const entry = byReference.get(reference) ?? { reference, lowercase: 0, mixed: 0 };
        entry[variant.casing] += count;
        byReference.set(reference, entry);
      }
    }
  }
  return [...byReference.values()].sort((a, b) => a.reference.localeCompare(b.reference));
}

export function casingClassOf(id: string): CasingClass {
  return id === id.toLowerCase() ? "lowercase" : "mixed";
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-column foreign keys that reference `"User"."id"`, from the catalog. */
export async function listUserForeignKeyColumns(): Promise<ReferenceColumn[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(`
    SELECT cl.relname AS table_name, att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    JOIN pg_attribute refatt ON refatt.attrelid = con.confrelid AND refatt.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND ref.relname = 'User'
      AND refatt.attname = 'id'
      AND array_length(con.conkey, 1) = 1
      AND ns.nspname = current_schema()
    ORDER BY cl.relname, att.attname
  `);
  return rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

/** The manifest's relation-less person-id columns that exist in this database. */
export async function listDanglingPersonColumns(): Promise<ReferenceColumn[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  `);
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return DANGLING_PERSON_COLUMNS
    .map((entry) => ({ table: entry.model, column: entry.column }))
    .filter((entry) => present.has(`${entry.table}.${entry.column}`));
}

export async function listReferenceColumns(): Promise<ReferenceColumn[]> {
  const merged = new Map<string, ReferenceColumn>();
  for (const entry of [...(await listUserForeignKeyColumns()), ...(await listDanglingPersonColumns())]) {
    merged.set(`${entry.table}.${entry.column}`, entry);
  }
  return [...merged.values()];
}

export async function buildCaseVariantReport(): Promise<{
  report: CaseVariantReport;
  referenceColumnsScanned: number;
}> {
  const groupRows = await prisma.$queryRawUnsafe<Array<{ key: string; ids: string[] }>>(`
    SELECT lower(id) AS key, array_agg(id ORDER BY id) AS ids
    FROM "User"
    GROUP BY lower(id)
    HAVING count(*) > 1
    ORDER BY lower(id)
  `);
  const generatedAt = new Date().toISOString();
  const allIds = groupRows.flatMap((row) => row.ids);
  if (allIds.length === 0) {
    return { report: { generatedAt, groups: [] }, referenceColumnsScanned: 0 };
  }

  const createdRows = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: { id: true, createdAt: true },
  });
  const createdAtById = new Map(createdRows.map((row) => [row.id, row.createdAt.toISOString()]));

  const columns = await listReferenceColumns();
  const countsById = new Map<string, Record<string, number>>();
  for (const { table, column } of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ ref: string; n: number }>>(
      `SELECT ${quoteIdentifier(column)} AS ref, count(*)::int AS n
       FROM ${quoteIdentifier(table)}
       WHERE ${quoteIdentifier(column)} = ANY($1::text[])
       GROUP BY ${quoteIdentifier(column)}`,
      allIds,
    );
    for (const row of rows) {
      const counts = countsById.get(row.ref) ?? {};
      counts[`${table}.${column}`] = (counts[`${table}.${column}`] ?? 0) + Number(row.n);
      countsById.set(row.ref, counts);
    }
  }

  const groups: CaseVariantGroupDetail[] = groupRows.map((row) => ({
    key: row.key,
    variants: row.ids.map((id) => {
      const references = countsById.get(id) ?? {};
      return {
        id,
        casing: casingClassOf(id),
        createdAt: createdAtById.get(id) ?? "",
        references,
        referenceTotal: Object.values(references).reduce((sum, n) => sum + n, 0),
      };
    }),
  }));
  return { report: { generatedAt, groups }, referenceColumnsScanned: columns.length };
}

export function summarizeReport(
  report: CaseVariantReport,
  referenceColumnsScanned: number,
): CaseVariantSummary {
  const variants = report.groups.flatMap((group) => group.variants);
  const tables = new Set<string>();
  for (const variant of variants) {
    for (const key of Object.keys(variant.references)) {
      tables.add(key.slice(0, key.indexOf(".")));
    }
  }
  return {
    groups: report.groups.length,
    users: variants.length,
    lowercaseVariants: variants.filter((variant) => variant.casing === "lowercase").length,
    mixedVariants: variants.filter((variant) => variant.casing === "mixed").length,
    referenceColumnsScanned,
    referencingRows: variants.reduce((sum, variant) => sum + variant.referenceTotal, 0),
    tablesWithReferences: tables.size,
  };
}

export async function runCaseVariantReport(argv: string[] = process.argv.slice(2)) {
  try {
    const detailsFile = parseDetailsFile(argv);
    const { report, referenceColumnsScanned } = await buildCaseVariantReport();
    const summary = summarizeReport(report, referenceColumnsScanned);

    if (detailsFile) {
      // Ids are wallet addresses (personal data): owner-only, local file.
      writeFileSync(detailsFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      chmodSync(detailsFile, 0o600);
    }

    writeStructuredLog({
      level: "info",
      event: "identity.case_variant_users.report",
      message:
        summary.groups === 0
          ? "No case-variant user ids found"
          : `Found ${summary.groups} case-variant user id group(s)`,
      detailsFileWritten: Boolean(detailsFile),
      ...summary,
    });

    const referencesByCasing = hasSummaryFlag(argv) ? summarizeReferencesByCasing(report) : [];
    // One line per column keeps each log entry small however many columns hold rows.
    for (const entry of referencesByCasing) {
      writeStructuredLog({
        level: "info",
        event: "identity.case_variant_users.report.reference",
        message: `References to case-variant users in ${entry.reference}`,
        ...entry,
      });
    }
    return { report, summary, referencesByCasing };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runCaseVariantReport()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "identity.case_variant_users.crashed",
        message: "Case-variant user report could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
