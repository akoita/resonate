import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIENCES,
  CATEGORIES,
  HELP_ARTICLES,
  allArticles,
  articleLevels,
  articleSlugs,
  getArticle,
  helpArticleHref,
  indexEntries,
  matchedHelpLevel,
  relatedArticles,
  searchArticles,
  sectionsForLevel,
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

  it("references the seeded-owner guide screenshots", () => {
    const content = JSON.stringify(HELP_ARTICLES);
    for (const filename of ["artist-analytics.png", "artist-catalog.png", "community.png"]) {
      expect(content).toContain(`/help/screenshots/${filename}`);
    }
  });

  it("keeps upload guidance honest about self-attestation and release gating", () => {
    const article = getArticle("upload-music");
    const text = JSON.stringify(article).toLowerCase();

    expect(text).toContain("self-attestation is not independent rights verification");
    expect(text).toContain("request evidence");
    expect(text).toContain("marketplace access");
    expect(text).toContain("release's rights state");
    expect(text).toContain("account verification alone does not clear release rights");
  });

  it("separates account, personhood, provenance, economic, and release-rights signals", () => {
    const article = getArticle("rights-protection");
    const text = JSON.stringify(article).toLowerCase();

    expect(text).toContain("account trust");
    expect(text).toContain("human/personhood");
    expect(text).toContain("self-attested on-chain");
    expect(text).toContain("verified economic tier");
    expect(text).toContain("rights verified is reserved");
    expect(text).toContain("submitted evidence was reviewed");
    expect(text).toContain("release-scoped rights");
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

describe("help levels (#1905)", () => {
  const remix = getArticle("remix-studio")!;

  it("gives every levelled article an intro per level and sections on each level", () => {
    for (const article of HELP_ARTICLES) {
      const levels = articleLevels(article);
      for (const level of levels) {
        expect(article.levelIntros?.[level]?.title, `${article.slug}: ${level} intro`).toBeTruthy();
        expect(sectionsForLevel(article.sections, level).some((s) => s.level === level)).toBe(true);
      }
    }
  });

  it("offers Remix Studio on all three levels, with a shared glossary", () => {
    expect(articleLevels(remix)).toEqual(["beginner", "intermediate", "pro"]);
    const glossary = remix.sections.find((s) => s.id === "glossary")!;
    expect(glossary.level).toBeUndefined();
    for (const level of ["beginner", "intermediate", "pro"] as const) {
      expect(sectionsForLevel(remix.sections, level).map((s) => s.id)).toContain("glossary");
    }
    expect(sectionsForLevel(remix.sections, "beginner").map((s) => s.id)).not.toContain("signal-chain");
  });

  it("explains every studio control label in the glossary", () => {
    const glossary = remix.sections.find((s) => s.id === "glossary")!;
    const block = glossary.blocks.find((b) => b.kind === "definitions");
    const terms = block && block.kind === "definitions" ? block.items.map((d) => d.term).join(" | ") : "";
    for (const label of [
      "Stem", "Section", "Block", "Pickup", "M / S", "All on / All off", "Effects", "Space", "Echo",
      "Tone", "Warmth", "Speed", "Varispeed", "Keep original pitch", "semitone", "Vibe",
      "Arrangement / Draft / Original", "Loop", "Volume", "Reset to original", "Pro", "EQ", "Pan",
      "Beat", "take", "lane", "Audition", "Render", "Draft", "Grounding / provenance",
      "Remix vs commercial license",
    ]) {
      expect(terms, label).toContain(label);
    }
    // The old lane label is still explained for readers who saw it.
    expect(JSON.stringify(glossary)).toContain("FX");
  });

  it("illustrates the studio with at least 5 captured screenshots, including the annotated overview", () => {
    const shots = JSON.stringify(remix).match(/\/help\/screenshots\/remix-studio-[a-z-]+\.png/g) ?? [];
    expect(new Set(shots).size).toBeGreaterThanOrEqual(5);
    expect(shots).toContain("/help/screenshots/remix-studio-overview.png");
  });

  it("keeps the render policy and Pro EQ numbers in line with the code", () => {
    const pro = JSON.stringify(sectionsForLevel(remix.sections, "pro"));
    for (const fact of ["−14 LUFS", "−1.5 dBTP", "320 kbps", "Low 200 Hz", "Mid 1 kHz", "High 4 kHz", "−12 to +12 dB", "8 bars", "16-second"]) {
      expect(pro, fact).toContain(fact);
    }
    expect(pro).toContain("Planned, not available yet");
  });

  it("indexes level text so search finds a match in any level and opens that level", () => {
    const entry = toIndexEntry(remix);
    expect(Object.keys(entry.levelText ?? {})).toEqual(["beginner", "intermediate", "pro"]);
    expect(searchArticles(indexEntries(), "lufs").map((e) => e.slug)).toContain("remix-studio");
    expect(matchedHelpLevel(entry, "lufs")).toBe("pro");
    expect(matchedHelpLevel(entry, "drag paint")).toBe("intermediate");
    expect(matchedHelpLevel(entry, "vibe")).toBe("beginner");
    expect(matchedHelpLevel(entry, "zzzznotaword")).toBeNull();
    expect(helpArticleHref("remix-studio", matchedHelpLevel(entry, "lufs"))).toBe(
      "/help/remix-studio?level=pro",
    );
    // Articles without levels keep a plain link and no extra payload.
    const plain = toIndexEntry(getArticle("getting-started")!);
    expect(plain.levelText).toBeUndefined();
    expect(matchedHelpLevel(plain, "passkey")).toBeNull();
  });
});
