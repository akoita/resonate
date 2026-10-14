/**
 * #2130: owner access to a draft comes from the backend managed read, never a
 * JWT role. No DOM test environment is installed, so the hook's request and
 * no-request decisions are exercised through the functions it is built from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ status: "idle", token: null }) }));

import {
  campaignManageAccessWithoutFetch,
  resolveCampaignManageAccess,
} from "./useCampaignManageAccess";

const originalFetch = globalThis.fetch;

const backendCampaign = {
  id: "3f0c1a52-8f5e-4c1e-9d7a-2b6f1e0c9a41",
  slug: "my-show",
  artistDisplayName: "Test Artist",
  title: "Test Artist in Paris",
  city: "Paris",
  country: "FR",
  deadline: "2026-12-01T00:00:00.000Z",
  goalAmountUnits: "1000000",
  raisedAmountUnits: "0",
  currency: "USD",
  status: "draft",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("campaignManageAccessWithoutFetch", () => {
  it("denies without a request when the check is disabled", () => {
    expect(campaignManageAccessWithoutFetch({ enabled: false, status: "authenticated", token: "t" })).toBe("denied");
  });

  it("waits while a sign-in is in flight", () => {
    expect(campaignManageAccessWithoutFetch({ enabled: true, status: "loading", token: null })).toBe("checking");
  });

  it("reports signed-out viewers without a request", () => {
    expect(campaignManageAccessWithoutFetch({ enabled: true, status: "idle", token: null })).toBe("signed-out");
    expect(campaignManageAccessWithoutFetch({ enabled: true, status: "error", token: null })).toBe("signed-out");
    expect(campaignManageAccessWithoutFetch({ enabled: true, status: "authenticated", token: null })).toBe("signed-out");
  });

  it("defers to the managed read for an authenticated viewer", () => {
    expect(campaignManageAccessWithoutFetch({ enabled: true, status: "authenticated", token: "t" })).toBeNull();
  });
});

describe("resolveCampaignManageAccess", () => {
  it("allows a viewer the managed read answers, using their bearer token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => backendCampaign }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(resolveCampaignManageAccess({ campaignId: backendCampaign.id, token: "jwt" })).resolves.toBe("allowed");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/shows/campaigns/${backendCampaign.id}/manage`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("denies a signed-in non-owner the managed read rejects", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;

    await expect(resolveCampaignManageAccess({ campaignId: backendCampaign.id, token: "jwt" })).resolves.toBe("denied");
  });

  it("denies when the managed read fails on the network", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    await expect(resolveCampaignManageAccess({ campaignId: backendCampaign.id, token: "jwt" })).resolves.toBe("denied");
  });
});
