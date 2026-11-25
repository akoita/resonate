/**
 * Invitation-only registration settings (#2662).
 *
 * `REGISTRATION_MODE=invite` makes a new account need a valid invitation code.
 * Any other value, or none, keeps registration open (`open`), which is today's
 * behaviour. Signing in to an existing account is the same in both modes.
 *
 * `FOUNDING_ARTIST_CAP` caps the number of artist invitations that can be
 * redeemed. Unset, blank, zero or not a whole number means no cap.
 *
 * `FOUNDING_ARTIST_LISTENER_INVITES` is how many listener codes each founding
 * artist can create to hand out. Default 3; 0 turns the allowance off.
 */
export type RegistrationMode = "open" | "invite";

export function resolveRegistrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  return env.REGISTRATION_MODE?.trim().toLowerCase() === "invite" ? "invite" : "open";
}

function positiveInt(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{1,9}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

export function resolveFoundingArtistCap(env: NodeJS.ProcessEnv = process.env): number | null {
  return positiveInt(env.FOUNDING_ARTIST_CAP);
}

export const DEFAULT_ARTIST_LISTENER_INVITES = 3;

export function resolveArtistListenerInvites(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FOUNDING_ARTIST_LISTENER_INVITES?.trim();
  if (raw === undefined || raw === "") return DEFAULT_ARTIST_LISTENER_INVITES;
  if (raw === "0") return 0;
  return positiveInt(raw) ?? DEFAULT_ARTIST_LISTENER_INVITES;
}

/** The version of the waiting-list consent wording. Bump it when the wording in the web app changes. */
export const WAITLIST_CONSENT_VERSION = "waitlist-2026-11";
