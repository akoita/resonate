/**
 * #2130: a draft reached by its internal id (the uuid) redirects to its slug
 * edit URL; the slug URL renders the access-gated editor.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => navigation);
vi.mock("../../../../components/shows/CampaignDraftForm", () => ({
  CampaignDraftForm: () => React.createElement("form", { "data-marker": "draft-form" }),
}));
vi.mock("../../../../components/shows/CampaignDraftEditGate", () => ({
  CampaignDraftEditGate: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-marker": "edit-gate" }, children),
}));

import EditShowCampaignPage from "./page";

const UUID = "3f0c1a52-8f5e-4c1e-9d7a-2b6f1e0c9a41";
const backendCampaign = {
  id: UUID,
  slug: "my-show",
  artistDisplayName: "Test Artist",
  title: "My Show",
  city: "Paris",
  country: "FR",
  deadline: "2026-12-01T00:00:00.000Z",
  goalAmountUnits: "1000000",
  raisedAmountUnits: "0",
  currency: "USD",
  status: "draft",
};

const originalFetch = globalThis.fetch;

function mockCampaign(body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

async function renderPage(campaignId: string) {
  const element = await EditShowCampaignPage({ params: Promise.resolve({ campaignId }) });
  return renderToStaticMarkup(element);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  navigation.redirect.mockClear();
  navigation.notFound.mockClear();
});

describe("EditShowCampaignPage canonical URL (#2130)", () => {
  it("redirects a uuid edit URL to the slug edit URL", async () => {
    mockCampaign(backendCampaign);

    await expect(renderPage(UUID)).rejects.toThrow("REDIRECT:/shows/my-show/edit");
    expect(navigation.redirect).toHaveBeenCalledWith("/shows/my-show/edit");
  });

  it("renders the access-gated editor on the slug URL without redirecting", async () => {
    mockCampaign(backendCampaign);

    const html = await renderPage("my-show");

    expect(navigation.redirect).not.toHaveBeenCalled();
    expect(html).toContain('data-marker="edit-gate"');
    expect(html).toContain('data-marker="draft-form"');
    expect(html).toMatch(/<a[^>]*href="\/shows\/my-show"[^>]*>My Show<\/a>/);
  });

  it("does not offer the editor once the campaign is no longer a draft", async () => {
    mockCampaign({ ...backendCampaign, status: "active" });

    const html = await renderPage("my-show");

    expect(html).toContain("Campaign is active");
    expect(html).not.toContain("draft-form");
  });
});
