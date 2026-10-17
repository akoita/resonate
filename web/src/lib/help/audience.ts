import type { HelpAudience, HelpIndexEntry } from "./types";
import type { AudienceMeta } from "./taxonomy";

/**
 * Operator and admin material in the guide is shown only to signed-in
 * operators and admins. Everyone else sees a guide about what they can do.
 * This is presentation, not access control: admin routes are protected by
 * the server whether or not their guide is visible.
 */
export function canSeeOperatorHelp(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** An article written only for operators and admins. */
export function isOperatorOnly(audiences: readonly HelpAudience[]): boolean {
  return audiences.length > 0 && audiences.every((a) => a === "operator");
}

/** Drop items tagged `audience: "operator"` for readers who are not operators. */
export function forReader<T extends { audience?: "operator" }>(items: readonly T[], operator: boolean): T[] {
  return operator ? [...items] : items.filter((item) => item.audience !== "operator");
}

/** The guide entries a reader can browse and search. */
export function entriesForReader(entries: readonly HelpIndexEntry[], operator: boolean): HelpIndexEntry[] {
  return operator ? [...entries] : entries.filter((e) => !isOperatorOnly(e.audiences));
}

/** The audience chips and filters a reader sees. */
export function audiencesForReader<T extends HelpAudience | AudienceMeta>(audiences: readonly T[], operator: boolean): T[] {
  if (operator) return [...audiences];
  return audiences.filter((a) => (typeof a === "string" ? a : a.id) !== "operator");
}
