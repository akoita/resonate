import { describe, expect, it, vi } from "vitest";
import {
  fetchNotificationPreferences,
  fetchWalletNotifications,
  markAllWalletNotificationsRead,
  markWalletNotificationRead,
  updateNotificationPreferences,
} from "./walletNotifications";

const ADDRESS = `0x${"a1".repeat(20)}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authHeaderOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return new Headers(init.headers).get("Authorization");
}

describe("fetchWalletNotifications", () => {
  it("sends the sign-in token and returns the feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ notifications: [{ id: "n1" }], unreadCount: 1 }),
    );
    await expect(fetchWalletNotifications(ADDRESS, "session-token", fetchMock)).resolves.toEqual({
      notifications: [{ id: "n1" }],
      unreadCount: 1,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`/api/metadata/notifications/${ADDRESS}`);
    expect(authHeaderOf(fetchMock)).toBe("Bearer session-token");
  });

  it("sends no request when signed out and returns an empty feed", async () => {
    const fetchMock = vi.fn();
    await expect(fetchWalletNotifications(ADDRESS, null, fetchMock)).resolves.toEqual({
      notifications: [],
      unreadCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("treats %s as no notifications", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Forbidden" }, status));
    await expect(fetchWalletNotifications(ADDRESS, "session-token", fetchMock)).resolves.toEqual({
      notifications: [],
      unreadCount: 0,
    });
  });

  it("returns null on other failures without throwing", async () => {
    const serverError = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(fetchWalletNotifications(ADDRESS, "session-token", serverError)).resolves.toBeNull();
    const networkError = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(fetchWalletNotifications(ADDRESS, "session-token", networkError)).resolves.toBeNull();
  });
});

describe("mark notifications read", () => {
  it("PATCHes one notification with the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "n1", read: true }));
    await expect(markWalletNotificationRead("n1", "session-token", fetchMock)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/metadata/notifications/n1/read");
    expect(init.method).toBe("PATCH");
    expect(authHeaderOf(fetchMock)).toBe("Bearer session-token");
  });

  it("PATCHes read-all with the token and reports a refusal as false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(markAllWalletNotificationsRead(ADDRESS, "session-token", fetchMock)).resolves.toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/metadata/notifications/${ADDRESS}/read-all`);
    expect(init.method).toBe("PATCH");
    expect(authHeaderOf(fetchMock)).toBe("Bearer session-token");
  });

  it("sends nothing when signed out", async () => {
    const fetchMock = vi.fn();
    await expect(markWalletNotificationRead("n1", undefined, fetchMock)).resolves.toBe(false);
    await expect(markAllWalletNotificationsRead(ADDRESS, null, fetchMock)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("notification preferences", () => {
  it("loads preferences with the token", async () => {
    const prefs = {
      disputeFiled: false,
      disputeResolved: true,
      disputeAppealed: true,
      evidenceSubmitted: true,
      listingExpiringSoon: true,
      listingExpired: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(prefs));
    await expect(fetchNotificationPreferences(ADDRESS, "session-token", fetchMock)).resolves.toEqual(prefs);
    expect(authHeaderOf(fetchMock)).toBe("Bearer session-token");
  });

  it("returns null when refused or signed out", async () => {
    const refused = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(fetchNotificationPreferences(ADDRESS, "session-token", refused)).resolves.toBeNull();
    const signedOut = vi.fn();
    await expect(fetchNotificationPreferences(ADDRESS, null, signedOut)).resolves.toBeNull();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it("PATCHes a preference change as JSON with the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ disputeFiled: false }));
    await expect(
      updateNotificationPreferences(ADDRESS, "session-token", { disputeFiled: false }, fetchMock),
    ).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/metadata/notifications/${ADDRESS}/preferences`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ disputeFiled: false }));
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
