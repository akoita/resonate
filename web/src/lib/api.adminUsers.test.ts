import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  ApiRequestError,
  buildAdminUsersQueryString,
  getAdminUser,
  getAdminUsersOverview,
  listAdminUsers,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("admin users API (#2166)", () => {
  it("calls the three read routes with the session token and no caching", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ totalUsers: 3 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: "user/one" }));
    vi.stubGlobal("fetch", fetchMock);

    await getAdminUsersOverview("session-token");
    await listAdminUsers("session-token");
    await getAdminUser("session-token", "user/one");

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      `${API_BASE}/admin/users/overview`,
      `${API_BASE}/admin/users`,
      `${API_BASE}/admin/users/user%2Fone`,
    ]);
    for (const [, init] of calls) {
      expect(init.cache).toBe("no-store");
      expect(init.method ?? "GET").toBe("GET");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer session-token");
    }
  });

  it("encodes every filter into the query string and leaves empty ones out", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], page: 2, pageSize: 50, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminUsers("t", {
      q: "  0xAb Cd&x=1  ",
      status: "suspended",
      role: "listener",
      activeWithinDays: 7,
      sort: "lastActiveAt",
      order: "asc",
      page: 2,
      pageSize: 50,
    });

    const url = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(url.pathname).toBe("/admin/users");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "0xAb Cd&x=1",
      status: "suspended",
      role: "listener",
      activeWithinDays: "7",
      sort: "lastActiveAt",
      order: "asc",
      page: "2",
      pageSize: "50",
    });
    // The search text cannot smuggle in a second parameter.
    expect(url.searchParams.get("x")).toBeNull();
  });

  it("builds an empty query string when nothing is set", () => {
    expect(buildAdminUsersQueryString({})).toBe("");
    expect(buildAdminUsersQueryString({ q: "   " })).toBe("");
    expect(buildAdminUsersQueryString({ inactiveForDays: 30 })).toBe("?inactiveForDays=30");
  });

  it("surfaces the status of a refusal so pages can word 403 and 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const error = await getAdminUser("t", "missing").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(404);
  });
});
