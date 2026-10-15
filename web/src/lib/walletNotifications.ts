/**
 * Authenticated client for the wallet notification routes under
 * /api/metadata/notifications. The backend requires sign-in and only serves
 * the caller's own addresses, so every call sends the user's token; without a
 * token nothing is sent. A refused request (401/403) reads as "no
 * notifications" and never throws, so the bell and settings stay quiet.
 */

export interface WalletNotificationFeed<TNotification = unknown> {
  notifications: TNotification[];
  unreadCount: number;
}

export interface NotificationPreferenceValues {
  disputeFiled: boolean;
  disputeResolved: boolean;
  disputeAppealed: boolean;
  evidenceSubmitted: boolean;
  listingExpiringSoon: boolean;
  listingExpired: boolean;
}

const NOTIFICATIONS_PATH = "/api/metadata/notifications";

const isRefused = (status: number) => status === 401 || status === 403;

function authHeaders(token: string, json = false): HeadersInit {
  return json
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { Authorization: `Bearer ${token}` };
}

/**
 * Load the caller's notification feed for `address`. Returns an empty feed
 * when signed out (no request) or when the backend refuses the request, and
 * `null` on any other failure so callers can keep what they already show.
 */
export async function fetchWalletNotifications<TNotification = unknown>(
  address: string,
  token: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<WalletNotificationFeed<TNotification> | null> {
  const empty: WalletNotificationFeed<TNotification> = { notifications: [], unreadCount: 0 };
  if (!token || !address) return empty;
  try {
    const res = await fetchImpl(`${NOTIFICATIONS_PATH}/${encodeURIComponent(address)}`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (isRefused(res.status)) return empty;
    if (!res.ok) return null;
    const data = await res.json();
    return {
      notifications: Array.isArray(data?.notifications) ? data.notifications : [],
      unreadCount: typeof data?.unreadCount === "number" ? data.unreadCount : 0,
    };
  } catch {
    return null;
  }
}

/** Mark one notification read. Resolves true when the backend accepted it. */
export async function markWalletNotificationRead(
  notificationId: string,
  token: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !notificationId) return false;
  try {
    const res = await fetchImpl(`${NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId)}/read`, {
      method: "PATCH",
      headers: authHeaders(token),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Mark every notification for `address` read. Resolves true when accepted. */
export async function markAllWalletNotificationsRead(
  address: string,
  token: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !address) return false;
  try {
    const res = await fetchImpl(`${NOTIFICATIONS_PATH}/${encodeURIComponent(address)}/read-all`, {
      method: "PATCH",
      headers: authHeaders(token),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load notification preferences for `address`; null when signed out, refused or failed. */
export async function fetchNotificationPreferences(
  address: string,
  token: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationPreferenceValues | null> {
  if (!token || !address) return null;
  try {
    const res = await fetchImpl(`${NOTIFICATIONS_PATH}/${encodeURIComponent(address)}/preferences`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as NotificationPreferenceValues;
  } catch {
    return null;
  }
}

/** Update notification preferences for `address`. Resolves true when accepted. */
export async function updateNotificationPreferences(
  address: string,
  token: string | null | undefined,
  patch: Partial<NotificationPreferenceValues>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !address) return false;
  try {
    const res = await fetchImpl(`${NOTIFICATIONS_PATH}/${encodeURIComponent(address)}/preferences`, {
      method: "PATCH",
      headers: authHeaders(token, true),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}
