import { describe, expect, it } from "vitest";

import {
  AUDIENCES,
  HELP_ARTICLES,
  audiencesForReader,
  canSeeOperatorHelp,
  entriesForReader,
  forReader,
  indexEntries,
  isOperatorOnly,
} from "./index";

describe("operator help visibility", () => {
  it("treats only admin and operator roles as operators", () => {
    expect(canSeeOperatorHelp("admin")).toBe(true);
    expect(canSeeOperatorHelp("operator")).toBe(true);
    for (const role of [null, undefined, "", "listener", "artist", "agent"]) {
      expect(canSeeOperatorHelp(role)).toBe(false);
    }
  });

  it("knows an operator-only guide from a mixed one", () => {
    expect(isOperatorOnly(["operator"])).toBe(true);
    expect(isOperatorOnly(["everyone", "operator"])).toBe(false);
    expect(isOperatorOnly([])).toBe(false);
  });

  it("hides operator guides, sections, links and the operator filter from other readers", () => {
    const entries = indexEntries();
    const readerSlugs = entriesForReader(entries, false).map((e) => e.slug);
    expect(readerSlugs).not.toContain("admin-users");
    expect(readerSlugs).toContain("platform-notices");
    expect(entriesForReader(entries, true)).toHaveLength(entries.length);

    expect(audiencesForReader(AUDIENCES, false).map((a) => a.id)).not.toContain("operator");
    expect(audiencesForReader(AUDIENCES, true)).toHaveLength(AUDIENCES.length);
    expect(audiencesForReader(["everyone", "operator"], false)).toEqual(["everyone"]);

    const notices = HELP_ARTICLES.find((a) => a.slug === "platform-notices")!;
    expect(forReader(notices.sections, false).map((s) => s.id)).not.toContain(
      notices.sections.find((s) => s.audience === "operator")!.id,
    );
    expect(forReader(notices.sections, true)).toHaveLength(notices.sections.length);
    expect(forReader(notices.appLinks ?? [], false).map((l) => l.href)).not.toContain("/admin/notices");
  });

  it("keeps operator material where operators can find it", () => {
    for (const article of HELP_ARTICLES) {
      const tagged = [...article.sections, ...(article.appLinks ?? [])].some((item) => item.audience === "operator");
      if (tagged) expect(article.audiences, article.slug).toContain("operator");
      // Admin pages are only for operators and admins, so their links are too.
      for (const link of article.appLinks ?? []) {
        if (link.href.startsWith("/admin") && !isOperatorOnly(article.audiences)) {
          expect(link.audience, `${article.slug} → ${link.href}`).toBe("operator");
        }
      }
    }
  });
});
