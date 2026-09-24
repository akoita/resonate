/**
 * /shows explorer (#1869): a successful empty campaign list renders an honest
 * empty state — never the built-in sample campaigns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../components/shows/ShowsCampaignFilters", () => ({
  ShowsCampaignFilters: () => null,
}));
// The real card needs the app router; a marker is enough to count cards here.
vi.mock("../../components/shows/CampaignCard", () => ({
  CampaignCard: ({ campaign }: { campaign: { title: string } }) =>
    React.createElement("article", { className: "campaign-card" }, campaign.title),
}));

import ShowsExplorerPage from "./page";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockCampaignList(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await ShowsExplorerPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

describe("ShowsExplorerPage empty state", () => {
  it("shows an honest empty state with a Create campaign link when no campaign is open", async () => {
    mockCampaignList([]);

    const html = await renderPage();

    expect(html).toContain("No campaigns are open for pledges right now.");
    expect(html).not.toContain("campaign-card");
    expect(html).not.toContain("SennaRin");
    const createLinks = html.match(/<a[^>]*href="\/shows\/create"[^>]*>Create campaign<\/a>/g) ?? [];
    // Toolbar link + empty-state link share the same target.
    expect(createLinks).toHaveLength(2);
  });

  it("uses filter-specific copy when an operator filter matches nothing", async () => {
    mockCampaignList([]);

    const html = await renderPage({ status: "released" });

    expect(html).toContain("No campaigns match this filter.");
  });

  it("renders the campaign grid when the API returns campaigns", async () => {
    mockCampaignList([
      {
        id: "campaign-1",
        slug: "real-show",
        artistDisplayName: "Real Artist",
        title: "Real Artist in Lyon",
        city: "Lyon",
        country: "FR",
        deadline: "2099-09-01T00:00:00.000Z",
        goalAmountUnits: "1000000",
        raisedAmountUnits: "0",
        currency: "EUR",
        status: "active",
      },
    ]);

    const html = await renderPage();

    expect(html).toContain('class="campaign-grid"');
    expect(html).toContain("Real Artist in Lyon");
    expect(html).not.toContain("shows-page__empty");
  });
});
