"use client";

import { useState, useEffect, useRef, useMemo, useCallback, use } from "react";
import Link from "next/link";
import { useWebSockets, type MarketplaceUpdate } from "../../hooks/useWebSockets";
import { useBuyStem } from "../../hooks/useContracts";
import { useToast } from "../../components/ui/Toast";
import { useAuth } from "../../components/auth/AuthProvider";
import { ExpiryBadge } from "../../components/marketplace/ExpiryBadge";
import "./marketplace.css";

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

const STEM_TYPES = ["all", "vocals", "drums", "bass", "melody", "guitar", "piano", "other"] as const;
const SORT_OPTIONS = [
    { value: "newest", label: "Newest" },
    { value: "price_asc", label: "Price ↑" },
    { value: "price_desc", label: "Price ↓" },
    { value: "ending_soon", label: "Ending Soon" },
] as const;
const PAGE_SIZE = 24;

function stemTypeBadgeClass(type: string): string {
    const t = type.toLowerCase();
    if (t === "vocals") return "stem-type-badge--vocals";
    if (t === "drums") return "stem-type-badge--drums";
    if (t === "bass") return "stem-type-badge--bass";
    if (t === "melody") return "stem-type-badge--melody";
    return "stem-type-badge--other";
}

function formatPrice(weiStr: string): string {
    try {
        const wei = Number(weiStr);
        if (wei === 0) return "Free";
        const eth = wei / 1e18;
        if (eth < 0.0001) return "<0.0001";
        if (eth >= 1) return eth.toFixed(2);
        return eth.toFixed(4);
    } catch { return "—"; }
}

export default function MarketplacePage(props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string>>;
}) {
    const params = use(props.params);
    const searchParams = use(props.searchParams);

    // ---- State ----
    const [listings, setListings] = useState<ListingData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stemType, setStemType] = useState("all");
    const [selectedGenre, setSelectedGenre] = useState("all");
    const [selectedArtist, setSelectedArtist] = useState("all");
    const [sortBy, setSortBy] = useState("newest");
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hideOwnListings, setHideOwnListings] = useState(true);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { buy, pending: buyPending } = useBuyStem();
    const { addToast } = useToast();
    const { address: walletAddress } = useAuth();

    // ---- Search debounce ----
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setDebouncedSearch(search);
        }, 400);
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, [search]);

    // ---- Fetch listings ----
    const fetchListings = useCallback(async (append = false) => {
        try {
            const currentOffset = append ? offset : 0;
            if (!append) {
                if (listings.length === 0) setLoading(true);
                setOffset(0);
            }
            setError(null);

            const params = new URLSearchParams({ status: "active", limit: String(PAGE_SIZE), offset: String(currentOffset), sortBy });
            if (debouncedSearch) params.set("search", debouncedSearch);
            if (hideOwnListings && walletAddress) params.set("excludeSeller", walletAddress);

            const res = await fetch(`/api/contracts/listings?${params.toString()}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to fetch (${res.status})`);
            }
            const data = await res.json();
            const newListings: ListingData[] = data.listings || [];

            // Deduplicate by listingId — the API or Load-More overlap
            // can produce entries with the same listingId.
            const dedupe = (arr: ListingData[]) => {
                const seen = new Map<string, ListingData>();
                for (const l of arr) seen.set(l.listingId, l);
                return Array.from(seen.values());
            };

            if (append) {
                setListings(prev => dedupe([...prev, ...newListings]));
            } else {
                setListings(dedupe(newListings));
            }
            setHasMore(newListings.length === PAGE_SIZE);
        } catch (err) {
            console.error("Marketplace fetch error:", err);
            setError(err instanceof Error ? err.message : "Failed to load listings");
            if (!append) setListings([]);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, sortBy, offset, listings.length, hideOwnListings, walletAddress]);

    // ---- Refetch when sort or search changes ----
    useEffect(() => {
        fetchListings(false);
    }, [debouncedSearch, sortBy, hideOwnListings]);

    // ---- Real-time marketplace updates via WebSocket ----
    const handleMarketplaceUpdate = useCallback((update: MarketplaceUpdate) => {
        switch (update.type) {
            case 'created':
                fetchListings(false);
                addToast({ type: "success", title: "New Listing", message: "A new stem was just listed!" });
                break;
            case 'sold':
                setListings(prev => prev.map(l => {
                    if (l.listingId === update.listingId) {
                        const remaining = Number(l.amount) - Number(update.amount);
                        if (remaining <= 0) return null;
                        return { ...l, amount: String(remaining) };
                    }
                    return l;
                }).filter((l): l is ListingData => l !== null));
                break;
            case 'cancelled':
                setListings(prev => prev.filter(l => l.listingId !== update.listingId));
                break;
        }
    }, [addToast, fetchListings]);

    useWebSockets(undefined, undefined, undefined, handleMarketplaceUpdate);

    // ---- Derived data ----
    const genres = useMemo(() => {
        const s = new Set<string>();
        listings.forEach(l => { if (l.stem?.genre) s.add(l.stem.genre); });
        return Array.from(s).sort();
    }, [listings]);

    const artists = useMemo(() => {
        const s = new Set<string>();
        listings.forEach(l => { if (l.stem?.artist) s.add(l.stem.artist); });
        return Array.from(s).sort();
    }, [listings]);

    const filteredListings = useMemo(() => listings.filter(l => {
        if (stemType !== "all" && l.stem?.type?.toLowerCase() !== stemType) return false;
        if (selectedGenre !== "all" && l.stem?.genre !== selectedGenre) return false;
        if (selectedArtist !== "all" && l.stem?.artist !== selectedArtist) return false;
        return true;
    }), [listings, stemType, selectedGenre, selectedArtist]);

    const hasActiveFilters = stemType !== "all" || selectedGenre !== "all" || selectedArtist !== "all" || search !== "";

    // ---- Handlers ----
    const handleBuy = async (listingId: string) => {
        try {
            await buy(BigInt(listingId), BigInt(1));
            setListings(prev => prev.filter(l => l.listingId !== listingId));
            addToast({ type: "success", title: "Purchase Successful!", message: "You now own this stem NFT." });
            fetchListings(false);
        } catch (err) {
            console.error("Buy failed:", err);
            const msg = err instanceof Error ? err.message : String(err);

            // ERC1155InsufficientBalance — seller no longer holds the token (already sold)
            if (msg.includes("0x03dee4c5") || msg.includes("ERC1155InsufficientBalance")) {
                setListings(prev => prev.filter(l => l.listingId !== listingId));
                addToast({ type: "error", title: "Already Sold", message: "This stem has already been purchased and is no longer available." });
                fetchListings(false);
                return;
            }

            // CannotBuyOwnListing — user is the seller
            if (msg.includes("0x50eadcb1") || msg.includes("CannotBuyOwnListing")) {
                addToast({ type: "error", title: "Cannot Buy", message: "You cannot purchase your own listing." });
                return;
            }

            addToast({ type: "error", title: "Purchase Failed", message: msg });
        }
    };

    const togglePlay = (id: string, uri: string) => {
        if (playingId === id) {
            audioRef.current?.pause();
            setPlayingId(null);
        } else {
            if (audioRef.current) {
                audioRef.current.src = uri;
                audioRef.current.play().catch(err => {
                    console.error("Playback failed:", err);
                    addToast({ type: "error", title: "Playback Error", message: "Failed to load audio." });
                    setPlayingId(null);
                });
                setPlayingId(id);
            }
        }
    };

    const handleLoadMore = () => {
        const newOffset = offset + PAGE_SIZE;
        setOffset(newOffset);
        fetchListings(true);
    };

    const clearFilters = () => {
        setStemType("all");
        setSelectedGenre("all");
        setSelectedArtist("all");
        setSearch("");
        setHideOwnListings(true);
    };

    // ---- Render ----
    return (
        <div>
            {/* Hero Header */}
            <div className="marketplace-hero">
                <h1 className="marketplace-title" data-testid="marketplace-title">
                    Stem Marketplace
                    <span className="marketplace-count">{filteredListings.length}</span>
                </h1>
                <p className="marketplace-subtitle">
                    Browse, preview, and collect unique audio stem NFTs from artists worldwide.
                </p>
            </div>

            {/* Sticky Search + Filter Controls */}
            <div className="marketplace-sticky-controls">
                {/* Search */}
                <div className="marketplace-search">
                    <span className="marketplace-search__icon">🔍</span>
                    <input
                        type="text"
                        className="marketplace-search__input"
                        placeholder="Search stems, tracks, or artists..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        data-testid="marketplace-search"
                    />
                </div>

                {/* Filter Toolbar */}
                <div className="marketplace-toolbar" data-testid="filter">
                    {/* Stem Type Pills */}
                    <div className="marketplace-toolbar__group">
                        {STEM_TYPES.map(type => (
                            <button
                                key={type}
                                className={`stem-pill ${stemType === type ? "stem-pill--active" : ""}`}
                                onClick={() => setStemType(type)}
                            >
                                {type === "all" ? "All" : type}
                            </button>
                        ))}
                    </div>

                    <div className="toolbar-sep" />

                    {/* Sort */}
                    <select
                        className="marketplace-select"
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value)}
                        data-testid="marketplace-sort"
                    >
                        {SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>

                    {/* Artist dropdown */}
                    {artists.length > 0 && (
                        <select
                            className="marketplace-select"
                            value={selectedArtist}
                            onChange={e => setSelectedArtist(e.target.value)}
                        >
                            <option value="all">All Artists</option>
                            {artists.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                    )}

                    {/* Genre dropdown */}
                    {genres.length > 0 && (
                        <select
                            className="marketplace-select"
                            value={selectedGenre}
                            onChange={e => setSelectedGenre(e.target.value)}
                        >
                            <option value="all">All Genres</option>
                            {genres.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                    )}

                    {/* Clear */}
                    {hasActiveFilters && (
                        <button className="marketplace-clear-btn" onClick={clearFilters}>
                            ✕ Clear
                        </button>
                    )}

                    {/* Hide own listings toggle */}
                    {walletAddress && (
                        <>
                            <div className="toolbar-sep" />
                            <label className="marketplace-toggle">
                                <input
                                    type="checkbox"
                                    checked={hideOwnListings}
                                    onChange={e => setHideOwnListings(e.target.checked)}
                                />
                                <span className="marketplace-toggle__slider" />
                                <span className="marketplace-toggle__label">Hide my listings</span>
                            </label>
                        </>
                    )}
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div className="marketplace-grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="stem-card-skeleton">
                            <div className="stem-card-skeleton__art" />
                            <div className="stem-card-skeleton__body">
                                <div className="stem-card-skeleton__line" />
                                <div className="stem-card-skeleton__line stem-card-skeleton__line--short" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="marketplace-error">
                    <p>Unable to load listings: {error}</p>
                    <button className="marketplace-error__retry" onClick={() => fetchListings(false)}>
                        Retry
                    </button>
                </div>
            ) : filteredListings.length === 0 ? (
                <div className="marketplace-empty">
                    <div className="marketplace-empty__icon">🎵</div>
                    <h3 className="marketplace-empty__title">
                        {hasActiveFilters ? "No matching stems" : "No listings yet"}
                    </h3>
                    <p className="marketplace-empty__text">
                        {hasActiveFilters
                            ? "Try adjusting your filters or search query."
                            : "Be the first to mint and list a stem NFT."}
                    </p>
                    {!hasActiveFilters && (
                        <Link href="/artist/upload" className="stem-card__buy" style={{ marginTop: 8, textDecoration: "none", display: "inline-block" }}>
                            Upload & Mint
                        </Link>
                    )}
                </div>
            ) : (
                <>
                    <div className="marketplace-grid">
                        {filteredListings.map(listing => (
                            <div key={`${listing.listingId}-${listing.tokenId}`} className="stem-card" data-testid="stem-card">
                                {/* Artwork */}
                                <div className="stem-card__artwork">
                                    {listing.stem?.artworkUrl ? (
                                        <img src={listing.stem.artworkUrl} alt={listing.stem.title || "Stem"} />
                                    ) : (
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "rgba(255,255,255,0.02)" }}>
                                            <span style={{ fontSize: 40, opacity: 0.15 }}>🎵</span>
                                        </div>
                                    )}

                                    {/* Badges */}
                                    <div className="stem-card__badges">
                                        {listing.stem?.type && (
                                            <span className={`stem-type-badge ${stemTypeBadgeClass(listing.stem.type)}`}>
                                                {listing.stem.type}
                                            </span>
                                        )}
                                        <ExpiryBadge expiresAt={listing.expiresAt} />
                                    </div>

                                    {/* Play overlay */}
                                    {listing.stem?.uri && (
                                        <div className="stem-card__play-overlay" onClick={() => togglePlay(listing.listingId, listing.stem!.uri!)}>
                                            <div className="stem-card__play-btn">
                                                {playingId === listing.listingId ? "⏸" : "▶"}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Body */}
                                <div className="stem-card__body">
                                    <div className="stem-card__title">{listing.stem?.title}</div>
                                    <div className="stem-card__meta">
                                        {listing.stem?.releaseId ? (
                                            <Link href={`/release/${listing.stem.releaseId}`} style={{ color: "inherit", textDecoration: "none" }}>
                                                {listing.stem?.track}
                                            </Link>
                                        ) : listing.stem?.track}
                                        {listing.stem?.artist && (
                                            <>
                                                {" · "}
                                                {listing.stem?.artistId ? (
                                                    <Link href={`/artist/${listing.stem.artistId}`} style={{ color: "inherit", textDecoration: "none" }}>
                                                        <span>{listing.stem.artist}</span>
                                                    </Link>
                                                ) : <span>{listing.stem.artist}</span>}
                                            </>
                                        )}
                                    </div>
                                    <div className="stem-card__seller">
                                        {listing.seller.slice(0, 6)}…{listing.seller.slice(-4)}
                                    </div>
                                    <div className="stem-card__amount">{listing.amount} edition{listing.amount !== "1" ? "s" : ""} left</div>

                                    {/* Footer */}
                                    <div className="stem-card__footer">
                                        <div className="stem-card__price">
                                            <span className="stem-card__price-label">Price</span>
                                            <span className="stem-card__price-value">
                                                {formatPrice(listing.price)}<small>ETH</small>
                                            </span>
                                        </div>
                                        {walletAddress && listing.seller.toLowerCase() === walletAddress.toLowerCase() ? (
                                            <span className="stem-card__own-label">Your Listing</span>
                                        ) : (
                                            <button
                                                className="stem-card__buy"
                                                onClick={() => handleBuy(listing.listingId)}
                                                disabled={buyPending}
                                            >
                                                {buyPending ? "Buying…" : "Buy"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Load More */}
                    {hasMore && (
                        <div className="marketplace-load-more">
                            <button className="marketplace-load-more__btn" onClick={handleLoadMore}>
                                Load More
                            </button>
                        </div>
                    )}
                </>
            )}

            <audio ref={audioRef} onEnded={() => setPlayingId(null)} onError={() => setPlayingId(null)} />
        </div>
    );
}
