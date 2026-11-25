import { createHash, randomInt } from "crypto";

/**
 * Invitation codes (#2662): twelve characters from an alphabet without the
 * look-alikes 0/O and 1/I/L, shown in groups of four. About 60 bits, and code
 * checks are rate limited, so guessing is not a practical way in.
 *
 * Only the sha256 of the normalized code is stored.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 12;

export function generateInvitationCode(): string {
  let raw = "";
  for (let i = 0; i < LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Upper-case and drop spaces and dashes, so "abcd efgh-jkmn" matches "ABCD-EFGH-JKMN". */
export function normalizeInvitationCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const normalized = code.toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== LENGTH || !/^[A-Z0-9]+$/.test(normalized)) return null;
  return normalized;
}

export function hashInvitationCode(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export function invitationCodeHint(normalized: string): string {
  return normalized.slice(-4);
}
