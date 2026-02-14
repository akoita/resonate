"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import { useSearchParams, useRouter } from "next/navigation";
import {
    listTracks,
    deleteTrack,
    getArtworkUrl,
    saveTracksMetadata,
    LocalTrack,
} from "../../lib/localLibrary";
import { useAuth } from "../../components/auth/AuthProvider";
import { useZeroDev } from "../../components/auth/ZeroDevProviderClient";
import { type Address } from "viem";
import {
    Playlist,
    listPlaylists,
    // getPlaylist,
    // removeTrackFromPlaylist,
    // reorderTracks,
    // renamePlaylist,
} from "../../lib/playlistStore";
import { formatDuration } from "../../lib/metadataExtractor";
import { useToast } from "../../components/ui/Toast";
import { useAutoScan } from "../../lib/useAutoScan";
import { groupByArtist, groupByAlbum } from "../../lib/libraryGrouping";
import { usePlayer } from "../../lib/playerContext";
import { useUIStore } from "../../lib/uiStore";
import { PlaylistTab } from "../../components/library/PlaylistTab";
import { PlaylistDetail } from "../../components/library/PlaylistDetail";
import { ContextMenu, ContextMenuItem } from "../../components/ui/ContextMenu";
import { TrackActionMenu } from "../../components/ui/TrackActionMenu";
import { MarqueeText } from "../../components/ui/MarqueeText";
import Link from "next/link";

type ViewTab = "tracks" | "artists" | "albums" | "playlists" | "stems";

export default function LibraryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { playQueue, stop: handleStop, currentTrack, playNext, addToQueue } = usePlayer();
    const [tracks, setTracks] = useState<LocalTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const { addToast } = useToast();
    const autoScan = useAutoScan();
    const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
    const [hoveredArtwork, setHoveredArtwork] = useState<{ url: string; title: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTab, setActiveTab] = useState<ViewTab>("tracks");
    const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
    const [selectedAlbum, setSelectedAlbum] = useState<{ name: string; artist: string } | null>(null);
    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
    const [playlistCount, setPlaylistCount] = useState(0);
    const { setTracksToAddToPlaylist, setResaleModal } = useUIStore();
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
    const lastClickedTrackIdRef = useRef<string | null>(null);
    const { address } = useAuth();
    const { chainId } = useZeroDev();
    
    // Remote collection state
    const [ownedStems, setOwnedStems] = useState<LocalTrack[]>([]);
    const [isCollectionLoading, setIsCollectionLoading] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, items: ContextMenuItem[] } | null>(null);

    // Unified tracks (Local + Owned Stems), deduplicated by ID
    const unifiedTracks = useMemo(() => {
        const seen = new Set<string>();
        const result: LocalTrack[] = [];
        for (const t of [...tracks, ...ownedStems]) {
            if (!seen.has(t.id)) {
                seen.add(t.id);
                result.push(t);
            }
        }
        return result;
    }, [tracks, ownedStems]);

    const [showStems, setShowStems] = useState(false);

    // Filtered tracks
    const filteredTracks = useMemo(() => {
        let source = unifiedTracks;

        // In "Tracks" tab, only show stems if toggle is ON
        if (activeTab === "tracks" && !showStems) {
            source = source.filter(t => !t.stemType); // exclude stems
        }
        // In "Stems" tab, only show stems
        else if (activeTab === "stems") {
            source = ownedStems;
        }

        if (!searchQuery.trim()) return source;
        const q = searchQuery.toLowerCase();
        return source.filter(t =>
            t.title.toLowerCase().includes(q) ||
            (t.artist && t.artist.toLowerCase().includes(q)) ||
            (t.album && t.album.toLowerCase().includes(q))
        );
    }, [unifiedTracks, ownedStems, activeTab, searchQuery, showStems]);

    // Grouped data from filtered tracks
    const artists = useMemo(() => groupByArtist(filteredTracks), [filteredTracks]);
    const albums = useMemo(() => groupByAlbum(filteredTracks), [filteredTracks]);

    const loadTracks = async () => {
        setLoading(true);
        const items = await listTracks();
        setTracks(items);
        setLoading(false);

        // Load artwork for all tracks in parallel (non-blocking)
        const artworkPromises = items.map(async (track) => {
            const url = await getArtworkUrl(track);
            return { id: track.id, url };
        });

        const artworkResults = await Promise.all(artworkPromises);
        const urls = new Map<string, string>();
        for (const { id, url } of artworkResults) {
            if (url) urls.set(id, url);
        }
        setArtworkUrls(urls);
    };

    const fetchCollection = useCallback(async () => {
        if (!address) return;
        setIsCollectionLoading(true);
        try {
            // For local Anvil (31337) or Sepolia Fork (11155111) in dev mode,
            // we need to check BOTH the connected EOA (for manual purchases)
            // and the derived AA signer (for agent/automated purchases).
            const addressesToQuery = new Set<string>([address]);
            
            // Allow derivation on Sepolia if we are in dev mode (handling local fork)
            const isLocalOrFork = chainId === 31337 || (chainId === 11155111 && process.env.NODE_ENV === "development");

            if (isLocalOrFork) {
                const { getLocalSignerAddress } = await import("../../lib/localAA");
                const derived = getLocalSignerAddress(address as Address);
                addressesToQuery.add(derived);
            }

            // Minimal type for stem response to avoid 'any'
            type RemoteStem = {
                id: string;
                title: string;
                artist?: string;
                releaseTitle?: string;
                genre?: string;
                durationSeconds?: number;
                purchasedAt?: string;
                type: string;
                tokenId: string;
                activeListingId?: string;
                uri?: string;
                artworkUrl?: string;
                previewUrl?: string;
            };

            const allStemsMap = new Map<string, RemoteStem>();

            await Promise.all(Array.from(addressesToQuery).map(async (addr) => {
                try {
                    const response = await fetch(`/api/metadata/collection/${addr}`);
                    if (!response.ok) return; // Skip failed fetches
                    const data = await response.json();
                    if (data.stems) {
                        data.stems.forEach((stem: RemoteStem) => {
                            allStemsMap.set(stem.id, stem);
                        });
                    }
                } catch (e) {
                    console.error(`Failed to fetch for ${addr}:`, e);
                }
            }));

            // Map backend data to LocalTrack format
            const mappedStems: LocalTrack[] = Array.from(allStemsMap.values()).map((stem: RemoteStem) => ({
                id: stem.id,
                title: stem.title,
                artist: stem.artist || "Unknown Artist",
                album: stem.releaseTitle || "Unknown Release",
                // Helper to group stems by the original track
                albumArtist: stem.artist || "Unknown Artist", 
                year: null,
                genre: stem.genre || "Electronic",
                duration: stem.durationSeconds || 0,
                createdAt: stem.purchasedAt || new Date().toISOString(),
                // Stem-specific fields
                stemType: stem.type,
                tokenId: stem.tokenId,
                listingId: stem.activeListingId,
                purchaseDate: stem.purchasedAt,
                isOwned: true,
                remoteUrl: stem.uri,
                remoteArtworkUrl: stem.artworkUrl,
                previewUrl: stem.previewUrl,
            }));

            setOwnedStems(mappedStems);

            // Persist stem metadata to the library so getTrack() can find
            // them when they are added to playlists
            if (mappedStems.length > 0) {
                void saveTracksMetadata(mappedStems, "remote");
            }
        } catch (error) {
            console.error("Error fetching collection:", error);
            addToast({
                type: "error",
                title: "Error",
                message: "Failed to load your collection",
            });
        } finally {
            setIsCollectionLoading(false);
        }
    }, [address, chainId, addToast]);

    useEffect(() => {
        void loadTracks();
        void listPlaylists().then(p => setPlaylistCount(p.length));
    }, []);

    // Refresh playlist count when switching tabs (catches creates/deletes)
    useEffect(() => {
        void listPlaylists().then(p => setPlaylistCount(p.length));
    }, [activeTab]);

    useEffect(() => {
        if (address) {
            fetchCollection();
        }
    }, [fetchCollection, address]);

    // Handle deep-linking from query params
    useEffect(() => {
        const tab = searchParams.get("tab");
        const artist = searchParams.get("artist");
        const album = searchParams.get("album");
        const albumArtist = searchParams.get("albumArtist");

        if (tab === "playlists") {
            setActiveTab("playlists");
        } else if (artist) {
            setSelectedArtist(artist);
            setActiveTab("artists");
        } else if (album && albumArtist) {
            setSelectedAlbum({ name: album, artist: albumArtist });
            setActiveTab("albums");
        }
    }, [searchParams]);

    // Real-time: append newly scanned tracks
    useEffect(() => {
        if (autoScan.newTracks.length > 0) {
            const latestTrack = autoScan.newTracks[autoScan.newTracks.length - 1];
            if (latestTrack && !tracks.find(t => t.id === latestTrack.id)) {
                setTracks(prev => [latestTrack, ...prev]);
                // Load artwork for new track
                void getArtworkUrl(latestTrack).then(url => {
                    if (url) {
                        setArtworkUrls(prev => new Map(prev).set(latestTrack.id, url));
                    }
                });
            }
        }
    }, [autoScan.newTracks, tracks]);

    // Show toast when scan completes
    useEffect(() => {
        if (autoScan.result && autoScan.result.added > 0) {
            addToast({
                type: "success",
                title: "Scan Complete",
                message: `${autoScan.result.added} new track${autoScan.result.added > 1 ? "s" : ""} added.`,
            });
        }
    }, [autoScan.result, addToast]);

    const handlePlay = useCallback((track: LocalTrack, trackList: LocalTrack[]) => {
        const index = trackList.findIndex(t => t.id === track.id);
        void playQueue(trackList, index >= 0 ? index : 0);
    }, [playQueue]);

    // Global key listener for playback
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if not in an input/textarea
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.code === "Space" && selectedTrackId) {
                e.preventDefault();
                const track = tracks.find(t => t.id === selectedTrackId);
                if (track) {
                    handlePlay(track, tracks);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedTrackId, tracks, handlePlay]);

    const handleDelete = async (id: string) => {
        if (currentTrack?.id === id) handleStop();
        await deleteTrack(id);
        addToast({ type: "success", title: "Deleted", message: "Track removed from library" });
        loadTracks();
    };

    const handleStemDownload = async (stem: LocalTrack) => {
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
            a.download = `${stem.title || stem.stemType}.mp3`;
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

    const handleContextMenu = (e: React.MouseEvent, track: LocalTrack) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, items: getTrackContextMenuItems(track) });
    };

    const handleArtistContextMenu = (e: React.MouseEvent, artistName: string) => {
        e.preventDefault();
        const artistTracks = tracks.filter(t => (t.artist || "Unknown Artist") === artistName);
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play Artist", icon: "▶️", onClick: () => playQueue(artistTracks, 0) },
                { label: "Add to Queue", icon: "➕", onClick: () => artistTracks.forEach(t => addToQueue(t)) },
                { separator: true, label: "", onClick: () => { } },
                { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist(artistTracks) },
            ]
        });
    };

    const handleAlbumContextMenu = (e: React.MouseEvent, albumName: string, artistName: string) => {
        e.preventDefault();
        const albumTracks = tracks.filter(t =>
            (t.album || "Unknown Album") === albumName &&
            (t.artist || "Unknown Artist") === artistName
        );
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play Album", icon: "▶️", onClick: () => playQueue(albumTracks, 0) },
                { label: "Add to Queue", icon: "➕", onClick: () => albumTracks.forEach(t => addToQueue(t)) },
                { separator: true, label: "", onClick: () => { } },
                { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist(albumTracks) },
            ]
        });
    };

    const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
            { label: "Play Next", icon: "⏭️", onClick: () => { playNext(track); addToast({ type: "success", title: "Queued", message: `"${track.title}" will play next` }); } },
            { label: "Add to Queue", icon: "➕", onClick: () => { addToQueue(track); addToast({ type: "success", title: "Queued", message: `Added "${track.title}" to queue` }); } },
            { separator: true, label: "", onClick: () => { } },
            { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist([track]) },
        ];

        if (track.isOwned) {
            items.push(
                { separator: true, label: "", onClick: () => { } },
                { 
                    label: "Download Stem", 
                    icon: "⬇️", 
                    onClick: () => handleStemDownload(track) 
                }
            );

            if (track.tokenId && !track.listingId) {
                items.push({
                    label: "Add to Playlist",
                    icon: "➕",
                    onClick: () => setTracksToAddToPlaylist([track])
                });
                
                items.push({
                    label: "Resell Stem",
                    icon: "💰",
                    onClick: () => setResaleModal({
                        stemId: track.id,
                        tokenId: track.tokenId!,
                        stemTitle: track.title,
                    })
                });
            }
        } else {
             items.push(
                { separator: true, label: "", onClick: () => { } },
                { label: "Delete from Library", icon: "🗑️", variant: "destructive", onClick: () => handleDelete(track.id) },
             );
        }

        return items;
    };

    const renderTrackList = (trackList: LocalTrack[]) => (
        <div className="library-list">
            <div className="library-item library-item-header">
                <div style={{ width: 28, flexShrink: 0 }}>
                    <input
                        type="checkbox"
                        checked={selectedTrackIds.size === trackList.length && trackList.length > 0}
                        onChange={(e) => {
                            if (e.target.checked) {
                                setSelectedTrackIds(new Set(trackList.map(t => t.id)));
                            } else {
                                setSelectedTrackIds(new Set());
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        title="Select all"
                        style={{ accentColor: 'var(--color-accent)', cursor: 'pointer', width: 15, height: 15 }}
                    />
                </div>
                <div></div>
                <div>Title</div>
                <div>Artist</div>
                <div>Album</div>
                <div>Duration</div>
                <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {trackList.map((track, idx) => {
                // If remote artwork url exists, use it, otherwise check local blob map
                const artUrl = track.remoteArtworkUrl || artworkUrls.get(track.id);
                const isMultiSelected = selectedTrackIds.has(track.id);
                return (
                    <div
                        key={track.id}
                        className={`library-item ${isMultiSelected ? "selected" : ""} ${selectedTrackId === track.id ? "focused" : ""} ${currentTrack?.id === track.id ? "playing" : ""}`}
                        draggable
                        onClick={(e) => {
                            if (e.shiftKey && lastClickedTrackIdRef.current) {
                                // Shift+click: range select
                                const lastIdx = trackList.findIndex(t => t.id === lastClickedTrackIdRef.current);
                                const curIdx = idx;
                                const start = Math.min(lastIdx, curIdx);
                                const end = Math.max(lastIdx, curIdx);
                                setSelectedTrackIds(prev => {
                                    const next = new Set(prev);
                                    for (let i = start; i <= end; i++) {
                                        next.add(trackList[i].id);
                                    }
                                    return next;
                                });
                            } else if (e.ctrlKey || e.metaKey) {
                                // Ctrl/Cmd+click: toggle single
                                setSelectedTrackIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(track.id)) next.delete(track.id);
                                    else next.add(track.id);
                                    return next;
                                });
                            } else {
                                // Normal click: play track
                                setSelectedTrackId(track.id);
                                handlePlay(track, trackList);
                            }
                            lastClickedTrackIdRef.current = track.id;
                        }}
                        onContextMenu={(e) => handleContextMenu(e, track)}
                        onDragStart={(e) => {
                            // If dragging a selected track, drag all selected
                            if (isMultiSelected && selectedTrackIds.size > 1) {
                                const selectedTracks = trackList.filter(t => selectedTrackIds.has(t.id));
                                const payload = JSON.stringify({
                                    type: "album",
                                    name: `${selectedTracks.length} tracks`,
                                    tracks: selectedTracks,
                                });
                                e.dataTransfer.setData("application/json", payload);
                                e.dataTransfer.setData("text/plain", payload);
                            } else {
                                const payload = JSON.stringify({
                                    type: "track",
                                    id: track.id,
                                    title: track.title,
                                    artist: track.artist
                                });
                                e.dataTransfer.setData("application/json", payload);
                                e.dataTransfer.setData("text/plain", payload);
                            }
                            e.dataTransfer.effectAllowed = "copy";
                        }}
                    >
                        <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <input
                                type="checkbox"
                                checked={isMultiSelected}
                                onChange={() => {
                                    setSelectedTrackIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(track.id)) next.delete(track.id);
                                        else next.add(track.id);
                                        return next;
                                    });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ accentColor: 'var(--color-accent)', cursor: 'pointer', width: 15, height: 15, opacity: isMultiSelected ? 1 : undefined }}
                                className="library-select-checkbox"
                            />
                        </div>
                        <div
                            className="library-item-artwork"
                            onMouseEnter={() => artUrl && setHoveredArtwork({ url: artUrl, title: track.title })}
                            onMouseLeave={() => setHoveredArtwork(null)}
                        >
                            {artUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={artUrl} alt={track.title} />
                            ) : (
                                <div className="library-item-artwork-placeholder">🎵</div>
                            )}
                        </div>
                        <div className="library-item-title">
                            {track.title}
                            {track.stemType && (
                                <span style={{ 
                                    fontSize: "0.7em", 
                                    background: "rgba(255,255,255,0.1)", 
                                    padding: "2px 6px", 
                                    borderRadius: "4px", 
                                    marginLeft: "8px",
                                    color: "#aaa"
                                }}>
                                    {track.stemType}
                                </span>
                            )}
                        </div>
                        <div
                            className="library-item-artist clickable hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                const target = track.artist;
                                if (target) router.push(`/artist/${encodeURIComponent(target)}`);
                            }}
                        >
                            {track.artist || "Unknown Artist"}
                        </div>
                        <div
                            className="library-item-album"
                            onClick={(e) => {
                                if (!track.album) return;
                                e.stopPropagation();
                                setSelectedAlbum({ name: track.album, artist: track.artist || "Unknown Artist" });
                                setActiveTab("albums");
                            }}
                        >
                            {track.album || "—"}
                        </div>
                        <div className="library-item-duration">
                            {formatDuration(track.duration)}
                            {track.listingId && (
                                <span title="Listed for sale" style={{ marginLeft: "8px" }}>🏷️</span>
                            )}
                        </div>
                        <div className="library-item-actions">
                            <TrackActionMenu
                                actions={[
                                    { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist([track]) },
                                ]}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderArtists = () => (
        <div className="library-grid-view">
            {artists.map((artist) => {
                // Find first track with artwork for this artist
                const trackWithArt = filteredTracks.find(t => (t.artist || "Unknown Artist") === artist.name && (t.remoteArtworkUrl || artworkUrls.has(t.id)));
                const artUrl = trackWithArt ? (trackWithArt.remoteArtworkUrl || artworkUrls.get(trackWithArt.id)) : null;
                return (
                    <div
                        key={artist.name}
                        className="library-card"
                        onClick={() => router.push(`/artist/${encodeURIComponent(artist.name)}`)}
                        onContextMenu={(e) => handleArtistContextMenu(e, artist.name)}
                        draggable
                        onDragStart={(e) => {
                            const payload = JSON.stringify({
                                type: "artist",
                                name: artist.name
                            });
                            e.dataTransfer.setData("application/json", payload);
                            e.dataTransfer.setData("text/plain", payload);
                            e.dataTransfer.effectAllowed = "copy";
                        }}
                    >
                        {artUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={artUrl} alt={artist.name} className="library-card-artwork" />
                        ) : (
                            <div className="library-card-icon">🎤</div>
                        )}
                        <div className="library-card-title">{artist.name}</div>
                        <div className="library-card-meta">
                            {artist.trackCount} track{artist.trackCount !== 1 ? "s" : ""}
                            {artist.albums.length > 0 && ` • ${artist.albums.length} album${artist.albums.length !== 1 ? "s" : ""}`}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderAlbums = () => (
        <div className="library-grid-view">
            {albums.map((album) => {
                // Find first track with artwork for this album
                const trackWithArt = filteredTracks.find(
                    t => (t.album || "Unknown Album") === album.name &&
                        (t.artist || "Unknown Artist") === album.artist &&
                        (t.remoteArtworkUrl || artworkUrls.has(t.id))
                );
                const artUrl = trackWithArt ? (trackWithArt.remoteArtworkUrl || artworkUrls.get(trackWithArt.id)) : null;
                return (
                    <div
                        key={`${album.artist}::${album.name}`}
                        className="library-card"
                        onClick={() => setSelectedAlbum({ name: album.name, artist: album.artist })}
                        onContextMenu={(e) => handleAlbumContextMenu(e, album.name, album.artist)}
                        draggable
                        onDragStart={(e) => {
                            const albumTracks = filteredTracks.filter(t =>
                                (t.album || "Unknown Album") === album.name &&
                                (t.artist || "Unknown Artist") === album.artist
                            );
                            const payload = JSON.stringify({
                                type: "album",
                                name: album.name,
                                artist: album.artist,
                                tracks: albumTracks
                            });
                            e.dataTransfer.setData("application/json", payload);
                            e.dataTransfer.setData("text/plain", payload);
                            e.dataTransfer.effectAllowed = "copy";
                        }}
                    >
                        {artUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={artUrl} alt={album.name} className="library-card-artwork" />
                        ) : (
                            <div className="library-card-icon">💿</div>
                        )}
                        <div className="library-card-title">{album.name}</div>
                        <div className="library-card-meta">
                            {album.artist}
                            {album.year && ` • ${album.year}`}
                        </div>
                        <div className="library-card-count">
                            {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderArtistDetail = () => {
        const artistTracks = filteredTracks.filter(t => (t.artist || "Unknown Artist") === selectedArtist);
        const artistAlbums = albums.filter(a => (a.artist || "Unknown Artist") === selectedArtist);

        // Find best image for artist
        const trackWithArt = artistTracks.find(t => (t.remoteArtworkUrl || artworkUrls.has(t.id)));
        const artUrl = trackWithArt ? (trackWithArt.remoteArtworkUrl || artworkUrls.get(trackWithArt.id)) : null;

        return (
            <div className="library-detail">
                <div className="library-detail-back">
                    <Button variant="ghost" onClick={() => setSelectedArtist(null)}>← Back to Artists</Button>
                </div>

                <div className="detail-hero">
                    {artUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={artUrl} alt={selectedArtist || ""} className="detail-hero-artwork" />
                    ) : (
                        <div className="detail-hero-artwork" style={{ background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "80px" }}>
                            🎤
                        </div>
                    )}
                    <div className="detail-hero-content">
                        <div className="detail-hero-label">Artist</div>
                        <h1 className="detail-hero-title">{selectedArtist}</h1>
                        <div className="detail-hero-meta">
                            {artistAlbums.length} album{artistAlbums.length !== 1 ? "s" : ""} • {artistTracks.length} track{artistTracks.length !== 1 ? "s" : ""}
                        </div>
                    </div>
                </div>

                {artistAlbums.length > 0 && (
                    <div className="detail-projects">
                        <h2 className="detail-section-title">Albums</h2>
                        <div className="library-grid-view">
                            {artistAlbums.map((album) => {
                                const albumTrackWithArt = filteredTracks.find(
                                    t => (t.album || "Unknown Album") === album.name &&
                                        (t.artist || "Unknown Artist") === album.artist &&
                                        (t.remoteArtworkUrl || artworkUrls.has(t.id))
                                );
                                const albumArtUrl = albumTrackWithArt ? (albumTrackWithArt.remoteArtworkUrl || artworkUrls.get(albumTrackWithArt.id)) : null;
                                return (
                                    <div
                                        key={`${album.artist}::${album.name}`}
                                        className="library-card"
                                        onClick={() => {
                                            setSelectedAlbum({ name: album.name, artist: album.artist });
                                            setActiveTab("albums");
                                        }}
                                        onContextMenu={(e) => handleAlbumContextMenu(e, album.name, album.artist)}
                                        draggable
                                        onDragStart={(e) => {
                                            const albumTracks = filteredTracks.filter(t =>
                                                (t.album || "Unknown Album") === album.name &&
                                                (t.artist || "Unknown Artist") === album.artist
                                            );
                                            const payload = JSON.stringify({
                                                type: "album",
                                                name: album.name,
                                                artist: album.artist,
                                                tracks: albumTracks
                                            });
                                            e.dataTransfer.setData("application/json", payload);
                                            e.dataTransfer.setData("text/plain", payload);
                                            e.dataTransfer.effectAllowed = "copy";
                                        }}
                                    >
                                        {albumArtUrl ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={albumArtUrl} alt={album.name} className="library-card-artwork" />
                                        ) : (
                                            <div className="library-card-icon">💿</div>
                                        )}
                                        <div className="library-card-title">{album.name}</div>
                                        <div className="library-card-meta">
                                            {album.year || "Unknown Year"}
                                        </div>
                                        <div className="library-card-count">
                                            {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="detail-tracks">
                    <h2 className="detail-section-title">All Tracks</h2>
                    {renderTrackList(artistTracks)}
                </div>
            </div>
        );
    };

    const renderAlbumDetail = () => {
        if (!selectedAlbum) return null;
        const albumTracks = filteredTracks.filter(
            t => (t.album || "Unknown Album") === selectedAlbum.name &&
                (t.artist || "Unknown Artist") === selectedAlbum.artist
        );

        // Find cover art
        const trackWithArt = albumTracks.find(t => (t.remoteArtworkUrl || artworkUrls.has(t.id)));
        const artUrl = trackWithArt ? (trackWithArt.remoteArtworkUrl || artworkUrls.get(trackWithArt.id)) : null;

        const year = albumTracks.find(t => t.year)?.year;

        return (
            <div className="library-detail">
                <div className="library-detail-back">
                    <Button variant="ghost" onClick={() => setSelectedAlbum(null)}>← Back to Albums</Button>
                </div>

                <div className="detail-hero">
                    {artUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={artUrl} alt={selectedAlbum.name} className="detail-hero-artwork" />
                    ) : (
                        <div className="detail-hero-artwork" style={{ background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "80px" }}>
                            💿
                        </div>
                    )}
                    <div className="detail-hero-content">
                        <div className="detail-hero-label">Album</div>
                        <h1 className="detail-hero-title">{selectedAlbum.name}</h1>
                        <div className="detail-hero-meta">
                            <span
                                className="text-accent cursor-pointer hover:underline"
                                onClick={() => {
                                    setSelectedArtist(selectedAlbum.artist);
                                    setActiveTab("artists");
                                }}
                            >
                                {selectedAlbum.artist}
                            </span>
                            {year && ` • ${year}`} • {albumTracks.length} track{albumTracks.length !== 1 ? "s" : ""}
                        </div>
                        <div className="detail-hero-actions" style={{ marginTop: "var(--space-4)" }}>
                            <Button
                                variant="primary"
                                onClick={() => setTracksToAddToPlaylist(albumTracks)}
                                className="flex items-center gap-2"
                            >
                                <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>+</span> Add Album to Playlist
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="detail-tracks">
                    <h2 className="detail-section-title">Tracklist</h2>
                    {renderTrackList(albumTracks)}
                </div>
            </div>
        );
    };

    return (
        <AuthGate title="Connect your wallet to view your library.">
            <main className="library-page-main">
                <Card className="library-page-card">
                    <div className="library-header">
                        <h1 className="library-title">My Library</h1>
                        <div className="library-header-actions">
                            <div className="library-search">
                                <span className="library-search-icon">🔍</span>
                                <input
                                    type="text"
                                    placeholder="Search tracks, artists, albums..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="library-search-input"
                                />
                                {searchQuery && (
                                    <button className="library-search-clear" onClick={() => setSearchQuery("")}>
                                        ✕
                                    </button>
                                )}
                            </div>
                            <Link href="/settings">
                                <Button variant="primary">Library Settings</Button>
                            </Link>
                        </div>
                    </div>

                    {/* Tabs & Filters */}
                    <div className="library-tabs-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                        <div className="library-tabs">
                            <button
                                className={`library-tab ${activeTab === "tracks" ? "active" : ""}`}
                                onClick={() => { setActiveTab("tracks"); setSelectedArtist(null); setSelectedAlbum(null); }}
                            >
                                Tracks ({unifiedTracks.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "artists" ? "active" : ""}`}
                                onClick={() => { setActiveTab("artists"); setSelectedArtist(null); setSelectedAlbum(null); }}
                            >
                                Artists ({artists.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "albums" ? "active" : ""}`}
                                onClick={() => { setActiveTab("albums"); setSelectedArtist(null); setSelectedAlbum(null); setSelectedPlaylist(null); }}
                            >
                                Albums ({albums.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "playlists" ? "active" : ""}`}
                                onClick={() => { setActiveTab("playlists"); setSelectedArtist(null); setSelectedAlbum(null); setSelectedPlaylist(null); }}
                            >
                                Playlists ({playlistCount})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "stems" ? "active" : ""}`}
                                onClick={() => { setActiveTab("stems"); setSelectedArtist(null); setSelectedAlbum(null); setSelectedPlaylist(null); }}
                            >
                                Stems ({ownedStems.length})
                            </button>
                        </div>
                        
                        {activeTab === "tracks" && (
                            <div className="library-filter-toggle">
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400 hover:text-white transition-colors">
                                    <input 
                                        type="checkbox" 
                                        checked={showStems} 
                                        onChange={(e) => setShowStems(e.target.checked)}
                                        className="form-checkbox h-4 w-4 text-accent rounded border-gray-600 bg-gray-700 focus:ring-accent"
                                    />
                                    Show Stems
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Sidebar + Content Layout */}
                    <div className="library-layout">
                        <div className="library-content w-full">
                            {loading && tracks.length === 0 ? (
                                <div className="home-subtitle">Loading your library...</div>
                            ) : unifiedTracks.length === 0 && !isCollectionLoading ? (
                                <div className="home-subtitle">
                                    Your library is empty.{" "}
                                    <Link href="/settings" className="text-accent">Add library sources in Settings</Link>{" "}
                                    to get started!
                                </div>
                            ) : filteredTracks.length === 0 ? (
                                <div className="home-subtitle">
                                    {searchQuery.trim()
                                        ? <>No results found for &quot;{searchQuery}&quot;</>
                                        : activeTab === "tracks" && !showStems && ownedStems.length > 0
                                            ? <>No local tracks yet. Enable <strong>Show Stems</strong> to see your {ownedStems.length} owned stem{ownedStems.length !== 1 ? "s" : ""}.</>
                                            : <>No tracks to display.</>
                                    }
                                </div>
                            ) : (
                                <>
                                    {activeTab === "tracks" && renderTrackList(filteredTracks)}
                                    {activeTab === "artists" && (selectedArtist ? renderArtistDetail() : renderArtists())}
                                    {activeTab === "albums" && (selectedAlbum ? renderAlbumDetail() : renderAlbums())}
                                    {activeTab === "playlists" && (
                                        selectedPlaylist ? (
                                            <PlaylistDetail
                                                playlistId={selectedPlaylist.id}
                                                onBack={() => setSelectedPlaylist(null)}
                                            />
                                        ) : (
                                            <PlaylistTab
                                                tracks={tracks}
                                                artworkUrls={artworkUrls}
                                                onSelectPlaylist={(p) => setSelectedPlaylist(p)}
                                            />
                                        )
                                    )}
                                    {activeTab === "stems" && renderTrackList(ownedStems)}
                                </>
                            )}
                        </div>
                    </div>
                </Card>



                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        items={contextMenu.items}
                        onClose={() => setContextMenu(null)}
                    />
                )}

                {/* Artwork Preview Modal */}
                {hoveredArtwork && (
                    <div className="artwork-preview-overlay">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={hoveredArtwork.url}
                            alt={hoveredArtwork.title}
                            className="artwork-preview-image"
                        />
                        <MarqueeText text={hoveredArtwork.title} className="artwork-preview-title" />
                    </div>
                )}
            </main>
        </AuthGate>
    );
}
