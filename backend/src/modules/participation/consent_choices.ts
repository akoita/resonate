import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * The artist consent choices (#2666). They live on the Artist row, next to
 * the existing `remixConsent`, so there is one source of truth; every change
 * is also written to `ArtistConsentChange` with who made it and from where.
 */
export const CONSENT_CHOICE_VALUES = {
  remixConsent: ["allowed", "disabled"],
  aiRemixApproval: ["required", "not_required"],
  aiSourceUse: ["allowed", "disabled"],
  stemListing: ["allowed", "disabled"],
} as const;

export type ConsentSetting = keyof typeof CONSENT_CHOICE_VALUES;
export const CONSENT_SETTINGS = Object.keys(CONSENT_CHOICE_VALUES) as ConsentSetting[];

export type ConsentChoices = {
  remixConsent: "allowed" | "disabled";
  aiRemixApproval: "required" | "not_required";
  aiSourceUse: "allowed" | "disabled";
  stemListing: "allowed" | "disabled";
};

/**
 * The choices the onboarding step offers before the artist changes anything:
 * remixing on, AI-assisted remixes of their work need their approval, no AI
 * use of their work, and stems not offered for sale until they decide to.
 */
export const SAFE_DEFAULT_CHOICES: ConsentChoices = {
  remixConsent: "allowed",
  aiRemixApproval: "required",
  aiSourceUse: "disabled",
  stemListing: "disabled",
};

export type ConsentChangeSource = "onboarding" | "settings";

/** Read and validate a partial set of choices from a request body. */
export function parseConsentChoices(input: unknown, { requireAll }: { requireAll: boolean }): Partial<ConsentChoices> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Partial<ConsentChoices> = {};
  for (const setting of CONSENT_SETTINGS) {
    const raw = body[setting];
    if (raw === undefined) {
      if (requireAll) throw new BadRequestException(`${setting} is required`);
      continue;
    }
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
    const allowed = CONSENT_CHOICE_VALUES[setting] as readonly string[];
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new BadRequestException(`${setting} must be ${allowed.join(" or ")}`);
    }
    (out as Record<string, string>)[setting] = value;
  }
  return out;
}

export function currentChoices(artist: {
  remixConsent: string;
  aiRemixApproval: string;
  aiSourceUse: string;
  stemListing: string;
}): ConsentChoices {
  return {
    remixConsent: artist.remixConsent === "disabled" ? "disabled" : "allowed",
    aiRemixApproval: artist.aiRemixApproval === "required" ? "required" : "not_required",
    aiSourceUse: artist.aiSourceUse === "disabled" ? "disabled" : "allowed",
    stemListing: artist.stemListing === "disabled" ? "disabled" : "allowed",
  };
}

/**
 * Write the changed choices to the artist and one history row per change, in
 * the caller's transaction. With `recordUnchanged` (accepting the agreement),
 * every given choice gets a row, so the record shows exactly what the artist
 * confirmed alongside that version. Returns the rows written.
 */
export async function applyConsentChoices(
  tx: Prisma.TransactionClient,
  artist: { id: string; remixConsent: string; aiRemixApproval: string; aiSourceUse: string; stemListing: string },
  userId: string,
  choices: Partial<ConsentChoices>,
  source: ConsentChangeSource,
  { now = new Date(), recordUnchanged = false }: { now?: Date; recordUnchanged?: boolean } = {},
): Promise<Array<{ setting: ConsentSetting; previous: string; next: string }>> {
  const before = currentChoices(artist);
  const changes = CONSENT_SETTINGS.filter(
    (setting) => choices[setting] !== undefined && (recordUnchanged || choices[setting] !== before[setting]),
  ).map((setting) => ({ setting, previous: before[setting], next: choices[setting] as string }));
  if (changes.length === 0) return [];
  const updates = changes.filter((c) => c.previous !== c.next);
  if (updates.length > 0) {
    await tx.artist.update({
      where: { id: artist.id },
      data: Object.fromEntries(updates.map((c) => [c.setting, c.next])),
    });
  }
  await tx.artistConsentChange.createMany({
    data: changes.map((c) => ({
      artistId: artist.id,
      userId,
      setting: c.setting,
      previousValue: c.previous,
      value: c.next,
      source,
      changedAt: now,
    })),
  });
  return changes;
}
