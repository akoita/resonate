/**
 * Types for the in-app User Guide (`/help`).
 *
 * The guide is authored as structured, type-safe content (not free-form
 * MDX) so that:
 *  - every article renders with a consistent, accessible structure
 *    (correct heading order, real lists for steps, captioned figures);
 *  - search can index titles, summaries, keywords, and body text without
 *    parsing markdown at runtime;
 *  - screenshots are referenced by a checked path so a broken image can be
 *    caught by a test instead of shipping to users.
 *
 * Content lives in `content.ts`. This file only defines the shape.
 */

/** Who an article is primarily written for. Drives the persona filter. */
export type HelpAudience =
  | "everyone"
  | "listener"
  | "artist"
  | "producer"
  | "curator"
  | "operator";

/** Top-level grouping on the guide landing page. */
export type HelpCategoryId =
  | "get-started"
  | "discover"
  | "library"
  | "marketplace"
  | "create"
  | "artists"
  | "shows"
  | "community"
  | "trust"
  | "account";

/**
 * Maturity of the feature an article describes, so the manual can be honest
 * about partial/coming-soon capabilities instead of over-promising.
 */
export type HelpStatus = "available" | "partial" | "coming-soon";

/**
 * Reader level for articles that offer a Beginner / Intermediate /
 * Professional path (#1905). A section tagged with a level shows only on that
 * level; untagged sections (a glossary, eligibility) show on every level.
 */
export type HelpLevel = "beginner" | "intermediate" | "pro";

/** Per-article framing of one level, shown at the top of its panel. */
export interface HelpLevelIntro {
  /** Short promise, e.g. "Your first remix in 3 minutes". */
  title: string;
  /** One plain sentence on who the level is for and what it covers. */
  summary: string;
}

/** A captioned screenshot or illustration. */
export interface HelpFigureRef {
  /** Path under `web/public`, e.g. "/help/screenshots/discover-home.png". */
  src: string;
  /** Descriptive alt text — required for screen-reader users. */
  alt: string;
  /** Visible caption shown beneath the figure. */
  caption: string;
  /** Natural pixel dimensions; set on the <img> to avoid layout shift. */
  width: number;
  height: number;
  /** Optional small provenance note, e.g. "Staging". */
  source?: string;
}

/** A single renderable block within a section. */
export type HelpBlock =
  | { kind: "paragraph"; text: string }
  /** Ordered, do-this-then-that instructions. Rendered as <ol>. */
  | { kind: "steps"; items: string[] }
  /** Unordered points. Rendered as <ul>. */
  | { kind: "list"; items: string[] }
  /** A highlighted aside. */
  | { kind: "callout"; tone: "tip" | "note" | "warning"; title?: string; text: string }
  /** A captioned screenshot. */
  | { kind: "figure"; figure: HelpFigureRef }
  /** Term/definition pairs. Rendered as <dl>. */
  | { kind: "definitions"; items: { term: string; description: string }[] };

export interface HelpSection {
  /** Anchor id, unique within the article (used by the "On this page" nav). */
  id: string;
  heading: string;
  blocks: HelpBlock[];
  /**
   * Only show this section on one level of a levelled article (#1905).
   * Omitted = shown on every level.
   */
  level?: HelpLevel;
}

/** A deep link from an article into the live app. */
export interface HelpAppLink {
  label: string;
  /** In-app route, e.g. "/marketplace". */
  href: string;
  description: string;
}

export interface HelpArticle {
  /** URL slug under `/help/[slug]`. Stable; used in links and search. */
  slug: string;
  title: string;
  /** One- or two-sentence plain-language summary. */
  summary: string;
  category: HelpCategoryId;
  audiences: HelpAudience[];
  /** Defaults to "available" when omitted. */
  status?: HelpStatus;
  /** Extra search terms (synonyms, jargon users might type). */
  keywords: string[];
  sections: HelpSection[];
  /**
   * Framing for each level. Required for every level a section uses; an
   * article whose sections carry a `level` gets the level switch.
   */
  levelIntros?: Partial<Record<HelpLevel, HelpLevelIntro>>;
  appLinks?: HelpAppLink[];
  /** Slugs of related articles. */
  related?: string[];
}

/** Lightweight projection sent to the client search/browse island. */
export interface HelpIndexEntry {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategoryId;
  audiences: HelpAudience[];
  status: HelpStatus;
  keywords: string[];
  /**
   * Levelled articles only (#1905): the lowercased heading + body text of
   * each level's own sections, so client search can match every level and
   * open the level a match comes from.
   */
  levelText?: Partial<Record<HelpLevel, string>>;
}
