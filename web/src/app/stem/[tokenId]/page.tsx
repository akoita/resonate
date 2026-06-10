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
import { API_BASE } from "../../../lib/api";
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
    // Balance follows the same identity as the own-listing check: the smart
    // account is the on-chain holder for passkey wallets.
    const holderAddress = (smartAccountAddress || address) as Address | undefined;
    const { balance } = useStemBalance(tokenId, holderAddress);
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
                isPlaying={previewPlaying}
                onTogglePreview={catalogStemId ? togglePreview : undefined}
            />

            <div className="max-w-5xl mx-auto px-4 pb-12">
                {metaState === "failed" && (
                    <div className="mb-6 px-4 py-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm stem-meta-fallback">
                        Catalog details are unavailable right now — showing on-chain data only.
                        Purchasing and remixing need the catalog connection; try reloading.
                    </div>
                )}

                {/* Action rail */}
                <div className="flex items-center gap-3 flex-wrap -mt-2 mb-8 stem-action-rail">
                    {primaryListing && !isOwnListing && (
                        <button
                            type="button"
                            onClick={() => setBuyListing(primaryListing)}
                            className="px-6 py-2.5 rounded-md font-semibold text-white transition-transform hover:scale-[1.02]"
                            style={{ background: `rgb(${theme.accentRgb})` }}
                        >
                            Buy · {primaryListing.licenseType ?? "personal"} license
                        </button>
                    )}
                    {primaryListing && isOwnListing && (
                        <Link
                            href="/marketplace/manage"
                            className="px-6 py-2.5 rounded-md font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 transition-colors"
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
                        />
                    )}
                    {canList && (
                        <button
                            type="button"
                            onClick={() => setShowListModal(true)}
                            className="px-6 py-2.5 rounded-md font-medium bg-emerald-600/90 hover:bg-emerald-600 text-white transition-colors"
                        >
                            List for Sale
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={copyLink}
                        title="Copy link to this stem"
                        className="px-4 py-2.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors"
                    >
                        {linkCopied ? "✓ Copied" : "⧉ Copy link"}
                    </button>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

                    {/* License tiers */}
                    <LicenseTiersPanel
                        rows={buildTierRows({ listedTiers, pricing })}
                        stemType={stemType}
                    />

                    {/* Remix Lineage */}
                    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Remix Lineage</h2>
                        {isRemix && parentIds.length > 0 ? (
                            <div className="space-y-3">
                                <p className="text-sm text-zinc-400 mb-4">
                                    This stem is a remix of {parentIds.length} parent stem{parentIds.length > 1 ? "s" : ""}:
                                </p>
                                {parentIds.map((parentId, idx) => (
                                    <Link
                                        key={idx}
                                        href={`/stem/${parentId.toString()}`}
                                        className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-zinc-700 rounded flex items-center justify-center">
                                                <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13" />
                                                </svg>
                                            </div>
                                            <span className="text-white font-mono">Stem #{parentId.toString()}</span>
                                        </div>
                                        <span className="text-zinc-400">→</span>
                                    </Link>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-6">
                                <div
                                    className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                                    style={{ background: `rgba(${theme.accentRgb}, 0.12)` }}
                                >
                                    <span aria-hidden>✦</span>
                                </div>
                                <p className="text-zinc-400">Original stem</p>
                                <p className="text-sm text-zinc-500">This is not a remix</p>
                            </div>
                        )}
                    </section>

                    {/* Content Protection */}
                    <section>
                        {tokenId && (
                            <ContentProtectionBadge tokenId={tokenId} expanded />
                        )}
                    </section>
                </div>

                {/* Owner balance note */}
                {canList && (
                    <div className="mt-6 text-sm text-zinc-500">
                        You own {balance.toString()} edition{balance > 1n ? "s" : ""} of this stem.
                    </div>
                )}

                {/* Stats Banner */}
                <div className="mt-8 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center justify-center gap-8 text-sm text-zinc-400">
                        <div>
                            <span className="text-white font-semibold">{totalStems.toString()}</span> total stems minted
                        </div>
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
