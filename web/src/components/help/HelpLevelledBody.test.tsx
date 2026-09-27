import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getArticle, indexEntries } from "../../lib/help";
import { levelForKey, parseHelpLevel, resolveHelpLevel } from "../../lib/help/levels";
import type { HelpLevel } from "../../lib/help/types";
import { helpCardHref } from "./HelpBrowser";
import { HelpLevelledBody, HelpLevelledView, urlWithLevel } from "./HelpLevelledBody";

const remix = getArticle("remix-studio")!;
const LEVELS: HelpLevel[] = ["beginner", "intermediate", "pro"];

function view(level: HelpLevel) {
  return renderToStaticMarkup(
    <HelpLevelledView
      level={level}
      levels={LEVELS}
      sections={remix.sections}
      intros={remix.levelIntros ?? {}}
    />,
  );
}

describe("level switch markup (#1905)", () => {
  it("server-renders Beginner by default as an accessible tablist", () => {
    const html = renderToStaticMarkup(
      <HelpLevelledBody sections={remix.sections} intros={remix.levelIntros ?? {}} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-labelledby="help-levels-label"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(/id="help-level-tab-beginner" aria-selected="true" aria-controls="help-level-panel" tabindex="0"/);
    expect(html).toMatch(/id="help-level-tab-pro" aria-selected="false" aria-controls="help-level-panel" tabindex="-1"/);
    expect(html).toMatch(/role="tabpanel" id="help-level-panel" aria-labelledby="help-level-tab-beginner"/);
    expect(html).toContain("Your first remix in 3 minutes");
    expect(html).toContain('id="first-remix"');
    expect(html).not.toContain('id="signal-chain"');
    // Shared sections show on every level.
    expect(html).toContain('id="glossary"');
    expect(html).toContain('id="eligibility"');
  });

  it("shows only the selected level's sections, and its outline", () => {
    const html = view("pro");
    expect(html).toMatch(/aria-labelledby="help-level-tab-pro"/);
    expect(html).toContain('id="signal-chain"');
    expect(html).toContain('href="#signal-chain"');
    expect(html).not.toContain('id="first-remix"');
    expect(html).not.toContain('href="#first-remix"');
  });

  it("ends each level but the last with a Ready for more? link to the next", () => {
    expect(view("beginner")).toContain('href="?level=intermediate"');
    expect(view("intermediate")).toContain('href="?level=pro"');
    expect(view("beginner")).toContain("Ready for more?");
    expect(view("pro")).not.toContain("Ready for more?");
    // It comes before the shared glossary.
    const html = view("beginner");
    expect(html.indexOf("Ready for more?")).toBeLessThan(html.indexOf('id="glossary"'));
  });
});

describe("level resolution", () => {
  const sections = remix.sections;

  it("defaults to Beginner", () => {
    expect(resolveHelpLevel({ sections })).toBe("beginner");
  });

  it("opens ?level= and lets the URL win over storage", () => {
    expect(resolveHelpLevel({ sections, param: "pro" })).toBe("pro");
    expect(resolveHelpLevel({ sections, stored: "intermediate" })).toBe("intermediate");
    expect(resolveHelpLevel({ sections, param: "pro", stored: "intermediate" })).toBe("pro");
    expect(resolveHelpLevel({ sections, param: "nonsense", stored: "intermediate" })).toBe("intermediate");
    expect(parseHelpLevel(" PRO ")).toBe("pro");
  });

  it("opens the level of a levelled #section anchor", () => {
    expect(resolveHelpLevel({ sections, hash: "#signal-chain", param: "beginner" })).toBe("pro");
    expect(resolveHelpLevel({ sections, hash: "#glossary", param: "intermediate" })).toBe("intermediate");
  });

  it("moves with arrow keys, Home and End, wrapping around", () => {
    expect(levelForKey("ArrowRight", "beginner", LEVELS)).toBe("intermediate");
    expect(levelForKey("ArrowRight", "pro", LEVELS)).toBe("beginner");
    expect(levelForKey("ArrowLeft", "beginner", LEVELS)).toBe("pro");
    expect(levelForKey("Home", "pro", LEVELS)).toBe("beginner");
    expect(levelForKey("End", "beginner", LEVELS)).toBe("pro");
    expect(levelForKey("Enter", "beginner", LEVELS)).toBeNull();
  });

  it("writes the level into the URL and drops a stale anchor", () => {
    expect(urlWithLevel("https://example.test/help/remix-studio?level=beginner#first-remix", "pro")).toBe(
      "https://example.test/help/remix-studio?level=pro",
    );
  });
});

describe("search deep links", () => {
  const entry = indexEntries().find((e) => e.slug === "remix-studio")!;

  it("opens the level a match comes from", () => {
    expect(helpCardHref(entry, "LUFS")).toBe("/help/remix-studio?level=pro");
    expect(helpCardHref(entry, "drag")).toBe("/help/remix-studio?level=intermediate");
    expect(helpCardHref(entry)).toBe("/help/remix-studio");
    const plain = indexEntries().find((e) => e.slug === "getting-started")!;
    expect(helpCardHref(plain, "passkey")).toBe("/help/getting-started");
  });
});
