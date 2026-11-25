import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { token: null as string | null, status: "idle", sessionChecked: true, connectPrivy: vi.fn() },
}));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("../../hooks/useProductSurfaces", () => ({ useProductSurfaces: () => ({ surfaces: { showsPledging: false }, loaded: true }) }));
const access = vi.hoisted(() => ({ value: "allowed" }));
vi.mock("./useCampaignManageAccess", () => ({ useCampaignManageAccess: () => access.value }));

import { ShowInterestPanel } from "./ShowInterestPanel";
import { ShowInterestOwnerPanel } from "./ShowInterestOwnerPanel";

describe("ShowInterestPanel (#2668)", () => {
  it("offers one free action, an optional city the fan types, and the notify choice, with no payment", () => {
    const html = renderToStaticMarkup(<ShowInterestPanel campaign={{ backendId: "c-1", city: "Lyon" }} />);
    expect(html).toContain("Sign in to say you would come");
    expect(html).toContain('name="interest-city"');
    expect(html).toContain('value=""');
    expect(html).toContain("Tell me when tickets or pledges open");
    expect(html).toContain("costs nothing");
    expect(html).not.toMatch(/USDC|wallet address|escrow|\bback(er)?\b/i);
  });

  it("asks a signed-in fan directly", () => {
    auth.current = { ...auth.current, token: "t", status: "authenticated" };
    const html = renderToStaticMarkup(<ShowInterestPanel campaign={{ backendId: "c-1", city: "Lyon" }} />);
    expect(html).toContain(">I would come<");
  });
});

describe("ShowInterestOwnerPanel (#2668)", () => {
  it("offers to ask who would come on the artist's own draft", () => {
    const html = renderToStaticMarkup(
      <ShowInterestOwnerPanel campaign={{ backendId: "c-1", rawStatus: "draft", mode: "pledge" }} />,
    );
    expect(html).toContain("Ask who would come");
  });

  it("keeps Open pledges switched off while pledging is unavailable", () => {
    const html = renderToStaticMarkup(
      <ShowInterestOwnerPanel campaign={{ backendId: "c-1", rawStatus: "draft", mode: "interest" }} />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Open pledges<\/button>/);
    expect(html).toContain("Pledges are not available yet");
  });

  it("shows nothing to someone who cannot manage the campaign, or on an active pledge campaign", () => {
    access.value = "denied";
    expect(
      renderToStaticMarkup(<ShowInterestOwnerPanel campaign={{ backendId: "c-1", rawStatus: "draft", mode: "interest" }} />),
    ).toBe("");
    access.value = "allowed";
    expect(
      renderToStaticMarkup(<ShowInterestOwnerPanel campaign={{ backendId: "c-1", rawStatus: "active", mode: "pledge" }} />),
    ).toBe("");
  });
});
