import { sectionText, tokenize } from "./search";
import type { HelpArticle, HelpIndexEntry, HelpLevel, HelpSection } from "./types";

/**
 * Reader levels for guide articles (#1905).
 *
 * Any article can offer a Beginner / Intermediate / Professional path by
 * tagging sections with a `level`; untagged sections show on every level.
 * Everything here is pure so the server render, the client switch, search
 * and the unit tests share one set of rules.
 */

export interface HelpLevelMeta {
  id: HelpLevel;
  /** Tab label. */
  label: string;
}

/** Canonical order: shallowest first. */
export const HELP_LEVELS: readonly HelpLevelMeta[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "pro", label: "Professional" },
];

export const DEFAULT_HELP_LEVEL: HelpLevel = "beginner";

/** Query parameter that deep-links a level, e.g. `/help/remix-studio?level=pro`. */
export const HELP_LEVEL_PARAM = "level";

/** This viewer's last chosen level, remembered across levelled articles. */
export const HELP_LEVEL_STORAGE_KEY = "resonate.help.level";

const LEVEL_IDS: readonly HelpLevel[] = HELP_LEVELS.map((level) => level.id);

export function isHelpLevel(value: unknown): value is HelpLevel {
  return typeof value === "string" && (LEVEL_IDS as readonly string[]).includes(value);
}

/** A level from a URL parameter or storage; null when absent or unknown. */
export function parseHelpLevel(value: string | null | undefined): HelpLevel | null {
  const trimmed = value?.trim().toLowerCase();
  return isHelpLevel(trimmed) ? trimmed : null;
}

export function helpLevelLabel(level: HelpLevel): string {
  return HELP_LEVELS.find((entry) => entry.id === level)?.label ?? level;
}

/** The levels an article's sections use, in canonical order. */
export function articleLevels(article: Pick<HelpArticle, "sections">): HelpLevel[] {
  const used = new Set(article.sections.map((section) => section.level));
  return LEVEL_IDS.filter((level) => used.has(level));
}

/** Whether the article gets the level switch. */
export function isLevelledArticle(article: Pick<HelpArticle, "sections">): boolean {
  return articleLevels(article).length > 0;
}

/** Sections shown on `level`: its own plus every untagged one, in article order. */
export function sectionsForLevel(
  sections: readonly HelpSection[],
  level: HelpLevel,
): HelpSection[] {
  return sections.filter((section) => section.level === undefined || section.level === level);
}

/** The level a section anchor belongs to; null for untagged or unknown ids. */
export function levelForSectionId(
  sections: readonly HelpSection[],
  id: string | null | undefined,
): HelpLevel | null {
  if (!id) return null;
  return sections.find((section) => section.id === id)?.level ?? null;
}

/** The level after `level` among `levels`; null for the last one. */
export function nextHelpLevel(
  levels: readonly HelpLevel[],
  level: HelpLevel,
): HelpLevel | null {
  const index = levels.indexOf(level);
  return index >= 0 && index < levels.length - 1 ? levels[index + 1] : null;
}

/**
 * The tab a key moves to in a horizontal tablist (WAI-ARIA tabs pattern):
 * Left/Right wrap around, Home/End jump to the ends. Null for other keys.
 */
export function levelForKey(
  key: string,
  current: HelpLevel,
  levels: readonly HelpLevel[],
): HelpLevel | null {
  if (levels.length === 0) return null;
  const index = Math.max(0, levels.indexOf(current));
  switch (key) {
    case "ArrowRight":
      return levels[(index + 1) % levels.length];
    case "ArrowLeft":
      return levels[(index - 1 + levels.length) % levels.length];
    case "Home":
      return levels[0];
    case "End":
      return levels[levels.length - 1];
    default:
      return null;
  }
}

/** The level an article opens on before any URL or stored choice. */
export function defaultLevelFor(levels: readonly HelpLevel[]): HelpLevel {
  return levels.includes(DEFAULT_HELP_LEVEL) ? DEFAULT_HELP_LEVEL : (levels[0] ?? DEFAULT_HELP_LEVEL);
}

/**
 * The level to show. The URL wins over storage: a `#section` anchor that
 * names a levelled section opens that section's level (nothing else could
 * show it), then `?level=`, then the viewer's stored choice, then the default.
 * Levels the article doesn't use are ignored.
 */
export function resolveHelpLevel(input: {
  sections: readonly HelpSection[];
  param?: string | null;
  hash?: string | null;
  stored?: string | null;
}): HelpLevel {
  const levels = articleLevels({ sections: [...input.sections] });
  const usable = (level: HelpLevel | null): level is HelpLevel =>
    level !== null && levels.includes(level);
  const fromHash = levelForSectionId(input.sections, input.hash?.replace(/^#/, ""));
  if (usable(fromHash)) return fromHash;
  const fromParam = parseHelpLevel(input.param);
  if (usable(fromParam)) return fromParam;
  const fromStorage = parseHelpLevel(input.stored);
  if (usable(fromStorage)) return fromStorage;
  return defaultLevelFor(levels);
}

/**
 * Lowercased searchable text of each level's own sections (untagged sections
 * excluded); undefined for an article without levels.
 */
export function levelTextFor(
  article: Pick<HelpArticle, "sections">,
): Partial<Record<HelpLevel, string>> | undefined {
  const levels = articleLevels(article);
  if (levels.length === 0) return undefined;
  const text: Partial<Record<HelpLevel, string>> = {};
  for (const level of levels) {
    text[level] = article.sections
      .filter((section) => section.level === level)
      .map(sectionText)
      .join(" ")
      .toLowerCase();
  }
  return text;
}

/**
 * The level a search should open: the one whose own sections match the most
 * query terms, the shallowest on a tie. Null when the article has no levels
 * or no level's text matches (a title or keyword hit opens the default).
 */
export function matchedHelpLevel(
  article: HelpArticle | HelpIndexEntry,
  query: string,
): HelpLevel | null {
  const terms = tokenize(query);
  if (terms.length === 0) return null;
  const text = "sections" in article ? levelTextFor(article) : article.levelText;
  if (!text) return null;
  let best: HelpLevel | null = null;
  let bestCount = 0;
  for (const level of LEVEL_IDS) {
    const body = text[level];
    if (body === undefined) continue;
    const count = terms.filter((term) => body.includes(term)).length;
    if (count > bestCount) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

/** An article URL, with `?level=` when a level is given. */
export function helpArticleHref(slug: string, level?: HelpLevel | null): string {
  const base = `/help/${slug}`;
  return level ? `${base}?${HELP_LEVEL_PARAM}=${level}` : base;
}
