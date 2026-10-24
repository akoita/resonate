/**
 * True when the passkey prompt ended because the person dismissed it (or let
 * it time out), rather than because something failed. WebAuthn reports both as
 * `NotAllowedError`, and in both cases nothing was signed and nothing was
 * requested, so both are ordinary outcomes rather than errors.
 */
export function isPasskeyDismissal(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${name} ${message}`.toLowerCase();
  return (
    name === "AbortError" ||
    normalized.includes("notallowederror") ||
    normalized.includes("timed out or was not allowed")
  );
}
