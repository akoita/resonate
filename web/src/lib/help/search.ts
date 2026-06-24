import type { HelpArticle, HelpBlock, HelpIndexEntry } from "./types";

/**
 * Deterministic, dependency-free relevance search over the guide.
 *
 * Pure and synchronous so it runs identically on the server, in the client
 * search island, and in unit tests. Matching is term-AND (every whitespace-
 * separated term must appear somewhere), with field weighting so a title hit
 * ranks above a body hit.
 */

const WEIGHTS = {
  title: 12,
  keyword: 8,
  summary: 5,
  heading: 3,
  body: 1,
} as const;

function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "callout":
      return `${block.title ?? ""} ${block.text}`;
    case "steps":
    case "list":
      return block.items.join(" ");
    case "definitions":
      return block.items.map((d) => `${d.term} ${d.description}`).join(" ");
    case "figure":
      return `${block.figure.alt} ${block.figure.caption}`;
    default:
      return "";
  }
}

interface Indexed {
  title: string;
  keywords: string;
  summary: string;
  headings: string;
  body: string;
}

function indexArticle(a: HelpArticle | HelpIndexEntry): Indexed {
  const isFull = "sections" in a;
  return {
    title: a.title.toLowerCase(),
    keywords: a.keywords.join(" ").toLowerCase(),
    summary: a.summary.toLowerCase(),
    headings: isFull ? a.sections.map((s) => s.heading).join(" ").toLowerCase() : "",
    body: isFull
      ? a.sections.flatMap((s) => s.blocks.map(blockText)).join(" ").toLowerCase()
      : "",
  };
}

function scoreTerm(idx: Indexed, term: string): number {
  let score = 0;
  if (idx.title.includes(term)) score += WEIGHTS.title;
  if (idx.keywords.includes(term)) score += WEIGHTS.keyword;
  if (idx.summary.includes(term)) score += WEIGHTS.summary;
  if (idx.headings.includes(term)) score += WEIGHTS.heading;
  if (idx.body.includes(term)) score += WEIGHTS.body;
  return score;
}

export function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Returns articles matching every term in `query`, most relevant first.
 * An empty/blank query returns the input list unchanged (stable order).
 */
export function searchArticles<T extends HelpArticle | HelpIndexEntry>(
  articles: readonly T[],
  query: string,
): T[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [...articles];

  const scored: { article: T; score: number }[] = [];
  for (const article of articles) {
    const idx = indexArticle(article);
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const termScore = scoreTerm(idx, term);
      if (termScore === 0) {
        matchedAll = false;
        break;
      }
      total += termScore;
    }
    if (matchedAll) scored.push({ article, score: total });
  }

  scored.sort((x, y) => y.score - x.score || x.article.title.localeCompare(y.article.title));
  return scored.map((s) => s.article);
}
