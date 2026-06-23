import { HELP_ARTICLES } from "./content";
import { CATEGORIES } from "./taxonomy";
import type {
  HelpArticle,
  HelpAudience,
  HelpCategoryId,
  HelpIndexEntry,
  HelpStatus,
} from "./types";

export * from "./types";
export * from "./taxonomy";
export * from "./search";
export { HELP_ARTICLES } from "./content";

const BY_SLUG = new Map(HELP_ARTICLES.map((a) => [a.slug, a]));

export function allArticles(): HelpArticle[] {
  return HELP_ARTICLES;
}

export function getArticle(slug: string): HelpArticle | undefined {
  return BY_SLUG.get(slug);
}

export function articleSlugs(): string[] {
  return HELP_ARTICLES.map((a) => a.slug);
}

export function articleStatus(article: HelpArticle): HelpStatus {
  return article.status ?? "available";
}

/** The lightweight projection passed to the client search/browse island. */
export function toIndexEntry(article: HelpArticle): HelpIndexEntry {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category: article.category,
    audiences: article.audiences,
    status: articleStatus(article),
    keywords: article.keywords,
  };
}

export function indexEntries(): HelpIndexEntry[] {
  return HELP_ARTICLES.map(toIndexEntry);
}

/** Articles grouped by category, in the canonical category order. */
export function articlesByCategory(): { category: HelpCategoryId; articles: HelpArticle[] }[] {
  return CATEGORIES.map((c) => ({
    category: c.id,
    articles: HELP_ARTICLES.filter((a) => a.category === c.id),
  })).filter((g) => g.articles.length > 0);
}

export function articlesForAudience(audience: HelpAudience): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.audiences.includes(audience));
}

/** Resolve an article's related slugs into full articles (skipping any miss). */
export function relatedArticles(article: HelpArticle): HelpArticle[] {
  return (article.related ?? [])
    .map((slug) => BY_SLUG.get(slug))
    .filter((a): a is HelpArticle => Boolean(a));
}
