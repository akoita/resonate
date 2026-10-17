import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIENCES, CATEGORIES, getArticle, indexEntries } from "../../lib/help";

const auth = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ role: auth.role }) }));

import { HelpArticleView } from "./HelpArticleView";
import { HelpBrowser } from "./HelpBrowser";

function article(slug: string) {
  return renderToStaticMarkup(<HelpArticleView article={getArticle(slug)!} />);
}

function browser() {
  return renderToStaticMarkup(<HelpBrowser entries={indexEntries()} categories={CATEGORIES} audiences={AUDIENCES} />);
}

describe("operator material in the User Guide", () => {
  beforeEach(() => {
    auth.role = null;
  });

  it("shows readers who are not operators a guide without operator material", () => {
    for (const role of [null, "listener", "artist"]) {
      auth.role = role;
      const html = article("platform-notices");
      expect(html).toContain("Get notices by email");
      expect(html).not.toContain("Sending a notice (operators)");
      expect(html).not.toContain('href="/admin/notices"');
      expect(html).not.toContain("Operators &amp; admins");

      const list = browser();
      expect(list).not.toContain("Finding people and opening their record");
      expect(list).not.toContain("Operators &amp; admins");
      expect(list).toContain("Platform notices");
    }
  });

  it("shows operators and admins everything", () => {
    for (const role of ["operator", "admin"]) {
      auth.role = role;
      const html = article("platform-notices");
      expect(html).toContain("Sending a notice (operators)");
      const sendId = getArticle("platform-notices")!.sections.find((s) => s.audience === "operator")!.id;
      expect(html).toContain(`href="#${sendId}"`);
      expect(html).toContain('href="/admin/notices"');
      expect(html).toContain("Operators &amp; admins");

      const list = browser();
      expect(list).toContain("Finding people and opening their record");
      expect(list).toContain("Operators &amp; admins");
    }
  });

  it("replaces an operator-only guide with a short note for everyone else", () => {
    const reader = article("admin-users");
    expect(reader).toContain("For operators and admins");
    expect(reader).not.toContain("A person&#x27;s record");
    // The chip still says who the guide is for.
    expect(reader).toContain("Operators &amp; admins");

    auth.role = "admin";
    const operator = article("admin-users");
    expect(operator).not.toContain("This guide covers tools that only operators and admins can use");
    expect(operator).toContain("A person&#x27;s record");
  });

  it("drops related links to operator-only guides for other readers", () => {
    expect(article("account-suspension")).not.toContain('href="/help/admin-users"');
    auth.role = "operator";
    expect(article("account-suspension")).toContain('href="/help/admin-users"');
  });
});
