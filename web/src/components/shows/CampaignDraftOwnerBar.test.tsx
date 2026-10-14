import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { token: null as string | null, status: "idle" as string },
}));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.current }));

// Effects don't run under renderToStaticMarkup, so the resolved access is
// injected here; the managed-read decision itself is covered in
// useCampaignManageAccess.test.ts. Unmocked cases run the real hook.
const access = vi.hoisted(() => ({ override: null as string | null }));
vi.mock("./useCampaignManageAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useCampaignManageAccess")>();
  return {
    ...actual,
    useCampaignManageAccess: (...args: Parameters<typeof actual.useCampaignManageAccess>) => {
      const real = actual.useCampaignManageAccess(...args);
      return access.override ?? real;
    },
  };
});

import { CampaignDraftOwnerBar } from "./CampaignDraftOwnerBar";

const draft = {
  id: "my-show",
  backendId: "3f0c1a52-8f5e-4c1e-9d7a-2b6f1e0c9a41",
  rawStatus: "draft",
};

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  auth.current = { token: null, status: "idle" };
  access.override = null;
});

describe("CampaignDraftOwnerBar (#2130)", () => {
  it("offers Edit draft to a viewer the backend lets manage the campaign", () => {
    auth.current = { token: "jwt", status: "authenticated" };
    access.override = "allowed";

    const html = renderToStaticMarkup(<CampaignDraftOwnerBar campaign={draft} />);

    expect(html).toContain('aria-label="Draft campaign"');
    expect(html).toMatch(/<a[^>]*href="\/shows\/my-show\/edit"[^>]*>Edit draft<\/a>/);
  });

  it("renders nothing for an anonymous viewer", () => {
    const html = renderToStaticMarkup(<CampaignDraftOwnerBar campaign={draft} />);

    expect(html).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders nothing while the managed read is pending", () => {
    auth.current = { token: "jwt", status: "authenticated" };

    expect(renderToStaticMarkup(<CampaignDraftOwnerBar campaign={draft} />)).toBe("");
  });

  it("renders nothing for a signed-in viewer the backend denies", () => {
    auth.current = { token: "jwt", status: "authenticated" };
    access.override = "denied";

    expect(renderToStaticMarkup(<CampaignDraftOwnerBar campaign={draft} />)).toBe("");
  });

  it("renders nothing for a non-draft campaign without asking the backend", () => {
    auth.current = { token: "jwt", status: "authenticated" };

    const html = renderToStaticMarkup(
      <CampaignDraftOwnerBar campaign={{ ...draft, rawStatus: "active" }} />,
    );

    expect(html).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
