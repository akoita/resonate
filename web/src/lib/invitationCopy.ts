import type { AuthInviteStatus, InvitationCheck } from "./api";

/**
 * Plain words for invitation-only sign-up (#2662), in one place so the
 * sign-up dialog, the sign-in error line and onboarding say the same thing.
 */
export const INVITE_STATUS_MESSAGES: Record<AuthInviteStatus, string> = {
  invite_required:
    "Sign-up is by invitation during the preview. Enter your invitation code, or join the waiting list.",
  invite_invalid: "That invitation code isn't valid. Check it and try again.",
  invite_expired: "That invitation code has expired. Ask the person who sent it for a new one.",
  invite_used: "That invitation code has already been used.",
  invite_artist_cap_reached:
    "All founding-artist places are taken for now. Join the waiting list and we'll let you know when there is room.",
};

export function isInviteStatus(value: unknown): value is AuthInviteStatus {
  return typeof value === "string" && value in INVITE_STATUS_MESSAGES;
}

/** What the sign-up dialog says about a checked code. */
export function describeInvitationCheck(check: InvitationCheck): string {
  if (check.status === "valid") {
    return check.role === "artist"
      ? "This is a founding-artist invitation. Create your account, then set up your artist profile."
      : "Your invitation is valid. Create your account to start listening.";
  }
  return INVITE_STATUS_MESSAGES[`invite_${check.status}`];
}

const INVITE_PARAM_KEY = "resonate.inviteCode";

/** Keep a code that arrived in a `?invite=` link for the sign-up dialog, for this tab only. */
export function rememberInviteFromUrl(search: string, storage: Pick<Storage, "setItem"> | null) {
  const code = new URLSearchParams(search).get("invite")?.trim();
  if (!code || code.length > 64) return null;
  try {
    storage?.setItem(INVITE_PARAM_KEY, code);
  } catch {
    // Storage can be unavailable (private mode); the code is still returned.
  }
  return code;
}

export function readRememberedInvite(storage: Pick<Storage, "getItem"> | null): string {
  try {
    return storage?.getItem(INVITE_PARAM_KEY) ?? "";
  } catch {
    return "";
  }
}
