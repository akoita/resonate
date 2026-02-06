"use client";

import { useState, useEffect, useRef, useMemo, use } from "react";
import Link from "next/link";

interface ListingData {
    listingId: string;
    tokenId: string;
    seller: string;
    price: string;
    amount: string;
    status: string;
    expiresAt: string;
    stem: {
        id: string;
        title: string;
        type: string;
        track?: string;
        artist?: string;
        genre?: string;
        artworkUrl?: string;
        uri?: string;
        artistId?: string;
        releaseId?: string;
    } | null;
}

import { useBuyStem } from "../../hooks/useContracts";
import { useToast } from "../../components/ui/Toast";

export default function MarketplacePage(props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string>>;
}) {
    const params = use(props.params);
    const searchParams = use(props.searchParams);

    const [listings, setListings] = useState<ListingData[]>([]);
    const [loading, setLoading] = useState(true);
    const [stemType, setStemType] = useState("all");
    const [selectedGenre, setSelectedGenre] = useState("all");
    const [selectedArtist, setSelectedArtist] = useState("all");
    const [playingId, setPlayingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const { buy, pending: buyPending } = useBuyStem();
    const { addToast } = useToast();

    useEffect(() => {
        fetchListings();
    }, []);

    async function fetchListings() {
        try {
            setLoading(true);
            const res = await fetch(`/api/contracts/listings?status=active&limit=50`);
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setListings(data.listings || []);
        } catch {
            setListings([]);
        } finally {
            setLoading(false);
        }
    }

    // Extract unique genres and artists from listings
    const genres = useMemo(() => {
        const genreSet = new Set<string>();
        listings.forEach(l => {
            if (l.stem?.genre) genreSet.add(l.stem.genre);
        });
        return Array.from(genreSet).sort();
    }, [listings]);

    const artists = useMemo(() => {
        const artistSet = new Set<string>();
        listings.forEach(l => {
            if (l.stem?.artist) artistSet.add(l.stem.artist);
        });
        return Array.from(artistSet).sort();
    }, [listings]);


    const handleBuy = async (listingId: string, price: string) => {
        try {
            await buy(BigInt(listingId), BigInt(1));
            addToast({
                type: "success",
                title: "Purchase Successful!",
                message: "You now own this stem NFT.",
            });
            fetchListings(); // Refresh
        } catch (err) {
            console.error("Buy failed:", err);
            addToast({
                type: "error",
                title: "Purchase Failed",
                message: err instanceof Error ? err.message : "Transaction failed",
            });
        }
    };

    const togglePlay = (id: string, uri: string) => {
        if (playingId === id) {
            audioRef.current?.pause();
            setPlayingId(null);
        } else {
            console.log("Attempting to play:", uri);
            if (audioRef.current) {
                audioRef.current.src = uri;
                audioRef.current.play().catch(err => {
                    console.error("Playback failed for URI:", uri, err);
                    addToast({
                        type: "error",
                        title: "Playback Error",
                        message: "Failed to load audio source. The gateway might be slow.",
                    });
                    setPlayingId(null);
                });
                setPlayingId(id);
            }
        }
    };

    const filteredListings = listings.filter(l => {
        if (stemType !== "all" && l.stem?.type?.toLowerCase() !== stemType) return false;
        if (selectedGenre !== "all" && l.stem?.genre !== selectedGenre) return false;
        if (selectedArtist !== "all" && l.stem?.artist !== selectedArtist) return false;
        return true;
    });


    return (
        <div>
            {/* Header Row */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
                flexWrap: "wrap",
                gap: 16
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "#10b981",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <path d="M9 18V5l12-3v13" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="6" cy="18" r="3" /><circle cx="18" cy="14" r="3" />
                        </svg>
                    </div>
                    <div>
                        <h1 style={{ fontSize: 20, fontWeight: 700, color: "white", margin: 0 }}>Marketplace</h1>
                        <p style={{ fontSize: 12, color: "#71717a", margin: 0 }}>{filteredListings.length} stems</p>
                    </div>
                </div>

                {/* Filter Pills */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["all", "original", "vocals", "drums", "bass", "guitar", "piano", "melody", "other"].map(type => (
                        <button
                            key={type}
                            onClick={() => setStemType(type)}
                            style={{
                                padding: "6px 14px",
                                borderRadius: 8,
                                border: "none",
                                background: stemType === type ? "#10b981" : "#27272a",
                                color: stemType === type ? "white" : "#a1a1aa",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "all 0.2s"
                            }}
                        >
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Secondary Filters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                {/* Artist Filter */}
                {artists.length > 0 && (
                    <select
                        value={selectedArtist}
                        onChange={(e) => setSelectedArtist(e.target.value)}
                        style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "1px solid #3f3f46",
                            background: "#18181b",
                            color: "white",
                            fontSize: 13,
                            cursor: "pointer"
                        }}
                    >
                        <option value="all">All Artists</option>
                        {artists.map(artist => (
                            <option key={artist} value={artist}>{artist}</option>
                        ))}
                    </select>
                )}

                {/* Genre Filter */}
                {genres.length > 0 && (
                    <select
                        value={selectedGenre}
                        onChange={(e) => setSelectedGenre(e.target.value)}
                        style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "1px solid #3f3f46",
                            background: "#18181b",
                            color: "white",
                            fontSize: 13,
                            cursor: "pointer"
                        }}
                    >
                        <option value="all">All Genres</option>
                        {genres.map(genre => (
                            <option key={genre} value={genre}>{genre}</option>
                        ))}
                    </select>
                )}

                {/* Clear filters */}
                {(selectedArtist !== "all" || selectedGenre !== "all" || stemType !== "all") && (
                    <button
                        onClick={() => {
                            setSelectedArtist("all");
                            setSelectedGenre("all");
                            setStemType("all");
                        }}
                        style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "1px solid #3f3f46",
                            background: "transparent",
                            color: "#ef4444",
                            fontSize: 13,
                            cursor: "pointer"
                        }}
                    >
                        Clear Filters
                    </button>
                )}
            </div>


            {/* Content */}
            {loading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} style={{ background: "#18181b", borderRadius: 12, height: 180, animation: "pulse 2s infinite" }} />
                    ))}
                </div>
            ) : filteredListings.length === 0 ? (
                <div style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    background: "#18181b",
                    borderRadius: 16,
                    border: "1px solid #27272a"
                }}>
                    <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: "#27272a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px"
                    }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="1.5">
                            <path d="M9 18V5l12-3v13" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="6" cy="18" r="3" /><circle cx="18" cy="14" r="3" />
                        </svg>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "white", margin: "0 0 8px" }}>No listings yet</h3>
                    <p style={{ fontSize: 14, color: "#71717a", margin: "0 0 20px" }}>Be the first to mint and list a stem NFT</p>
                    <Link
                        href="/artist/upload"
                        style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            background: "#10b981",
                            color: "white",
                            borderRadius: 8,
                            fontSize: 14,
                            fontWeight: 500,
                            textDecoration: "none"
                        }}
                    >
                        Upload & Mint
                    </Link>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                    {filteredListings.map(listing => (
                        <div
                            key={listing.listingId}
                            style={{
                                background: "#18181b",
                                borderRadius: 12,
                                border: "1px solid #27272a",
                                overflow: "hidden",
                                display: "flex",
                                flexDirection: "column"
                            }}
                        >
                            <div style={{
                                aspectRatio: "1",
                                background: "#27272a",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                position: "relative",
                                flexShrink: 0
                            }}>
                                {listing.stem?.artworkUrl ? (
                                    <img
                                        src={listing.stem.artworkUrl}
                                        alt={listing.stem.title || "Stem artwork"}
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    />
                                ) : (
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="1.5">
                                        <path d="M9 18V5l12-3v13" strokeLinecap="round" strokeLinejoin="round" />
                                        <circle cx="6" cy="18" r="3" /><circle cx="18" cy="14" r="3" />
                                    </svg>
                                )}
                                {listing.stem?.uri && (
                                    <button
                                        onClick={() => togglePlay(listing.listingId, listing.stem!.uri!)}
                                        style={{
                                            position: "absolute",
                                            bottom: 8,
                                            right: 8,
                                            width: 36,
                                            height: 36,
                                            borderRadius: "50%",
                                            background: "rgba(0,0,0,0.6)",
                                            border: "none",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            backdropFilter: "blur(5px)"
                                        }}
                                    >
                                        {playingId === listing.listingId ? (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                                                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                                            </svg>
                                        ) : (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                                                <polygon points="5 3 19 12 5 21 5 3" />
                                            </svg>
                                        )}
                                    </button>
                                )}
                            </div>
                            <div style={{ padding: 12, display: "flex", flexDirection: "column", flex: 1 }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: "white", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {listing.stem?.title}
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: "#a1a1aa",
                                        marginBottom: 4,
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                        minHeight: "2.4em"
                                    }}>
                                        <Link href={`/release/${listing.stem?.releaseId}`} style={{ color: "inherit", textDecoration: "none" }} onMouseOver={(e) => e.currentTarget.style.textDecoration = "underline"} onMouseOut={(e) => e.currentTarget.style.textDecoration = "none"}>
                                            {listing.stem?.track}
                                        </Link>
                                        {" • "}
                                        <Link href={`/artist/${listing.stem?.artistId}`} style={{ color: "inherit", textDecoration: "none" }} onMouseOver={(e) => e.currentTarget.style.textDecoration = "underline"} onMouseOut={(e) => e.currentTarget.style.textDecoration = "none"}>
                                            {listing.stem?.artist}
                                        </Link>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#71717a", marginBottom: 8 }}>
                                        Seller: {listing.seller.slice(0, 6)}...{listing.seller.slice(-4)}
                                    </div>
                                </div>
                                <div style={{ marginTop: "auto" }}>
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: 12
                                    }}>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: "#10b981" }}>
                                            {(Number(listing.price) / 1e18).toFixed(4)} ETH
                                        </span>
                                        <span style={{ fontSize: 11, color: "#52525b" }}>
                                            {listing.amount} left
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => handleBuy(listing.listingId, listing.price)}
                                        disabled={buyPending}
                                        style={{
                                            width: "100%",
                                            padding: "8px 12px",
                                            background: "#10b981",
                                            color: "white",
                                            borderRadius: 6,
                                            border: "none",
                                            fontSize: 13,
                                            fontWeight: 500,
                                            cursor: "pointer",
                                            opacity: buyPending ? 0.7 : 1
                                        }}
                                    >
                                        {buyPending ? "Buying..." : "Buy Now"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <audio ref={audioRef} onEnded={() => setPlayingId(null)} onError={() => {
                console.error("Audio playback failed");
                setPlayingId(null);
            }} />
        </div>
    );
}
