/**
 * Sign-in wording, in one place (#2663).
 *
 * Sign-in is a passkey, and the account behind it is created for the person,
 * so screens say "Sign in" and "Create account", never ask to connect a wallet.
 * Wallet terms stay only on screens about the wallet itself. Import from here
 * instead of writing the words again, so they cannot drift.
 */
export const AUTH_COPY = {
  signIn: "Sign in",
  createAccount: "Create account",
  signOut: "Sign out",
  signingIn: "Signing in…",
  gateLabel: "Your account",
  gateDefault: "Sign in to continue.",
  gateNewHere: "New here? Choose Create account at the top of the page.",
  sessionExpired: "Your session expired. Please sign in again.",
  required: "Sign in first",
} as const;

/** "Sign in to view your library." — the gate line for a screen that needs an account. */
export function signInTo(action: string): string {
  return `Sign in to ${action}`;
}
