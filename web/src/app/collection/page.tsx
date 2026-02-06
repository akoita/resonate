"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { useAuth } from "../../components/auth/AuthProvider";
import { useZeroDev } from "../../components/auth/ZeroDevProviderClient";
import AuthGate from "../../components/auth/AuthGate";
import { useUIStore } from "../../lib/uiStore";
import { type Address } from "viem";


interface OwnedStem {
    id: string;
    title: string;
    type: string;
    artist?: string;
    trackTitle?: string;
    releaseTitle?: string;
    genre?: string;
    artworkUrl?: string;
    previewUrl?: string;
    uri?: string;
    tokenId?: string;
    chainId?: number;
    purchasedAt?: string;
    durationSeconds?: number;
    activeListingId?: string;
}

export default function CollectionPage() {
    const { address } = useAuth();
    const { chainId } = useZeroDev();
    const { setResaleModal } = useUIStore();
    const [stems, setStems] = useState<OwnedStem[]>([]);
    // Track pending listings locally to bridge the gap between tx success and backend indexing
    const [pendingListings, setPendingListings] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const { addToast } = useToast();


    const fetchCollection = async () => {
        if (!address) return;
        setLoading(true);
        try {
            // For local Anvil (31337), the owner is the derived AA signer address, not the EOA.
            let queryAddress = address;
            if (chainId === 31337) {
                const { getLocalSignerAddress } = await import("../../lib/localAA");
                queryAddress = getLocalSignerAddress(address as Address);
            }

            const response = await fetch(`/api/metadata/collection/${queryAddress}`);
            if (!response.ok) throw new Error("Failed to fetch collection");
            const data = await response.json();

            // Merge backend data with local pending state
            const mergedStems = (data.stems || []).map((stem: OwnedStem) => {
                // If backend confirms listing, remove from pending (cleanup)
                if (stem.activeListingId) {
                    return stem;
                }

                // If backend says NOT listed, but we have a recent pending transaction, force listed state
                if (pendingListings[stem.id]) {
                    const timeSince = Date.now() - pendingListings[stem.id];
                    // Keep optimistic state valid for 60 seconds
                    if (timeSince < 60000) {
                        return { ...stem, activeListingId: "pending-optimistic" };
                    }
                }
                return stem;
            });

            setStems(mergedStems);
        } catch (error) {
            console.error("Error fetching collection:", error);
            addToast({
                type: "error",
                title: "Error",
                message: "Failed to load your collection",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCollection();
    }, [address, chainId]);

    const handlePlay = (stem: OwnedStem) => {
        const uri = stem.previewUrl || stem.uri;
        if (!uri) {
            addToast({ type: "error", title: "Error", message: "No audio available" });
            return;
        }

        if (playingId === stem.id) {
            // Pause
            audioRef.current?.pause();
            setPlayingId(null);
        } else {
            // Play new
            if (audioRef.current) {
                audioRef.current.pause();
            }
            audioRef.current = new Audio(uri);
            audioRef.current.play().catch((err) => {
                console.error("Playback error:", err);
                addToast({
                    type: "error",
                    title: "Playback Error",
                    message: "Failed to play audio. Try again later.",
                });
                setPlayingId(null);
            });
            audioRef.current.onended = () => setPlayingId(null);
            setPlayingId(stem.id);
        }
    };

    const handleDownload = async (stem: OwnedStem) => {
        if (!address) {
            addToast({ type: "error", title: "Error", message: "Wallet not connected" });
            return;
        }

        addToast({ type: "info", title: "Downloading...", message: `Preparing ${stem.title}` });

        try {
            // Use the secured download endpoint with ownership verification
            const response = await fetch("/api/encryption/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    stemId: stem.id,
                    walletAddress: chainId === 31337
                        ? (await import("../../lib/localAA")).getLocalSignerAddress(address as Address)
                        : address,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "Download failed");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${stem.title || stem.type}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            addToast({ type: "success", title: "Downloaded", message: `${stem.title} saved` });
        } catch (error) {
            console.error("Download error:", error);
            addToast({
                type: "error",
                title: "Download Failed",
                message: error instanceof Error ? error.message : "Could not download file",
            });
        }
    };


    const formatDuration = (seconds?: number) => {
        if (!seconds) return "--:--";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    return (
        <AuthGate title="Connect your wallet to view your NFT collection.">
            <main style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ marginBottom: 24 }}>
                    <h1 style={{ fontSize: 28, fontWeight: 700, color: "white", marginBottom: 8 }}>
                        My NFT Collection
                    </h1>
                    <p style={{ color: "#a1a1aa" }}>
                        Stems you&apos;ve purchased on the marketplace
                    </p>
                </div>

                {loading ? (
                    <Card style={{ padding: 40, textAlign: "center" }}>
                        <p style={{ color: "#a1a1aa" }}>Loading your collection...</p>
                    </Card>
                ) : stems.length === 0 ? (
                    <Card style={{ padding: 40, textAlign: "center" }}>
                        <p style={{ color: "#a1a1aa", marginBottom: 16 }}>
                            You haven&apos;t purchased any stems yet.
                        </p>
                        <Link href="/marketplace">
                            <Button variant="primary">Browse Marketplace</Button>
                        </Link>
                    </Card>
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                            gap: 20,
                        }}
                    >
                        {stems.map((stem) => (
                            <Card
                                key={stem.id}
                                style={{
                                    overflow: "hidden",
                                    display: "flex",
                                    flexDirection: "column",
                                    background: "rgba(30, 30, 35, 0.8)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: 12,
                                }}
                            >
                                {/* Artwork */}
                                <div
                                    style={{
                                        position: "relative",
                                        aspectRatio: "1/1",
                                        background: "#18181b",
                                        overflow: "hidden",
                                    }}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={stem.artworkUrl || "/default-stem-cover.png"}
                                        alt={stem.title}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                        }}
                                    />
                                    {/* Play overlay */}
                                    <button
                                        onClick={() => handlePlay(stem)}
                                        style={{
                                            position: "absolute",
                                            bottom: 12,
                                            right: 12,
                                            width: 48,
                                            height: 48,
                                            borderRadius: "50%",
                                            background: playingId === stem.id ? "#ef4444" : "#22c55e",
                                            border: "none",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 20,
                                            color: "white",
                                            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                                        }}
                                    >
                                        {playingId === stem.id ? "⏸" : "▶"}
                                    </button>
                                    {/* Type badge */}
                                    <div
                                        style={{
                                            position: "absolute",
                                            top: 12,
                                            left: 12,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 6,
                                        }}
                                    >
                                        <span
                                            style={{
                                                background: "rgba(0,0,0,0.7)",
                                                padding: "4px 10px",
                                                borderRadius: 20,
                                                fontSize: 12,
                                                color: "#a1a1aa",
                                                textTransform: "capitalize",
                                                alignSelf: "flex-start",
                                            }}
                                        >
                                            {stem.type}
                                        </span>
                                        {stem.activeListingId && (
                                            <span
                                                style={{
                                                    background: "rgba(34, 197, 94, 0.9)",
                                                    padding: "4px 10px",
                                                    borderRadius: 20,
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    color: "white",
                                                    textTransform: "uppercase",
                                                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                                                }}
                                            >
                                                🏷️ Listed
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Info */}
                                <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column" }}>
                                    <h3
                                        style={{
                                            fontSize: 16,
                                            fontWeight: 600,
                                            color: "white",
                                            marginBottom: 4,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {stem.title}
                                    </h3>
                                    <p
                                        style={{
                                            fontSize: 13,
                                            color: "#a1a1aa",
                                            marginBottom: 8,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {stem.trackTitle} • {stem.artist}
                                    </p>
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            fontSize: 12,
                                            color: "#71717a",
                                            marginBottom: 12,
                                        }}
                                    >
                                        <span>{formatDuration(stem.durationSeconds)}</span>
                                        <span>{stem.genre || "—"}</span>
                                    </div>

                                    {/* Actions */}
                                    <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
                                        <Button
                                            variant="ghost"
                                            onClick={() => handleDownload(stem)}
                                            style={{ flex: 1, border: "1px solid #3f3f46" }}
                                        >
                                            ⬇ Download
                                        </Button>

                                        {stem.tokenId && !stem.activeListingId ? (
                                            <Button
                                                variant="ghost"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setResaleModal({
                                                        stemId: stem.id,
                                                        tokenId: stem.tokenId!,
                                                        stemTitle: stem.title,
                                                        onSuccess: () => {
                                                            const now = Date.now();
                                                            // 1. Add to pending state
                                                            setPendingListings(prev => ({
                                                                ...prev,
                                                                [stem.id]: now
                                                            }));

                                                            // 2. Optimistic update for immediate feedback
                                                            setStems(prev => prev.map(s =>
                                                                s.id === stem.id
                                                                    ? { ...s, activeListingId: "pending-optimistic" }
                                                                    : s
                                                            ));

                                                            // 3. Trigger fetch (it will merge with pending state)
                                                            fetchCollection();
                                                        },
                                                    });
                                                }}
                                                style={{ flex: 1, border: "1px solid #3f3f46" }}
                                            >
                                                🔄 Resell
                                            </Button>
                                        ) : stem.activeListingId ? (
                                            <Button
                                                variant="ghost"
                                                disabled
                                                style={{ flex: 1, opacity: 0.8, color: "#22c55e", borderColor: "#22c55e" }}
                                            >
                                                ✓ Listed
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                disabled
                                                style={{ flex: 1, opacity: 0.5 }}
                                            >
                                                🔄 Resell
                                            </Button>
                                        )}
                                    </div>

                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </main>
        </AuthGate>
    );
}
