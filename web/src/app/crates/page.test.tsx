import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav: { search: string } = { search: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crates",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("../../components/auth/AuthGate", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "auth-gate" }, children),
}));
vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({ token: null }),
}));
vi.mock("../../components/marketplace/MarketplaceBrowse", () => ({
  MarketplaceBrowse: ({ headingLevel }: { headingLevel?: number }) =>
    React.createElement("div", { "data-testid": "marketplace-browse", "data-heading-level": headingLevel }),
}));
vi.mock("../../lib/api", () => ({
  createCrateRequest: vi.fn(),
  deleteCrate: vi.fn(),
  listCrates: vi.fn(),
}));

import CratesPage from "./page";

function render(search = "") {
  nav.search = search;
  return renderToStaticMarkup(<CratesPage />);
}

function tabMarkup(html: string, id: "build" | "stems"): string {
  const match = html.match(new RegExp(`<button[^>]*id="crates-tab-${id}"[^>]*>`));
  expect(match, `tab ${id} rendered`).not.toBeNull();
  return match![0];
}

beforeEach(() => {
  nav.search = "";
});

describe("/crates tabs (#2032)", () => {
  it("titles the page Crates & Stems with an accessible tablist", () => {
    const html = render();

    expect(html).toContain("<h1>Crates &amp; Stems</h1>");
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Crates and stems"/);
    expect(html).toContain("Build a crate");
    expect(html).toContain("Browse stems");
    expect(html.match(/role="tab"/g)).toHaveLength(2);
  });

  it("defaults to the build tab behind the sign-in gate", () => {
    const html = render();

    expect(tabMarkup(html, "build")).toContain('aria-selected="true"');
    expect(tabMarkup(html, "build")).toContain('tabindex="0"');
    expect(tabMarkup(html, "stems")).toContain('aria-selected="false"');
    expect(tabMarkup(html, "stems")).toContain('tabindex="-1"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="crates-tab-build"');
    expect(html).toContain('data-testid="auth-gate"');
    expect(html).toContain("What does your set need?");
    expect(html).toContain("Your crates");
    expect(html).not.toContain('data-testid="marketplace-browse"');
    expect(html).not.toContain("crates-page--wide");
  });

  it("greets the build tab with an eyebrow and example prompts", () => {
    const html = render();

    expect(html).toContain('<p class="crates-eyebrow">Crate Digger</p>');
    for (const example of [
      "Six dark techno rollers at 128-132 BPM with drum stems",
      "Ten warm disco and nu-disco tracks around 118 BPM",
      "Four afro house tracks in 8A with vocal stems, under $15 each",
    ]) {
      expect(html).toContain(`<button type="button" class="crates-example">${example}</button>`);
    }
    expect(html.match(/class="crates-example"/g)).toHaveLength(3);
  });

  it("treats ?tab=build like no tab", () => {
    const html = render("tab=build");

    expect(tabMarkup(html, "build")).toContain('aria-selected="true"');
    expect(html).toContain('data-testid="auth-gate"');
  });

  it("shows the stem browser without the sign-in gate on ?tab=stems", () => {
    const html = render("tab=stems");

    expect(tabMarkup(html, "stems")).toContain('aria-selected="true"');
    expect(tabMarkup(html, "build")).toContain('aria-selected="false"');
    expect(html).toContain('aria-labelledby="crates-tab-stems"');
    expect(html).toContain('data-testid="marketplace-browse"');
    // The page owns the h1, so the embedded browser uses an h2 hero.
    expect(html).toContain('data-heading-level="2"');
    expect(html).not.toContain('data-testid="auth-gate"');
    expect(html).not.toContain("What does your set need?");
    expect(html).toContain("crates-page--wide");
  });

  it("keeps a reference-track arrival on the build tab", () => {
    const html = render("tab=stems&referenceTrackId=track-1");

    expect(tabMarkup(html, "build")).toContain('aria-selected="true"');
    expect(html).toContain("More like this track");
    expect(html).toContain('data-testid="auth-gate"');
    expect(html).not.toContain('data-testid="marketplace-browse"');
  });
});
