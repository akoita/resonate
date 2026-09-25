/**
 * Pure formatting helpers for in-app notification copy. Kept out of
 * notification.service.ts (which opens a Prisma client at import) so they can
 * be unit-tested without a database.
 */

/**
 * Format integer USD cents as a dollar string: 1234 → "$12.34", 5 → "$0.05".
 * Integer arithmetic only — credit amounts are cents and never floats.
 */
export function formatUsdCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

const WALLET_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * The notification inbox key for a user id, or null when the id is not a
 * wallet address. Notifications are keyed by lower-cased wallet address, and
 * for wallet and passkey accounts `User.id` *is* that address; an id of any
 * other shape has no inbox to deliver to.
 */
export function notifiableWalletForUserId(userId: string | null | undefined): string | null {
  const id = userId?.trim();
  if (!id || !WALLET_ADDRESS_PATTERN.test(id)) return null;
  return id.toLowerCase();
}
