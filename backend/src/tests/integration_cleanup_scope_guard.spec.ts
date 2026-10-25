import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * #2420 guard. Integration suites share one Testcontainers database and run in
 * parallel, so a suite that wipes a whole table (`deleteMany({})`) in its
 * cleanup deletes the rows other suites are still using. Cleanup must be scoped
 * to rows the suite created (a test prefix, collected ids, or a chain id the
 * suite owns).
 *
 * Source scan: every `.deleteMany(...)` in `*.integration.spec.ts` must pass a
 * `where` that is not empty. Raw `TRUNCATE` and `DELETE FROM` without `WHERE`
 * are flagged for the same reason.
 *
 * Add a `file:line` to ALLOWLIST only with a reason a reviewer can verify
 * (for example, a suite that provisions its own isolated database).
 */
const SRC_ROOT = join(__dirname, "..");

/** `relative/path.integration.spec.ts:line` -> reason the wipe is safe. */
const ALLOWLIST: Record<string, string> = {};

function integrationSpecs(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" || entry === "generated" ? [] : integrationSpecs(full);
    }
    return full.endsWith(".integration.spec.ts") ? [full] : [];
  });
}

function stripComments(text: string): string {
  // Keep newlines so reported line numbers stay accurate.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Returns the raw text between the parentheses opened at `openIndex`. */
function callArgument(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")" && --depth === 0) return source.slice(openIndex + 1, i);
  }
  return source.slice(openIndex + 1);
}

/** True when a `deleteMany` argument cannot delete every row of the table. */
export function isScopedDeleteManyArgument(rawArgument: string): boolean {
  const argument = stripComments(rawArgument).trim();
  if (argument === "") return false;
  if (!argument.startsWith("{")) return false; // a variable: not statically verifiable
  const where = /\bwhere\s*:\s*(\{\s*\}|undefined\b)/.exec(argument);
  if (where) return false;
  // `where: <expr>` or the `{ where }` shorthand; the scope itself is the suite's.
  return /\bwhere\s*[:,}]/.test(argument);
}

export function findUnscopedCleanup(rawSource: string): Array<{ line: number; text: string }> {
  const source = stripComments(rawSource);
  const findings: Array<{ line: number; text: string }> = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const record = (index: number, text: string) =>
    findings.push({ line: lineOf(index), text: text.replace(/\s+/g, " ").trim().slice(0, 120) });

  for (const match of source.matchAll(/\.deleteMany\s*\(/g)) {
    const open = match.index! + match[0].length - 1;
    const argument = callArgument(source, open);
    if (!isScopedDeleteManyArgument(argument)) record(match.index!, `deleteMany(${argument})`);
  }
  for (const match of source.matchAll(/\bTRUNCATE\b/gi)) {
    record(match.index!, "TRUNCATE");
  }
  for (const match of source.matchAll(/\bDELETE\s+FROM\s+("[^"]+"|\w+)\s*(?=[`'";)]|$)/gim)) {
    record(match.index!, match[0]);
  }
  return findings;
}

describe("integration suites never wipe shared tables (#2420)", () => {
  it("finds no unscoped deleteMany/TRUNCATE/DELETE in *.integration.spec.ts", () => {
    const offenders = integrationSpecs(SRC_ROOT).flatMap((file) => {
      const name = relative(SRC_ROOT, file);
      return findUnscopedCleanup(readFileSync(file, "utf8")).flatMap((finding) =>
        `${name}:${finding.line}` in ALLOWLIST ? [] : [`${name}:${finding.line}: ${finding.text}`],
      );
    });
    expect(offenders).toEqual([]);
  });

  it("keeps every allowlist entry justified", () => {
    for (const [location, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.trim().length).toBeGreaterThan(10);
      expect(location).toMatch(/\.integration\.spec\.ts:\d+$/);
    }
  });

  it("flags the whole-table wipes that broke parallel suites", () => {
    expect(isScopedDeleteManyArgument("")).toBe(false);
    expect(isScopedDeleteManyArgument("{}")).toBe(false);
    expect(isScopedDeleteManyArgument("{ }")).toBe(false);
    expect(isScopedDeleteManyArgument("{ where: {} }")).toBe(false);
    expect(isScopedDeleteManyArgument("{ where: undefined }")).toBe(false);
    expect(isScopedDeleteManyArgument("filter")).toBe(false);
    expect(findUnscopedCleanup("await prisma.stemListing.deleteMany({}).catch(() => {});")).toHaveLength(1);
    expect(findUnscopedCleanup("await prisma.stemListing.deleteMany();")).toHaveLength(1);
    expect(findUnscopedCleanup("await prisma.$executeRaw`TRUNCATE TABLE \"User\"`;")).toHaveLength(1);
    expect(findUnscopedCleanup('await prisma.$executeRawUnsafe(`DELETE FROM "User"`);')).toHaveLength(1);
  });

  it("accepts cleanup scoped to the suite's own rows", () => {
    expect(isScopedDeleteManyArgument("{ where: { id: { startsWith: P } } }")).toBe(true);
    expect(isScopedDeleteManyArgument("{\n  where: { chainId: PURGE_CHAIN_ID },\n}")).toBe(true);
    expect(isScopedDeleteManyArgument("{ where }")).toBe(true);
    expect(findUnscopedCleanup("await prisma.user.deleteMany({ where: { id: { in: ids } } });")).toEqual([]);
    expect(findUnscopedCleanup('await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${id}`;')).toEqual([]);
  });
});
