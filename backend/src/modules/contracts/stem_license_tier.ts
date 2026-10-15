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
