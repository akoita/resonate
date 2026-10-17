/**
 * Canonical form of a `User.id` (#2180).
 *
 * Wallet and passkey accounts use their smart-account address as the user id,
 * and the sign-in flow stores it lowercased. An address can arrive in any
 * casing (EIP-55 checksummed, upper, mixed), so every place that creates or
 * looks up a `User` from an address-derived id must normalise it first;
 * otherwise the same account is stored twice under two ids.
 *
 * Address-shaped ids (0x + 40 hex) are lowercased. Every other id (uuid-style
 * ids, rotated ids after erasure, test ids, ...) is returned unchanged.
 */
export const ETH_ADDRESS_ID_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function normalizeUserId(id: string): string {
  return typeof id === "string" && ETH_ADDRESS_ID_PATTERN.test(id)
    ? id.toLowerCase()
    : id;
}
