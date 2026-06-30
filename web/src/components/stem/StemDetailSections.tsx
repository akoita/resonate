"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  formatListingCountdown,
  orderArtworkSources,
  shortAddress,
  stemTypeTheme,
} from "../../lib/stemPageTheme";

/**
 * Presentational sections of the stem detail page (#1145). Kept free of data
 * fetching so the hero and license panels are render-testable; the page
 * composes them with live hook/fetch state.
 */

export type StemIdentity = {
  tokenId: string;
  name: string | null;
  stemType: string | null;
  artworkUrl: string | null;
  trackTitle: string | null;
  artistName: string | null;
  releaseId: string | null;
  creatorAddress: string;
  isAiGenerated: boolean;
  remixable: boolean | null;
  listingExpiresAt: string | null;
};

export function StemHero({
  identity,
  fallbackArtworkUrl,
  isPlaying,
  onTogglePreview,
  now,
}: {
  identity: StemIdentity;
  /** Tried when the primary artwork fails (e.g. the release artwork). */
  fallbackArtworkUrl?: string | null;
  /** Preview wiring; omit when no catalog stem id is available. */
  isPlaying?: boolean;
  onTogglePreview?: () => void;
  now?: Date;
}) {
  const theme = stemTypeTheme(identity.stemType);
  const countdown = formatListingCountdown(identity.listingExpiresAt, now);
  const displayName =
    identity.name ?? (identity.stemType
      ? `${identity.stemType.charAt(0).toUpperCase()}${identity.stemType.slice(1)} Stem`
      : `Stem #${identity.tokenId}`);

  // Artwork source chain: real art first (the generic default cover is
  // demoted behind the release artwork), then the themed placeholder. A
  // broken image must never render as alt text in the hero.
  const artworkSources = useMemo(
    () =>
      orderArtworkSources({
        tokenImageUrl: identity.artworkUrl,
        releaseArtworkUrl: fallbackArtworkUrl,
      }),
    [identity.artworkUrl, fallbackArtworkUrl],
  );
  const [failedCount, setFailedCount] = useState(0);
  const artworkSrc = artworkSources[failedCount] ?? null;

  return (
    <div className="relative overflow-hidden stem-hero">
      {/* Ambient backdrop: the artwork's own colors, blurred behind a fade;
          degrades to the type accent when no artwork resolves. */}
      <div className="absolute inset-0" aria-hidden>
        {artworkSrc && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={artworkSrc}
            alt=""
            className="w-full h-full object-cover blur-3xl scale-110 opacity-25"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 70% 90% at 28% 0%, rgba(${theme.accentRgb}, 0.22) 0%, transparent 55%), linear-gradient(180deg, rgba(${theme.accentRgb}, 0.10) 0%, rgba(0,0,0,0.85) 60%, #000 100%)`,
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 pt-8 pb-14">
        <Link
          href="/marketplace"
          className="text-sm text-zinc-400 hover:text-white inline-flex items-center gap-1"
        >
          ← Back to Marketplace
        </Link>

        <div className="flex items-center gap-10 mt-8 flex-wrap">
          {/* Artwork with type-colored ring + preview overlay */}
          <div
            className="relative w-60 h-60 rounded-2xl overflow-hidden shrink-0 bg-zinc-900 group"
            style={{
              boxShadow: `0 0 0 2px rgba(${theme.accentRgb}, 0.55), 0 18px 80px rgba(${theme.accentRgb}, 0.28)`,
            }}
          >
            {artworkSrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={artworkSrc}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={() => setFailedCount((n) => n + 1)}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-7xl"
                style={{
                  background: `radial-gradient(circle at 50% 42%, rgba(${theme.accentRgb}, 0.28) 0%, rgba(24,24,27,1) 72%)`,
                }}
              >
                {theme.emoji}
              </div>
            )}
            {onTogglePreview && (
              <button
                type="button"
                onClick={onTogglePreview}
                aria-label={isPlaying ? "Pause preview" : "Play preview"}
                className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors stem-hero__preview"
              >
                <span
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-xl text-white transition-opacity ${
                    isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  style={{ background: `rgba(${theme.accentRgb}, 0.9)` }}
                >
                  {isPlaying ? "⏸" : "▶"}
                </span>
              </button>
            )}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-[16rem]">
            <div className="rs-kicker mb-3">
              Stem · Token #{identity.tokenId}
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {identity.isAiGenerated && (
                <span className="stem-type-badge stem-type-badge--ai">🤖 AI</span>
              )}
              {identity.stemType && (
                <span className={`stem-type-badge ${theme.badgeClass}`}>
                  {identity.stemType}
                </span>
              )}
              {identity.remixable === true && (
                <span
                  className="stem-type-badge"
                  style={{ background: "rgba(168, 85, 247, 0.25)", color: "#d8b4fe" }}
                >
                  Remixable
                </span>
              )}
              <span className="stem-type-badge" style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7" }}>
                ✓ NFT
              </span>
            </div>

            <h1 className="rs-display stem-hero__title">{displayName}</h1>

            {(identity.trackTitle || identity.artistName) && (
              <p className="text-zinc-300 mt-3 text-lg stem-hero__attribution">
                {identity.trackTitle && (
                  <>
                    from{" "}
                    {identity.releaseId ? (
                      <Link
                        href={`/release/${identity.releaseId}`}
                        className="text-white hover:underline underline-offset-4"
                        style={{ textDecorationColor: `rgb(${theme.accentRgb})` }}
                      >
                        {identity.trackTitle}
                      </Link>
                    ) : (
                      <span className="text-white">{identity.trackTitle}</span>
                    )}
                  </>
                )}
                {identity.artistName && (
                  <span className="text-zinc-400"> · {identity.artistName}</span>
                )}
              </p>
            )}

            <div className="flex items-center gap-3 mt-5 flex-wrap text-sm">
              <span className="px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-700 text-zinc-400">
                by <span className="font-mono text-zinc-300">{shortAddress(identity.creatorAddress)}</span>
              </span>
              {countdown && (
                <span
                  className="px-3 py-1 rounded-full font-medium stem-hero__countdown"
                  style={{
                    background: `rgba(${theme.accentRgb}, 0.16)`,
                    color: `rgb(${theme.accentRgb})`,
                    border: `1px solid rgba(${theme.accentRgb}, 0.35)`,
                  }}
                >
                  ⏱ {countdown}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type TierAvailability = {
  tier: "personal" | "remix" | "commercial";
  label: string;
  description: string;
  /** Catalog seller-default price (shown only while a tier is unlisted). */
  priceUsd: number | null;
  listed: boolean;
  /** Live listing price, e.g. "0.01 USDC" — what a buyer actually pays. */
  listedPriceLabel: string | null;
};

export function buildTierRows(input: {
  listedTiers: Partial<Record<"personal" | "remix" | "commercial", boolean>>;
  pricing: {
    basePlayPriceUsd?: number | null;
    remixLicenseUsd?: number | null;
    commercialLicenseUsd?: number | null;
  } | null;
  /** Formatted active-listing prices per tier, when known. */
  listedPriceLabels?: Partial<Record<"personal" | "remix" | "commercial", string>>;
}): TierAvailability[] {
  return [
    {
      tier: "personal" as const,
      label: "Personal",
      description: "Stream & collect — personal listening",
      priceUsd: input.pricing?.basePlayPriceUsd ?? null,
    },
    {
      tier: "remix" as const,
      label: "Remix",
      description: "Derivative works · unlocks Remix Studio",
      priceUsd: input.pricing?.remixLicenseUsd ?? null,
    },
    {
      tier: "commercial" as const,
      label: "Commercial",
      description: "Ads, films, products, monetized content",
      priceUsd: input.pricing?.commercialLicenseUsd ?? null,
    },
  ].map((row) => ({
    ...row,
    listed: !!input.listedTiers[row.tier],
    listedPriceLabel: input.listedPriceLabels?.[row.tier] ?? null,
  }));
}

export function LicenseTiersPanel({
  rows,
  stemType,
  onBuyTier,
}: {
  rows: TierAvailability[];
  stemType?: string | null;
  /** When provided, listed tiers render a Buy button. Omit for sellers viewing
   *  their own listing (they manage instead of buying). */
  onBuyTier?: (tier: "personal" | "remix" | "commercial") => void;
}) {
  const theme = stemTypeTheme(stemType);
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 license-tiers-panel">
      <h2 className="text-lg font-semibold text-white mb-1">License tiers</h2>
      <p className="text-xs text-zinc-500 mb-4">
        What rights can be bought for this stem right now.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.tier}
            className={`flex items-center justify-between gap-3 border rounded-md px-4 py-3 license-tiers-panel__row license-tiers-panel__row--${row.tier} ${
              row.listed ? "border-zinc-700" : "border-zinc-800 opacity-60"
            }`}
          >
            <div>
              <div className="text-sm text-zinc-200 flex items-center gap-2">
                {row.label}
                {row.tier === "remix" && (
                  <span style={{ color: `rgb(${theme.accentRgb})` }} aria-hidden>
                    ✦
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">{row.description}</div>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
              {/* A listed tier shows what a buyer actually pays (the live
                  listing price); the catalog default is only meaningful
                  while the tier is unlisted. */}
              {row.listed && row.listedPriceLabel ? (
                <div className="text-sm text-white font-medium">{row.listedPriceLabel}</div>
              ) : row.priceUsd != null ? (
                <div className="text-sm text-zinc-200">
                  ${row.priceUsd.toFixed(2)}
                  {!row.listed && (
                    <span className="text-zinc-500"> default</span>
                  )}
                </div>
              ) : null}
              <div className={`text-xs ${row.listed ? "text-emerald-400" : "text-zinc-500"}`}>
                {row.listed ? "Listed" : "Not listed"}
              </div>
              {row.listed && onBuyTier && (
                <button
                  type="button"
                  onClick={() => onBuyTier(row.tier)}
                  className="mt-0.5 px-3 py-1 rounded-md text-xs font-semibold text-white transition-transform hover:scale-[1.03] license-tiers-panel__buy"
                  style={{ background: `rgb(${theme.accentRgb})` }}
                  aria-label={`Buy ${row.label} license`}
                >
                  Buy {row.label.toLowerCase()}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
