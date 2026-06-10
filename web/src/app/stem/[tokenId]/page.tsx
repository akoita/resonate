"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    useStemData,
    useTokenURI,
    useParentStems,
    useStemBalance,
    useTotalStems,
    useContractAddresses,
} from "../../../hooks/useContracts";
import { formatRoyaltyBps, isZeroAddress } from "../../../lib/contracts";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ListStemModal } from "../../../components/marketplace/ListStemModal";
import { BuyModal } from "../../../components/marketplace/BuyModal";
import type { LicenseType } from "../../../components/marketplace/LicenseTypeSelector";
import { RemixCta } from "../../../components/remix/RemixCta";
import ContentProtectionBadge from "../../../components/content-protection/ContentProtectionBadge";
import { API_BASE, getReleaseArtworkUrl } from "../../../lib/api";
import { usePaymentAssets } from "../../../hooks/usePaymentAssets";
import { findPaymentAssetForToken, ZERO_PAYMENT_TOKEN } from "../../../lib/payments";
import { formatListingPrice } from "../../../lib/listingPricing";
import { shortAddress, stemTypeTheme } from "../../../lib/stemPageTheme";
import {
    buildTierRows,
    LicenseTiersPanel,
    StemHero,
} from "../../../components/stem/StemDetailSections";
import { type Address } from "viem";

// Chain-aware block explorer URLs
function getExplorerUrl(chainId: number, address: string): string | null {
    switch (chainId) {
        case 1:
            return `https://etherscan.io/address/${address}`;
        case 11155111:
            return `https://sepolia.etherscan.io/address/${address}`;
        case 84532:
            return `https://sepolia.basescan.org/address/${address}`;
        case 8453:
            return `https://basescan.org/address/${address}`;
        default:
            return null; // Local/Anvil — no explorer
    }
}

type CatalogMeta = {
    name?: string;
    image?: string;
    attributes?: Array<{ trait_type: string; value: unknown }>;
    properties?: {
        stem_id?: string;
        track_id?: string;
        release_id?: string;
        remixable?: boolean;
        generation?: unknown;
    };
};

type StemListingRow = {
    listingId: string;
    tokenId: string;
    chainId: number;
    seller: string;
    price: string;
    paymentToken: string;
    licenseType?: LicenseType;
    amount: string;
    expiresAt: string;
    tierListings?: Partial<Record<LicenseType, string>> | null;
    stem?: {
        id: string;
        title?: string;
        type?: string;
        track?: string;
        artist?: string;
        trackId?: string;
        releaseId?: string;
        artistId?: string;
        isAiGenerated?: boolean;
    } | null;
};

type TierPricing = {
    basePlayPriceUsd?: number | null;
    remixLicenseUsd?: number | null;
    commercialLicenseUsd?: number | null;
};

export default function StemDetailPage() {
    const params = useParams();
    const tokenIdStr = params.tokenId as string;
    const tokenId = tokenIdStr ? BigInt(tokenIdStr) : undefined;

    const { address, smartAccountAddress } = useAuth();
    const { chainId } = useContractAddresses();
    const { data: stemData, loading: stemLoading, error: stemError } = useStemData(tokenId);
    const { uri, loading: uriLoading } = useTokenURI(tokenId);
    const { parentIds, isRemix, loading: lineageLoading } = useParentStems(tokenId);
    // Editions can be held by either identity depending on the wallet path
    // (EOA-style kernel vs separate smart account); owner actions consider
    // both so neither setup loses "List for Sale".
    const { balance: addressBalance } = useStemBalance(
        tokenId,
        address as Address | undefined,
    );
    const { balance: smartAccountBalance } = useStemBalance(
        tokenId,
        smartAccountAddress as Address | undefined,
    );
    const balance =
        addressBalance > smartAccountBalance ? addressBalance : smartAccountBalance;
    const { total: totalStems } = useTotalStems();

    const [showListModal, setShowListModal] = useState(false);
    const [meta, setMeta] = useState<CatalogMeta | null>(null);
    const [metaState, setMetaState] = useState<"loading" | "ok" | "failed">("loading");
    const [listings, setListings] = useState<StemListingRow[]>([]);
    const [pricing, setPricing] = useState<TierPricing | null>(null);
    const [buyListing, setBuyListing] = useState<StemListingRow | null>(null);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    // Bumped after a purchase: refetches listings and remounts the Remix CTA
    // so the page reflects the new license without a reload.
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [linkCopied, setLinkCopied] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Catalog metadata: identity (name, artwork, attributes) + catalog ids.
    useEffect(() => {
        if (!tokenId || !chainId) return;
        let cancelled = false;
        // Relative path: the Next rewrite maps /api/metadata/* to the
        // backend's prefix-free /metadata/* in every environment. Calling
        // `${API_BASE}/api/metadata/...` 404s against the real backend.
        fetch(`/api/metadata/${chainId}/${tokenId.toString()}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data) => {
                if (cancelled) return;
                setMeta(data);
                setMetaState("ok");
            })
            .catch(() => {
                if (!cancelled) setMetaState("failed");
            });
        return () => {
            cancelled = true;
        };
    }, [tokenId, chainId]);

    const catalogStemId = meta?.properties?.stem_id ?? null;
    const catalogTrackId = meta?.properties?.track_id ?? null;
    const releaseIdFromMeta = meta?.properties?.release_id ?? null;

    // Active listings + tier pricing for the commerce rail. refreshNonce
    // re-runs this after a purchase on this page.
    useEffect(() => {
        if (!catalogStemId) return;
        void refreshNonce;
        let cancelled = false;
        fetch(`/api/metadata/listings?stemId=${encodeURIComponent(catalogStemId)}&limit=20`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data?.listings) return;
                setListings(
                    (data.listings as StemListingRow[]).filter(
                        (l) => l.tokenId === tokenId?.toString(),
                    ),
                );
            })
            .catch(() => { /* commerce rail degrades to no listings */ });
        fetch(`${API_BASE}/api/stem-pricing/${encodeURIComponent(catalogStemId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!cancelled && data) {
                    setPricing({
                        basePlayPriceUsd: data.basePlayPriceUsd ?? null,
                        remixLicenseUsd: data.remixLicenseUsd ?? null,
                        commercialLicenseUsd: data.commercialLicenseUsd ?? null,
                    });
                }
            })
            .catch(() => { /* tier prices stay unknown */ });
        return () => {
            cancelled = true;
        };
    }, [catalogStemId, tokenId, refreshNonce]);

    const attr = useCallback(
        (name: string): string | null => {
            const found = meta?.attributes?.find((a) => a.trait_type === name);
            return found != null ? String(found.value) : null;
        },
        [meta],
    );

    const primaryListing = listings[0] ?? null;
    const listedTiers = useMemo(() => {
        const tiers: Partial<Record<LicenseType, boolean>> = {};
        for (const listing of listings) {
            if (listing.licenseType) tiers[listing.licenseType] = true;
            for (const tier of Object.keys(listing.tierListings ?? {}) as LicenseType[]) {
                if (listing.tierListings?.[tier]) tiers[tier] = true;
            }
        }
        return tiers;
    }, [listings]);
    const tierListingIds = useMemo(() => {
        const ids: Partial<Record<LicenseType, string>> = {};
        for (const listing of listings) {
            if (listing.licenseType && !ids[listing.licenseType]) {
                ids[listing.licenseType] = listing.listingId;
            }
            for (const [tier, id] of Object.entries(listing.tierListings ?? {})) {
                if (id && !ids[tier as LicenseType]) ids[tier as LicenseType] = id;
            }
        }
        return ids;
    }, [listings]);

    const signer = (smartAccountAddress || address)?.toLowerCase();
    const isOwnListing = !!primaryListing && !!signer && primaryListing.seller.toLowerCase() === signer;

    const { assets: paymentAssets } = usePaymentAssets(chainId);
    const listingPriceLabel = useCallback((listing: StemListingRow): string | null => {
        const token = listing.paymentToken?.toLowerCase();
        const asset = !token || token === ZERO_PAYMENT_TOKEN
            ? null
            : findPaymentAssetForToken(paymentAssets, listing.chainId, listing.paymentToken);
        try {
            return formatListingPrice({ priceUnits: BigInt(listing.price), asset });
        } catch {
            return null; // malformed indexer price: callers degrade to no label
        }
    }, [paymentAssets]);
    const primaryListingPriceLabel = useMemo(
        () => (primaryListing ? listingPriceLabel(primaryListing) : null),
        [listingPriceLabel, primaryListing],
    );
    // Live per-tier prices for the tiers panel: a listed tier must show what
    // a buyer actually pays, not the catalog's seller-default USD price.
    const tierPriceLabels = useMemo(() => {
        const labels: Partial<Record<LicenseType, string>> = {};
        for (const listing of listings) {
            const tier = listing.licenseType ?? "personal";
            if (labels[tier]) continue;
            const label = listingPriceLabel(listing);
            if (label) labels[tier] = label;
        }
        return labels;
    }, [listingPriceLabel, listings]);

    // Remix-license path for the CTA: open the buy modal in place when a
    // remix-tier listing exists; otherwise the CTA explains instead of
    // dead-ending into the marketplace.
    const remixListingRow = useMemo(
        () => listings.find((l) => (l.licenseType ?? "personal") === "remix") ?? null,
        [listings],
    );
    const remixTierBuyable = !!remixListingRow || !!tierListingIds.remix;
    const openRemixLicensePurchase = useCallback(() => {
        const target = remixListingRow ?? primaryListing;
        if (target) setBuyListing(target);
    }, [primaryListing, remixListingRow]);

    const stemType = attr("Type") ?? primaryListing?.stem?.type ?? null;
    const theme = stemTypeTheme(stemType);
    const displayTitle = meta?.name ?? primaryListing?.stem?.title ?? null;

    const togglePreview = useCallback(() => {
        if (!catalogStemId) return;
        const audio = audioRef.current;
        if (!audio) return;
        if (previewPlaying) {
            audio.pause();
            setPreviewPlaying(false);
            return;
        }
        audio.src = `${API_BASE}/catalog/stems/${catalogStemId}/preview`;
        audio
            .play()
            .then(() => setPreviewPlaying(true))
            .catch(() => setPreviewPlaying(false));
    }, [catalogStemId, previewPlaying]);

    const copyLink = useCallback(() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard
                .writeText(window.location.href)
                .then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                })
                .catch(() => { /* clipboard unavailable */ });
        }
    }, []);

    // Loading state
    if (!tokenId || stemLoading || uriLoading || lineageLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="animate-pulse space-y-4 text-center" aria-busy="true">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto" />
                    <div className="h-4 bg-zinc-800 rounded w-32 mx-auto" />
                </div>
            </div>
        );
    }

    // Error state
    if (stemError || !stemData?.exists) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-white mb-2">Stem Not Found</h1>
                    <p className="text-zinc-400 mb-4">
                        Token #{tokenId.toString()} does not exist or has not been minted.
                    </p>
                    <Link
                        href="/marketplace"
                        className="text-emerald-500 hover:text-emerald-400"
                    >
                        Browse Marketplace →
                    </Link>
                </div>
            </div>
        );
    }

    const canList = balance > 0n;
    const creatorExplorerUrl = getExplorerUrl(chainId, stemData.creator);

    return (
        <div className="min-h-screen bg-black">
            <StemHero
                identity={{
                    tokenId: tokenId.toString(),
                    name: displayTitle,
                    stemType,
                    artworkUrl: meta?.image ?? null,
                    trackTitle: attr("Track") ?? primaryListing?.stem?.track ?? null,
                    artistName: attr("Artist") ?? primaryListing?.stem?.artist ?? null,
                    releaseId: releaseIdFromMeta ?? primaryListing?.stem?.releaseId ?? null,
                    creatorAddress: stemData.creator,
                    isAiGenerated:
                        !!meta?.properties?.generation || !!primaryListing?.stem?.isAiGenerated,
                    remixable: stemData.remixable ?? null,
                    listingExpiresAt: primaryListing?.expiresAt ?? null,
                }}
                fallbackArtworkUrl={
                    releaseIdFromMeta ? getReleaseArtworkUrl(releaseIdFromMeta) : null
                }
                isPlaying={previewPlaying}
                onTogglePreview={catalogStemId ? togglePreview : undefined}
            />

            <div className="max-w-6xl mx-auto px-4 pb-16">
                {metaState === "failed" && (
                    <div className="mb-6 px-4 py-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm stem-meta-fallback">
                        Catalog details are unavailable right now — showing on-chain data only.
                        Purchasing and remixing need the catalog connection; try reloading.
                    </div>
                )}

                {/* Action rail: the page's purpose, lifted onto the hero edge. */}
                <div className="relative z-10 -mt-7 mb-10 rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur px-4 py-3 flex items-center gap-3 flex-wrap justify-between stem-action-rail">
                    <div className="flex items-center gap-3 flex-wrap">
                        {primaryListing && !isOwnListing && (
                            <button
                                type="button"
                                onClick={() => setBuyListing(primaryListing)}
                                className="px-7 py-3 rounded-lg font-semibold text-white text-base transition-transform hover:scale-[1.02] shadow-lg"
                                style={{
                                    background: `rgb(${theme.accentRgb})`,
                                    boxShadow: `0 8px 28px rgba(${theme.accentRgb}, 0.35)`,
                                }}
                            >
                                Buy · {primaryListing.licenseType ?? "personal"} license
                                {primaryListingPriceLabel ? ` · ${primaryListingPriceLabel}` : ""}
                            </button>
                        )}
                        {primaryListing && isOwnListing && (
                            <Link
                                href="/marketplace/manage"
                                className="px-7 py-3 rounded-lg font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                            >
                                Your Listing · Manage
                            </Link>
                        )}
                        {catalogTrackId && catalogStemId && (
                            <RemixCta
                                key={`remix-${refreshNonce}`}
                                variant="button"
                                trackId={catalogTrackId}
                                stemIds={[catalogStemId]}
                                trackTitle={displayTitle ?? undefined}
                                onGetLicense={remixTierBuyable ? openRemixLicensePurchase : undefined}
                                licenseUnavailableReason={
                                    remixTierBuyable
                                        ? undefined
                                        : "The seller hasn't listed a remix license for this stem yet."
                                }
                                // The primary buy button already sells the remix
                                // tier here; a second "Get remix license" entry
                                // would duplicate it.
                                hideWhenLicenseRequired={
                                    !!primaryListing &&
                                    !isOwnListing &&
                                    (primaryListing.licenseType ?? "personal") === "remix"
                                }
                            />
                        )}
                        {canList && (
                            <button
                                type="button"
                                onClick={() => setShowListModal(true)}
                                className="px-7 py-3 rounded-lg font-medium bg-emerald-600/90 hover:bg-emerald-600 text-white transition-colors"
                            >
                                List for Sale
                            </button>
                        )}
                        {!primaryListing && metaState !== "loading" && (
                            <span className="px-4 py-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
                                Not listed right now — tier prices below are seller defaults
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {canList && (
                            <span className="text-xs text-zinc-500">
                                You own {balance.toString()} edition{balance > 1n ? "s" : ""}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={copyLink}
                            title="Copy link to this stem"
                            className="px-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white transition-colors text-sm"
                        >
                            {linkCopied ? "✓ Copied" : "⧉ Copy link"}
                        </button>
                    </div>
                </div>

                {/* Details: commerce-first main column + provenance side rail.
                    items-start keeps the rail cards at natural height instead
                    of stretching to the tallest row. */}
                <div className="rs-kicker mb-4">Rights & provenance</div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 space-y-6">
                        {/* License tiers */}
                        <LicenseTiersPanel
                            rows={buildTierRows({ listedTiers, pricing, listedPriceLabels: tierPriceLabels })}
                            stemType={stemType}
                        />

                        {/* On-Chain Metadata */}
                        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">On-Chain Metadata</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Token ID</span>
                                <span className="text-white font-mono">{tokenId.toString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Creator</span>
                                {creatorExplorerUrl ? (
                                    <a
                                        href={creatorExplorerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-500 hover:text-emerald-400 font-mono text-sm"
                                    >
                                        {shortAddress(stemData.creator)}
                                    </a>
                                ) : (
                                    <span className="text-zinc-300 font-mono text-sm">
                                        {shortAddress(stemData.creator)}
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Royalty</span>
                                <span className="text-white">{formatRoyaltyBps(stemData.royaltyBps)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Royalty Receiver</span>
                                <span className="text-white font-mono text-sm">
                                    {isZeroAddress(stemData.royaltyReceiver)
                                        ? "Creator"
                                        : shortAddress(stemData.royaltyReceiver)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Remixable</span>
                                <span className={stemData.remixable ? "text-emerald-400" : "text-zinc-500"}>
                                    {stemData.remixable ? "Yes" : "No"}
                                </span>
                            </div>
                            {uri && (
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Metadata URI</span>
                                    <a
                                        href={uri.startsWith("ipfs://")
                                            ? `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`
                                            : uri}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-500 hover:text-emerald-400 text-sm truncate max-w-[150px]"
                                    >
                                        View →
                                    </a>
                                </div>
                            )}
                        </div>
                    </section>
                    </div>

                    {/* Side rail: provenance + network context */}
                    <div className="space-y-6">
                        {/* Content Protection */}
                        {tokenId && (
                            <ContentProtectionBadge tokenId={tokenId} expanded />
                        )}

                        {/* Remix Lineage */}
                        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
                            <h2 className="text-sm font-semibold text-white mb-3">Remix lineage</h2>
                            {isRemix && parentIds.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-xs text-zinc-500 mb-3">
                                        Remix of {parentIds.length} parent stem{parentIds.length > 1 ? "s" : ""}:
                                    </p>
                                    {parentIds.map((parentId, idx) => (
                                        <Link
                                            key={idx}
                                            href={`/stem/${parentId.toString()}`}
                                            className="flex items-center justify-between px-3 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors text-sm"
                                        >
                                            <span className="text-white font-mono">Stem #{parentId.toString()}</span>
                                            <span className="text-zinc-400">→</span>
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                                        style={{ background: `rgba(${theme.accentRgb}, 0.12)`, color: `rgb(${theme.accentRgb})` }}
                                    >
                                        <span aria-hidden>✦</span>
                                    </div>
                                    <div>
                                        <p className="text-sm text-zinc-200">Original stem</p>
                                        <p className="text-xs text-zinc-500">
                                            First generation — not derived from another stem
                                        </p>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* Network stat */}
                        <section className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 flex items-baseline justify-between">
                            <span className="text-xs text-zinc-500">Stems minted on Resonate</span>
                            <span className="text-white font-semibold">{totalStems.toString()}</span>
                        </section>
                    </div>
                </div>
            </div>

            {/* List Modal */}
            {showListModal && tokenId && (
                <ListStemModal
                    tokenId={tokenId}
                    stemId={catalogStemId}
                    isOpen={showListModal}
                    onClose={() => setShowListModal(false)}
                    onSuccess={() => setShowListModal(false)}
                />
            )}

            {/* Buy Modal */}
            {buyListing && (
                <BuyModal
                    listingId={BigInt(buyListing.listingId)}
                    stemId={catalogStemId ?? undefined}
                    listingChainId={buyListing.chainId}
                    licenseType={buyListing.licenseType}
                    tierListings={tierListingIds}
                    tierPricesUsd={pricing ? {
                        personal: pricing.basePlayPriceUsd ?? undefined,
                        remix: pricing.remixLicenseUsd ?? undefined,
                        commercial: pricing.commercialLicenseUsd ?? undefined,
                    } : undefined}
                    isOpen={true}
                    onClose={() => setBuyListing(null)}
                    onSuccess={() => {
                        setBuyListing(null);
                        // Refresh listings and re-evaluate remix eligibility so
                        // a remix-tier purchase flips the CTA without a reload.
                        setRefreshNonce((n) => n + 1);
                    }}
                />
            )}

            <audio
                ref={audioRef}
                onEnded={() => setPreviewPlaying(false)}
                onError={() => setPreviewPlaying(false)}
            />
        </div>
    );
}
