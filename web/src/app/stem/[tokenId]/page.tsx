"use client";

import { useState, useEffect } from "react";
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
import { StemNftBadge } from "../../../components/marketplace/StemNftBadge";
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

export default function StemDetailPage() {
    const params = useParams();
    const tokenIdStr = params.tokenId as string;
    const tokenId = tokenIdStr ? BigInt(tokenIdStr) : undefined;

    const { address } = useAuth();
    const { chainId } = useContractAddresses();
    const { data: stemData, loading: stemLoading, error: stemError } = useStemData(tokenId);
    const { uri, loading: uriLoading } = useTokenURI(tokenId);
    const { parentIds, isRemix, loading: lineageLoading } = useParentStems(tokenId);
    const { balance } = useStemBalance(tokenId, address as Address | undefined);
    const { total: totalStems } = useTotalStems();

    const [showListModal, setShowListModal] = useState(false);
    const [artworkUrl, setArtworkUrl] = useState<string | null>(null);

    // Fetch artwork from metadata service
    useEffect(() => {
        if (!tokenId || !chainId) return;
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
        fetch(`${backendUrl}/api/metadata/${chainId}/${tokenId.toString()}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.image) setArtworkUrl(data.image);
            })
            .catch(() => { /* ignore — will show fallback */ });
    }, [tokenId, chainId]);

    // Loading state
    if (!tokenId || stemLoading || uriLoading || lineageLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="animate-pulse space-y-4 text-center">
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

    const isOwner = address && stemData.creator.toLowerCase() === address.toLowerCase();
    const canList = balance > 0n;

    return (
        <div className="min-h-screen bg-black">
            {/* Header */}
            <div className="bg-gradient-to-b from-emerald-900/20 to-transparent">
                <div className="max-w-4xl mx-auto px-4 py-8">
                    <Link
                        href="/marketplace"
                        className="text-sm text-zinc-400 hover:text-white mb-4 inline-flex items-center gap-1"
                    >
                        ← Back to Marketplace
                    </Link>

                    <div className="flex items-start gap-6 mt-4">
                        {/* Token Image */}
                        <div className="w-32 h-32 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                            {artworkUrl ? (
                                <img
                                    src={artworkUrl}
                                    alt={`Stem #${tokenId.toString()}`}
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                            ) : (
                                <svg
                                    className="w-12 h-12 text-zinc-600"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1}
                                        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                                    />
                                </svg>
                            )}
                        </div>

                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <h1 className="text-3xl font-bold text-white">
                                    Stem #{tokenId.toString()}
                                </h1>
                                <StemNftBadge tokenId={tokenId} />
                            </div>
                            <p className="text-zinc-400">
                                Created by{" "}
                                <span className="font-mono text-zinc-300">
                                    {stemData.creator.slice(0, 10)}...{stemData.creator.slice(-8)}
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* On-Chain Metadata */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">On-Chain Metadata</h2>

                        <div className="space-y-4">
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Token ID</span>
                                <span className="text-white font-mono">{tokenId.toString()}</span>
                            </div>

                            <div className="flex justify-between">
                                <span className="text-zinc-400">Creator</span>
                                {(() => {
                                    const explorerUrl = getExplorerUrl(chainId, stemData.creator);
                                    return explorerUrl ? (
                                        <a
                                            href={explorerUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-emerald-500 hover:text-emerald-400 font-mono text-sm"
                                        >
                                            {stemData.creator.slice(0, 8)}...
                                        </a>
                                    ) : (
                                        <span className="text-zinc-300 font-mono text-sm">
                                            {stemData.creator.slice(0, 8)}...
                                        </span>
                                    );
                                })()}
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
                                        : `${stemData.royaltyReceiver.slice(0, 6)}...`
                                    }
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
                                            : uri
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-500 hover:text-emerald-400 text-sm truncate max-w-[150px]"
                                    >
                                        View →
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Remix Lineage */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
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
                                <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                    </svg>
                                </div>
                                <p className="text-zinc-400">Original stem</p>
                                <p className="text-sm text-zinc-500">This is not a remix</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Owner Actions */}
                {canList && (
                    <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-white">Your Balance</h3>
                                <p className="text-zinc-400">
                                    You own {balance.toString()} edition{balance > 1n ? "s" : ""} of this stem
                                </p>
                            </div>
                            <button
                                onClick={() => setShowListModal(true)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-2 rounded-md transition-colors"
                            >
                                List for Sale
                            </button>
                        </div>
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
                    isOpen={showListModal}
                    onClose={() => setShowListModal(false)}
                    onSuccess={() => setShowListModal(false)}
                />
            )}
        </div>
    );
}
