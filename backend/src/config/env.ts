/**
 * Parse a comma-separated environment variable into a trimmed, de-blanked list.
 *
 * Centralizes the `split(",").map(trim).filter(Boolean)` pattern used across
 * config and auth code. Pass `{ lowercase: true }` for case-insensitive
 * matches such as wallet-address allowlists.
 */
export function parseEnvList(
  value: string | undefined,
  { lowercase = false }: { lowercase?: boolean } = {},
): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
    .filter(Boolean);
}
