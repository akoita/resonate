export const TOKEN_KEY = "resonate.token";
export const ADDRESS_KEY = "resonate.address";
export const SA_ADDRESS_KEY = "resonate.smartAccountAddress";
export const PRIVY_USER_KEY = "resonate.privy.userId";
export const MOCK_AUTH_KEY = "resonate.mock_auth";
export const AUTH_INVALIDATED_EVENT = "resonate:auth-invalidated";

export type AuthInvalidationReason = "api_unauthorized" | "manual_disconnect";

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

function isMockAuthSession() {
  return (
    process.env.NEXT_PUBLIC_MOCK_AUTH === "true" ||
    localStorage.getItem(MOCK_AUTH_KEY) === "true"
  );
}
