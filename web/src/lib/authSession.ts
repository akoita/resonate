export const TOKEN_KEY = "resonate.token";
export const ADDRESS_KEY = "resonate.address";
export const SA_ADDRESS_KEY = "resonate.smartAccountAddress";
export const PRIVY_USER_KEY = "resonate.privy.userId";
export const MOCK_AUTH_KEY = "resonate.mock_auth";
// Non-auth app state cleared by a full local reset (#1199). These are
// app-owned localStorage keys only — never the platform passkey/authenticator,
// which we cannot and must not touch.
export const KNOWN_ADDRESSES_KEY = "resonate.knownAddresses";
export const AI_SESSION_KEY = "resonate_ai_session";
export const AUTH_INVALIDATED_EVENT = "resonate:auth-invalidated";

export type AuthInvalidationReason =
  | "api_unauthorized"
  | "manual_disconnect"
  | "session_reset";

export function clearStoredAuthSession() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  localStorage.removeItem(SA_ADDRESS_KEY);
  localStorage.removeItem(PRIVY_USER_KEY);
}

export function invalidateStoredAuthSession(reason: AuthInvalidationReason = "api_unauthorized") {
  if (typeof window === "undefined") return;
  if (reason === "api_unauthorized" && isMockAuthSession()) return;

  clearStoredAuthSession();
  window.dispatchEvent(
    new CustomEvent(AUTH_INVALIDATED_EVENT, {
      detail: { reason },
    }),
  );
}

/**
 * Full local reset (#1199): clears auth plus the other app-owned local state
 * (known addresses, AI session) so the browser starts clean against a new or
 * reset backend environment. Returns the keys it removed so callers/tests can
 * assert. Does NOT touch passkeys (platform authenticator) or any non-app
 * origin data; a reload after this is sufficient (there is no service worker).
 */
export function resetLocalAppState(): string[] {
  if (typeof window === "undefined") return [];

  const keys = [
    TOKEN_KEY,
    ADDRESS_KEY,
    SA_ADDRESS_KEY,
    PRIVY_USER_KEY,
    KNOWN_ADDRESSES_KEY,
    AI_SESSION_KEY,
  ];
  for (const key of keys) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(
    new CustomEvent(AUTH_INVALIDATED_EVENT, {
      detail: { reason: "session_reset" as AuthInvalidationReason },
    }),
  );
  return keys;
}

function isMockAuthSession() {
  return (
    process.env.NEXT_PUBLIC_MOCK_AUTH === "true" ||
    localStorage.getItem(MOCK_AUTH_KEY) === "true"
  );
}
