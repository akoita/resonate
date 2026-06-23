import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIENCES,
  CATEGORIES,
  HELP_ARTICLES,
  allArticles,
  articleSlugs,
  getArticle,
  indexEntries,
  relatedArticles,
  searchArticles,
  toIndexEntry,
  tokenize,
} from "./index";

const AUDIENCE_IDS = new Set(AUDIENCES.map((a) => a.id));
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

// web/src/lib/help/help.test.ts → web/public
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");

describe("help content integrity", () => {
  it("has a non-trivial number of articles", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(15);
  });

  it("has unique slugs", () => {
    const slugs = articleSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses url-safe slugs", () => {
    for (const slug of articleSlugs()) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("references only known categories and audiences", () => {
    for (const article of HELP_ARTICLES) {
      expect(CATEGORY_IDS.has(article.category)).toBe(true);
      expect(article.audiences.length).toBeGreaterThan(0);
      for (const audience of article.audiences) {
        expect(AUDIENCE_IDS.has(audience)).toBe(true);
      }
    }
  });

  it("resolves every related slug to a real article", () => {
    for (const article of HELP_ARTICLES) {
      for (const slug of article.related ?? []) {
        expect(getArticle(slug), `related slug "${slug}" in "${article.slug}"`).toBeDefined();
      }
    }
  });

  it("has complete, well-formed sections", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim().length).toBeGreaterThan(0);
      expect(article.summary.trim().length).toBeGreaterThan(0);
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(article.sections.length).toBeGreaterThan(0);

      const ids = article.sections.map((s) => s.id);
      expect(new Set(ids).size, `duplicate section id in "${article.slug}"`).toBe(ids.length);

      for (const section of article.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses in-app (relative) hrefs for every app link", () => {
    for (const article of HELP_ARTICLES) {
      for (const link of article.appLinks ?? []) {
        expect(link.href.startsWith("/"), `${article.slug}: ${link.href}`).toBe(true);
      }
    }
  });

  it("points every figure at an existing screenshot with alt text", () => {
    for (const article of HELP_ARTICLES) {
      for (const section of article.sections) {
        for (const block of section.blocks) {
          if (block.kind !== "figure") continue;
          const { src, alt, caption } = block.figure;
          expect(src.startsWith("/help/screenshots/"), src).toBe(true);
          expect(alt.trim().length, `missing alt for ${src}`).toBeGreaterThan(10);
          expect(caption.trim().length).toBeGreaterThan(0);
          const onDisk = path.join(PUBLIC_DIR, src.replace(/^\//, ""));
          expect(existsSync(onDisk), `screenshot file missing: ${onDisk}`).toBe(true);
        }
      }
    }
  });
});

describe("help index projection", () => {
  it("projects every article into an index entry", () => {
    expect(indexEntries().length).toBe(allArticles().length);
  });

  it("keeps the searchable fields in the projection", () => {
    const entry = toIndexEntry(HELP_ARTICLES[0]);
    expect(entry.slug).toBe(HELP_ARTICLES[0].slug);
    expect(entry.title).toBe(HELP_ARTICLES[0].title);
    expect(entry.status).toBeDefined();
  });
});

describe("help search", () => {
  it("tokenizes on whitespace and lowercases", () => {
    expect(tokenize("  Remix  Studio ")).toEqual(["remix", "studio"]);
  });

  it("returns all articles (stable) for a blank query", () => {
    expect(searchArticles(HELP_ARTICLES, "   ")).toHaveLength(HELP_ARTICLES.length);
  });

  it("finds the expected article for representative queries", () => {
    const find = (q: string) => searchArticles(HELP_ARTICLES, q).map((a) => a.slug);
    expect(find("remix")).toContain("remix-studio");
    expect(find("passkey")).toContain("getting-started");
    expect(find("refund")).toContain("shows-back");
    expect(find("list stems")).toContain("marketplace-sell");
    expect(find("reset session")).toContain("troubleshooting");
  });

  it("ranks a title match above a body-only match", () => {
    const results = searchArticles(HELP_ARTICLES, "wallet");
    expect(results[0].slug).toBe("smart-wallet");
  });

  it("requires every term to match (AND semantics)", () => {
    expect(searchArticles(HELP_ARTICLES, "remix zzzznotaword")).toHaveLength(0);
  });

  it("works over lightweight index entries too", () => {
    const hits = searchArticles(indexEntries(), "marketplace");
    expect(hits.map((h) => h.slug)).toContain("marketplace-buy");
  });

  it("resolves related articles to full objects", () => {
    const article = getArticle("getting-started")!;
    const related = relatedArticles(article);
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((a) => typeof a.title === "string")).toBe(true);
  });
});
