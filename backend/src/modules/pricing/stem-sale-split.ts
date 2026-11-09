/**
 * Split of a source stem sale per licence tier (#2599).
 *
 * The platform fee is the configured take-rate (ADR-BM-2); the artist keeps
 * the rest. ADR-BM-4 puts a floor of 85% under the artist's share, so a
 * misconfigured take-rate above 15% fails here instead of being shown.
 *
 * A source stem sale has no remixer share. The source share of ADR-LD-1
 * applies to sales of a derivative and is not part of this split.
 */
import type { X402LicensePricing } from "../x402/x402.config";

export const BPS_DENOMINATOR = 10_000;
/** ADR-BM-4: the artist receives at least 85% of every transaction. */
export const MIN_ARTIST_SHARE_BPS = 8_500;

export const STEM_SALE_TIERS = ["personal", "remix", "commercial"] as const;
export type StemSaleTier = (typeof STEM_SALE_TIERS)[number];

export interface StemSaleTierSplit {
  platformFeeBps: number;
  artistBps: number;
}

export interface StemSaleSplit {
  minArtistBps: number;
  tiers: Record<StemSaleTier, StemSaleTierSplit>;
}

export function buildStemSaleSplit(
  pricing: Pick<X402LicensePricing, StemSaleTier>,
): StemSaleSplit {
  const tiers = {} as Record<StemSaleTier, StemSaleTierSplit>;
  for (const tier of STEM_SALE_TIERS) {
    const platformFeeBps = pricing[tier].feeBps;
    if (
      !Number.isInteger(platformFeeBps) ||
      platformFeeBps < 0 ||
      platformFeeBps > BPS_DENOMINATOR - MIN_ARTIST_SHARE_BPS
    ) {
      throw new Error(
        `The ${tier} take-rate (${platformFeeBps} bps) would leave the artist under ${MIN_ARTIST_SHARE_BPS} bps (ADR-BM-4).`,
      );
    }
    tiers[tier] = { platformFeeBps, artistBps: BPS_DENOMINATOR - platformFeeBps };
  }
  return { minArtistBps: MIN_ARTIST_SHARE_BPS, tiers };
}
