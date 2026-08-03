import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the subsetted Material Symbols font (#1491).
 *
 * `app/layout.tsx` requests the Google Fonts CSS with `&icon_names=<list>`,
 * which cuts the download from ~3.96 MB (the whole variable icon set) to
 * ~25 KB. The trade-off is that Material Symbols icons are *ligatures*: the
 * glyph is selected from the element's text content. If a name is not in the
 * subset there is no graceful fallback — the browser renders the literal
 * string, so a user sees the word "play_arrow" instead of a play icon.
 *
 * This test scans `web/src` for `.ms-icon` elements, collects every ligature
 * name they can render, and asserts each one is present in the `icon_names`
 * list in `layout.tsx`.
 *
 * Known limits of the static scan (deliberate, documented rather than hidden):
 *  - It only reads `.ts`/`.tsx` markup. An icon name injected from CSS
 *    (`content: "play_arrow"` on a `.ms-icon` pseudo-element) or from a
 *    non-TS template would not be seen. No such usage exists today.
 *  - A name that cannot be resolved to string literals (e.g.
 *    `<span className="ms-icon">{icon}</span>`) cannot be proven covered.
 *    Rather than silently ignoring it, the scan records it and the
 *    "no unresolvable icon names" test fails with the offending snippet.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT_FILE = path.join(SRC_DIR, "app", "layout.tsx");

const SCANNED_EXTENSIONS = [".ts", ".tsx"];
const SKIPPED_DIRS = new Set(["node_modules", ".next", "__snapshots__"]);
// Test files are not shipped markup — and this file's own doc comment contains
// example `.ms-icon` snippets that would otherwise be scanned as real usage.
const SKIPPED_FILE_PATTERN = /\.test\.tsx?$/;

/**
 * Icon names that are genuinely required but cannot be discovered by the
 * scanner (e.g. supplied from CSS or from a runtime value). Add an entry here
 * — with a comment explaining where it comes from — instead of silently
 * loosening the checks below. Empty today.
 */
const UNSCANNABLE_ICON_NAMES: readonly string[] = [];

// ---------------------------------------------------------------------------
// layout.tsx parsing
// ---------------------------------------------------------------------------

function readDeclaredIconNames(): string[] {
  const layout = readFileSync(LAYOUT_FILE, "utf8");
  const href = layout.match(
    /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"'\s]*/,
  )?.[0];
  if (!href) {
    throw new Error(
      `No Material Symbols stylesheet URL found in ${LAYOUT_FILE}. If the icon ` +
        `font moved, move this guard with it — see the comment above the <link> tag.`,
    );
  }
  const match = href.match(/[?&]icon_names=([A-Za-z0-9_,]+)/);
  if (!match) {
    throw new Error(
      `No "icon_names=" parameter in the Material Symbols URL in ${LAYOUT_FILE}. ` +
        `The stylesheet must stay subsetted (#1491): the full variable icon font is ` +
        `~3.96 MB and is downloaded on every route.`,
    );
  }
  return match[1].split(",").filter(Boolean);
}

// ---------------------------------------------------------------------------
// .ms-icon scanning
// ---------------------------------------------------------------------------

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIPPED_DIRS.has(entry)) continue;
      files.push(...listSourceFiles(full));
    } else if (
      SCANNED_EXTENSIONS.includes(path.extname(entry)) &&
      !SKIPPED_FILE_PATTERN.test(entry)
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Index of the `>` that closes the JSX opening tag starting at `startIdx`,
 * skipping over `>` characters nested inside `{...}` expressions or strings.
 */
function findOpeningTagEnd(source: string, startIdx: number): number {
  let depth = 0;
  let i = startIdx;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    } else if (ch === ">" && depth <= 0) {
      return i;
    }
    i += 1;
  }
  return -1;
}

const STRING_LITERAL = /(['"`])([^'"`\\]*)\1/g;

/**
 * Blank out `//` and block comments (keeping newlines so reported line numbers
 * stay correct) so that commented-out or documented `.ms-icon` snippets — like
 * the explanatory comment above the <link> in layout.tsx — are not scanned as
 * real markup. String literals are left intact.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += source.slice(start, Math.min(i, source.length));
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      // Preserve newlines so `lineOf()` keeps reporting real line numbers.
      out += source.slice(start, i).replace(/[^\n]/g, " ");
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface ScanResult {
  /** Ligature names the markup can render. */
  names: Set<string>;
  /** `file:line — snippet` for children the scanner could not resolve. */
  unresolved: string[];
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Resolve the possible ligature names for the children of one `.ms-icon`
 * element. Returns `null` when the children cannot be statically resolved.
 */
function resolveChildren(children: string): string[] | null {
  const names: string[] = [];
  let plainText = "";
  let i = 0;

  while (i < children.length) {
    const ch = children[i];
    if (ch !== "{") {
      plainText += ch;
      i += 1;
      continue;
    }

    // Collect a balanced {...} expression.
    let depth = 0;
    let j = i;
    for (; j < children.length; j += 1) {
      if (children[j] === "{") depth += 1;
      else if (children[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j >= children.length) return null; // unbalanced — bail loudly
    const expression = children.slice(i + 1, j).trim();
    i = j + 1;

    if (expression.startsWith("/*")) continue; // {/* JSX comment */}

    const literals = [...expression.matchAll(STRING_LITERAL)].map((m) => m[2]);
    if (literals.length === 0) return null; // e.g. {icon} — not resolvable

    // The expression is only resolvable if every value it can evaluate to is a
    // string literal. We accept a bare literal (`{"play_arrow"}`) or a ternary
    // whose two branches are both literals (`{busy ? "a" : "b"}`). Anything
    // else (nested ternaries, `cond && icon`, `icon ?? "a"`) is reported.
    const normalized = expression.replace(STRING_LITERAL, "§");
    const isBareLiteral = /^\s*§\s*$/.test(normalized);
    const isLiteralTernary = /\?\s*§\s*:\s*§\s*$/.test(normalized);
    if (!isBareLiteral && !isLiteralTernary) return null;

    names.push(...literals);
  }

  const text = plainText.trim();
  if (text.length > 0) {
    if (!/^[a-z][a-z0-9_]*$/.test(text)) return null; // nested markup / odd text
    names.push(text);
  }

  return names;
}

function scanIconUsages(): ScanResult {
  const names = new Set<string>();
  const unresolved: string[] = [];

  for (const file of listSourceFiles(SRC_DIR)) {
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("ms-icon")) continue;
    const source = stripComments(raw);
    if (!source.includes("ms-icon")) continue;

    const tagPattern = /<([A-Za-z][\w.]*)/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagPattern.exec(source)) !== null) {
      const tagName = tag[1];
      const tagEnd = findOpeningTagEnd(source, tag.index + tag[0].length);
      if (tagEnd === -1) continue;

      const attributes = source.slice(tag.index + tag[0].length, tagEnd);
      if (!/\bms-icon\b/.test(attributes)) continue;
      if (source[tagEnd - 1] === "/") continue; // self-closing: renders nothing

      const closeIdx = source.indexOf(`</${tagName}>`, tagEnd);
      const location = `${path.relative(SRC_DIR, file)}:${lineOf(source, tag.index)}`;
      if (closeIdx === -1) {
        unresolved.push(`${location} — no closing </${tagName}>`);
        continue;
      }

      const children = source.slice(tagEnd + 1, closeIdx);
      const resolved = resolveChildren(children);
      if (resolved === null) {
        unresolved.push(`${location} — ${children.trim().replace(/\s+/g, " ")}`);
        continue;
      }
      for (const name of resolved) names.add(name);
    }
  }

  return { names, unresolved };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Material Symbols icon subset", () => {
  const declared = readDeclaredIconNames();
  const { names: used, unresolved } = scanIconUsages();

  it("finds .ms-icon usages to check (the scanner still works)", () => {
    expect(used.size).toBeGreaterThan(10);
  });

  it("declares every icon name rendered by .ms-icon markup", () => {
    const declaredSet = new Set(declared);
    const missing = [...used].filter((name) => !declaredSet.has(name)).sort();
    expect(
      missing,
      `These icons are rendered with className="ms-icon" but are missing from the ` +
        `icon_names= subset in src/app/layout.tsx: ${missing.join(", ")}. ` +
        `Without them the browser paints the literal ligature text (e.g. the word ` +
        `"play_arrow") instead of the icon. Add them to the sorted list in layout.tsx.`,
    ).toEqual([]);
  });

  it("has no unresolvable icon names (nothing the scan silently misses)", () => {
    expect(
      unresolved,
      `These .ms-icon elements do not have a statically resolvable ligature name, ` +
        `so this guard cannot prove the font subset covers them:\n  ${unresolved.join("\n  ")}\n` +
        `Either use string literals for the icon name, or add the names to ` +
        `UNSCANNABLE_ICON_NAMES in this file with a comment explaining the source.`,
    ).toEqual([]);
  });

  it("keeps the icon_names list sorted, de-duplicated and free of dead entries", () => {
    expect(declared, "icon_names= in layout.tsx must be sorted alphabetically").toEqual(
      [...declared].sort(),
    );
    expect(new Set(declared).size, "icon_names= in layout.tsx has duplicates").toBe(
      declared.length,
    );

    const needed = new Set([...used, ...UNSCANNABLE_ICON_NAMES]);
    const unused = declared.filter((name) => !needed.has(name));
    expect(
      unused,
      `These icons are in the icon_names= subset in src/app/layout.tsx but are no ` +
        `longer used anywhere: ${unused.join(", ")}. Remove them to keep the font ` +
        `download minimal, or record them in UNSCANNABLE_ICON_NAMES in this file.`,
    ).toEqual([]);
  });
});
