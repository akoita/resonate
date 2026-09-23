import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE, getPendingManagementInvitations, type PendingManagementInvitations } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getPendingManagementInvitations", () => {
  it("loads the private pending invitation contract with the authenticated no-store request", async () => {
    const expected: PendingManagementInvitations = {
      grants: [{
        id: "grant-1",
        artistId: "artist-1",
        releaseId: null,
        resourceName: "Nova",
        scopes: ["CATALOG_READ", "TRACK_AUDIO"],
        expiresAt: "2026-10-01T00:00:00.000Z",
      }],
      transfers: [{
        id: "transfer-1",
        resourceType: "artist_profile",
        resources: [{ id: "artist-1", name: "Nova" }],
        expiresAt: "2026-10-01T00:00:00.000Z",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(expected), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPendingManagementInvitations("session-token")).resolves.toEqual(expected);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/management/invitations/pending`);
    expect(options.cache).toBe("no-store");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer session-token");
    expect(url).not.toContain("/metadata/notifications/");
  });
});
