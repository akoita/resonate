/**
 * Standard stem license tiers and their order (docs/rfc/business-model.md).
 *
 * `personal` < `remix` < `commercial`: each tier includes the rights of the one
 * below it. `sync`, `sample` and `broadcast` have no standard terms, so they
 * never count as a standard tier.
 *
 * Shared by the collection endpoint (Library › Stems shows the best tier a
 * holder owns, #2042) and crate export (#1965), so both rank tiers the same way.
 */
export const STANDARD_LICENSE_TIERS = ["personal", "remix", "commercial"] as const;
export type StandardLicenseTier = (typeof STANDARD_LICENSE_TIERS)[number];

/** The highest standard tier among `licenseTypes`, or null when none is standard. */
export function bestStandardLicenseTier(
  licenseTypes: Iterable<string>,
): StandardLicenseTier | null {
  const owned = new Set<string>(licenseTypes);
  for (const tier of [...STANDARD_LICENSE_TIERS].reverse()) {
    if (owned.has(tier)) return tier;
  }
  return null;
}

/**
 * What each standard tier lets the buyer do, in plain words (#1976, ADR-TE-7:
 * a stem purchase sells a license; the audio file is how it is delivered). Shown
 * on the listing, the quote and the receipt next to the license name. These are
 * summaries of the license templates the buyer sees in full; they add no right.
 */
export const STEM_LICENSE_PLAIN_TERMS: Readonly<Record<StandardLicenseTier, string>> = {
  personal:
    "For your own listening and private use. You may not publish, share or monetize anything made with the stem.",
  remix:
    "Use the stem in a remix, mashup or new composition and publish it. Credit the original artist; the original is not re-released unmodified, and an ongoing royalty goes to the artist.",
  commercial:
    "Use the stem in monetized content such as ads, films, podcasts, live shows and branded content, with credit as agreed.",
};

/** The plain-words terms of a license key, or null for a tier with no standard terms. */
export function plainLicenseTerms(licenseType: string | null | undefined): string | null {
  const key = String(licenseType ?? "").trim().toLowerCase();
  return (STANDARD_LICENSE_TIERS as readonly string[]).includes(key)
    ? STEM_LICENSE_PLAIN_TERMS[key as StandardLicenseTier]
    : null;
}
