import {
  CRATE_LICENSE_TYPES,
  type CrateCandidateFacts,
  type CrateLicenseType,
} from "./crate.types";
import { offersLicense } from "./crate_selection";

/**
 * Per-license rights shown on a crate line (#1963, docs/rfc/taste-engine.md
 * §5.3).
 *
 * Pure. The wording is the canonical user-facing tier wording of the buy flow
 * (web `LicenseTypeSelector`): personal ⊂ remix ⊂ commercial. `sync`, `sample`
 * and `broadcast` have no canonical terms anywhere, so no wording is invented
 * for them: they are reported with `standardTerms: false` and no grants, and
 * the client says "terms set by the artist".
 */

/** Tiers whose rights are the platform's standard terms. */
export const CRATE_STANDARD_LICENSE_TYPES = ["personal", "remix", "commercial"] as const;
export type CrateStandardLicenseType = (typeof CRATE_STANDARD_LICENSE_TYPES)[number];

/** What each standard tier grants, in the buy flow's wording. */
export const CRATE_LICENSE_RIGHTS: Readonly<Record<CrateStandardLicenseType, readonly string[]>> =
  Object.freeze({
    personal: Object.freeze(["Stream & collect — personal listening"]),
    remix: Object.freeze([
      "Use in derivative works, publish remixes",
      "Includes personal rights",
    ]),
    commercial: Object.freeze([
      "Ads, films, products, monetized content",
      "Includes remix and personal rights",
    ]),
  });

export type CrateLicenseOptionDto = {
  licenseType: CrateLicenseType;
  /** True when the track has an active, unexpired listing for the tier. */
  listed: boolean;
  /** The artist's indicative USD price for the tier, or null when unpriced. */
  indicativePriceUsd: number | null;
  /** True when `grants` are the platform's standard terms for the tier. */
  standardTerms: boolean;
  grants: string[];
};

function isStandardTier(tier: CrateLicenseType): tier is CrateStandardLicenseType {
  return (CRATE_STANDARD_LICENSE_TYPES as readonly string[]).includes(tier);
}

/** The rights of one tier: what a quote line shows next to its stems (#1964). */
export type CrateTierRightsDto = {
  licenseType: CrateLicenseType;
  /** True when `grants` are the platform's standard terms for the tier. */
  standardTerms: boolean;
  grants: string[];
};

/** The tier's rights in the buy flow's wording; non-standard tiers have no grants. */
export function crateTierRights(tier: CrateLicenseType): CrateTierRightsDto {
  return {
    licenseType: tier,
    standardTerms: isStandardTier(tier),
    grants: isStandardTier(tier) ? [...CRATE_LICENSE_RIGHTS[tier]] : [],
  };
}

/**
 * One option per tier the track lists or prices (the same rule as the crate's
 * license filter), in {@link CRATE_LICENSE_TYPES} order.
 */
export function crateLicenseOptions(facts: CrateCandidateFacts): CrateLicenseOptionDto[] {
  const options: CrateLicenseOptionDto[] = [];
  for (const tier of CRATE_LICENSE_TYPES) {
    if (!offersLicense(facts, tier)) continue;
    options.push({
      licenseType: tier,
      listed: facts.listedLicenseTypes.some((type) => type.toLowerCase() === tier),
      indicativePriceUsd: facts.indicativePriceUsd[tier] ?? null,
      standardTerms: isStandardTier(tier),
      grants: isStandardTier(tier) ? [...CRATE_LICENSE_RIGHTS[tier]] : [],
    });
  }
  return options;
}
