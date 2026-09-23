"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import { useSearchParams, useRouter } from "next/navigation";
import {
    listTracks,
    deleteTrack,
    deleteTracks,
    getArtworkUrl,
    saveTracksMetadata,
    LocalTrack,
} from "../../lib/localLibrary";
import { getMyGenerations, getGenerationAnalytics, type GenerationListItem, type GenerationAnalytics, API_BASE } from "../../lib/api";

/** Resolve a potentially-relative backend path to a full URL */
function resolveUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

import { useAuth } from "../../components/auth/AuthProvider";
import { useZeroDev } from "../../components/auth/ZeroDevProviderClient";
import { type Address } from "viem"; // eslint-disable-line @typescript-eslint/no-unused-vars
import {
    Playlist,
    listPlaylists,
    getPlaylist,
    // removeTrackFromPlaylist,
    // reorderTracks,
    // renamePlaylist,
} from "../../lib/playlistStore";
import { formatDuration } from "../../lib/metadataExtractor";
import { useToast } from "../../components/ui/Toast";
import { PunchlineInventory } from "../../components/punchline/PunchlineInventory";
import { listMyPunchlineCollectibles, listMyPunchlineUnlocks, type PunchlineCollectibleItem, type PunchlineUnlockGrantItem } from "../../lib/api";
import {
    TrackUnavailableNote,
    isPlayableEntry,
    queueableTracks,
    resolveAvailability,
} from "../../components/library/trackAvailability";
import { useAutoScan } from "../../lib/useAutoScan";
import { groupByArtist, groupByAlbum } from "../../lib/libraryGrouping";
import { usePlayer } from "../../lib/playerContext";
import { useQueueActions } from "../../lib/useQueueActions";
import { QueueActionsButton } from "../../components/player/QueueActionsButton";
import { useUIStore } from "../../lib/uiStore";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { RemixCta } from "../../components/remix/RemixCta";
import { PlaylistTab } from "../../components/library/PlaylistTab";
import { PlaylistDetail } from "../../components/library/PlaylistDetail";
import { ContextMenu, ContextMenuItem } from "../../components/ui/ContextMenu";
import { TrackActionMenu } from "../../components/ui/TrackActionMenu";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MarqueeText } from "../../components/ui/MarqueeText";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import Link from "next/link";
import {
    libraryAlbumHref,
    libraryAlbumsHref,
    libraryArtistHref,
    libraryArtistsHref,
    publicReleaseHref,
    sharedLibraryReleaseId,
} from "../../lib/artistRoutes";

type ViewTab = "tracks" | "artists" | "albums" | "playlists" | "stems" | "ai_creations" | "moments";

function getRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

export default function LibraryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { playQueue, queue, removeFromQueue, currentTrack } = usePlayer();
    const queueActions = useQueueActions();
    const [tracks, setTracks] = useState<LocalTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const { addToast } = useToast();
    const autoScan = useAutoScan();
    const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
    const [hoveredArtwork, setHoveredArtwork] = useState<{ url: string; title: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTab, setActiveTab] = useState<ViewTab>("tracks");
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const { isPhone } = useBreakpoint();

    useEffect(() => {
        const container = tabsRef.current;
        if (!container) return;
        const active = container.querySelector<HTMLElement>(".library-tab.active");
        if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }, [activeTab]);
    const [selectedAlbum, setSelectedAlbum] = useState<{ name: string; artist: string; releaseId?: string | null } | null>(null);
    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
    const [playlistCount, setPlaylistCount] = useState(0);
    const { setTracksToAddToPlaylist, setResaleModal } = useUIStore();
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
    const [removalRequest, setRemovalRequest] = useState<{ tracks: LocalTrack[]; title: string; message: string } | null>(null);
    const lastClickedTrackIdRef = useRef<string | null>(null);
    const { address, token, smartAccountAddress } = useAuth();
    useZeroDev();
    
    // Remote collection state
    const [ownedStems, setOwnedStems] = useState<LocalTrack[]>([]);
    // Punchline collectible inventory (#487) — owned moments for the Moments tab.
    const [ownedMoments, setOwnedMoments] = useState<PunchlineCollectibleItem[]>([]);
    const [momentUnlocks, setMomentUnlocks] = useState<PunchlineUnlockGrantItem[]>([]);
    const [momentsLoading, setMomentsLoading] = useState(false);
    const [isCollectionLoading, setIsCollectionLoading] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, items: ContextMenuItem[] } | null>(null);

    // AI Creations state
    const [aiCreations, setAiCreations] = useState<GenerationListItem[]>([]);
    const [aiCreationsLoading, setAiCreationsLoading] = useState(false);
    const [selectedGeneration, setSelectedGeneration] = useState<GenerationListItem | null>(null);
    const [aiAnalytics, setAiAnalytics] = useState<GenerationAnalytics>({
        totalGenerations: 0,
        totalCost: 0,
        rateLimit: { remaining: 50, limit: 50, resetsAt: null },
    });

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
            const addressesToQuery = new Set<string>([address]);

            // Include the smart account address (on-chain identity) for collection queries
            if (smartAccountAddress && smartAccountAddress !== address) {
                addressesToQuery.add(smartAccountAddress);
            }

            // Minimal type for stem response to avoid 'any'
            type RemoteStem = {
                id: string;
                title: string;
                artist?: string;
                trackId?: string;
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
                sourceTrackId: stem.trackId,
                listingId: stem.activeListingId,
                purchaseDate: stem.purchasedAt,
                isOwned: true,
                remoteUrl: resolveUrl(stem.uri),
                remoteArtworkUrl: resolveUrl(stem.artworkUrl),
                previewUrl: resolveUrl(stem.previewUrl),
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
    }, [address, addToast, smartAccountAddress]);


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

    // Fetch AI creations when authenticated
    useEffect(() => {
        if (token) {
            setAiCreationsLoading(true);
            getMyGenerations(token)
                .then(setAiCreations)
                .catch(() => { /* ignore */ })
                .finally(() => setAiCreationsLoading(false));
            getGenerationAnalytics(token)
                .then(setAiAnalytics)
                .catch(() => { /* ignore */ });
        }
    }, [token]);

    // Owned Punchline moments for the Moments tab (#487); caller-scoped.
    useEffect(() => {
        if (!token) {
            setOwnedMoments([]);
            setMomentUnlocks([]);
            return;
        }
        let cancelled = false;
        setMomentsLoading(true);
        (async () => {
            try {
                const [mine, unlocks] = await Promise.all([
                    listMyPunchlineCollectibles(token),
                    listMyPunchlineUnlocks(token),
                ]);
                if (!cancelled) {
                    setOwnedMoments(mine.items);
                    setMomentUnlocks(unlocks.items);
                }
            } catch (error) {
                console.error("Error fetching punchline moments:", error);
            } finally {
                if (!cancelled) {
                    setMomentsLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    // Handle deep-linking from query params
    useEffect(() => {
        const tab = searchParams.get("tab");
        const artist = searchParams.get("artist");
        const album = searchParams.get("album");
        const albumArtist = searchParams.get("albumArtist");
        const releaseId = searchParams.get("release");

        if (artist) {
            router.replace(libraryArtistHref(artist));
        } else if (album && albumArtist) {
            setSelectedAlbum({ name: album, artist: albumArtist, releaseId });
            setActiveTab("albums");
        } else if (tab === "playlists") {
            setActiveTab("playlists");
            setSelectedAlbum(null);
            const playlistId = searchParams.get("playlist");
            // A stale or unreachable deep link falls back to the playlist list rather than a blank tab.
            if (playlistId) void getPlaylist(playlistId).then(setSelectedPlaylist).catch(() => setSelectedPlaylist(null));
        } else if (tab && ["tracks", "artists", "albums", "stems", "ai_creations", "moments"].includes(tab)) {
            setActiveTab(tab as ViewTab);
            setSelectedAlbum(null);
        }
    }, [router, searchParams]);

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
        // An unavailable track keeps its row in the library, but it is not
        // selectable for playback and never enters the queue (#1793).
        if (!isPlayableEntry(track)) return;
        const queue = queueableTracks(trackList);
        const index = queue.findIndex(t => t.id === track.id);
        void playQueue(queue, index >= 0 ? index : 0);
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

    const requestRemoval = (candidates: LocalTrack[], label: string) => {
        const removable = candidates.filter(track => !track.isOwned);
        if (removable.length === 0) {
            addToast({ type: "info", title: "Owned stems stay", message: "Owned stems stay in your library while you hold them." });
            return;
        }
        const count = removable.length;
        setRemovalRequest({
            tracks: removable,
            title: count === 1 ? "Remove from library?" : `Remove ${count} tracks?`,
            message: `Remove ${label} from your library? ${count} track${count === 1 ? "" : "s"} will be removed. Any owned stems stay in your library. This does not change purchases or playlists.`,
        });
    };

    const confirmRemoval = async () => {
        if (!removalRequest) return;
        const ids = [...new Set(removalRequest.tracks.map(track => track.id))];
        try {
            if (ids.length === 1) await deleteTrack(ids[0], removalRequest.tracks[0]);
            else await deleteTracks(ids, removalRequest.tracks);
            const removed = new Set(ids);
            setTracks(previous => previous.filter(track => !removed.has(track.id)));
            setSelectedTrackIds(previous => new Set([...previous].filter(id => !removed.has(id))));
            setArtworkUrls(previous => new Map([...previous].filter(([id]) => !removed.has(id))));
            if (selectedAlbum && !filteredTracks.some(track =>
                !removed.has(track.id) && (selectedAlbum.releaseId
                    ? track.releaseId === selectedAlbum.releaseId
                    : (track.album || "Unknown Album") === selectedAlbum.name &&
                      (track.albumArtist || track.artist || "Unknown Artist") === selectedAlbum.artist)
            )) setSelectedAlbum(null);
            for (let index = queue.length - 1; index >= 0; index--) {
                if (removed.has(queue[index].id)) removeFromQueue(index);
            }
            setRemovalRequest(null);
            addToast({ type: "success", title: "Removed from library", message: `${ids.length} track${ids.length === 1 ? "" : "s"} removed.` });
            void recordProductAnalytics(token, "library.removed", {
                source: "library",
                subjectType: "library",
                payload: { removedCount: ids.length, surface: "library" },
            });
        } catch {
            setRemovalRequest(null);
            addToast({ type: "error", title: "Could not remove", message: "Reload to check your library, then try again." });
        }
    };

    const handleStemDownload = async (stem: LocalTrack) => {
        if (!address || !token) {
            addToast({ type: "error", title: "Error", message: "Authentication required" });
            return;
        }

        addToast({ type: "info", title: "Downloading...", message: `Preparing ${stem.title}` });

        try {
            // Use the secured download endpoint with ownership verification
            const response = await fetch("/api/encryption/download", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                    stemId: stem.id,
                    walletAddress: smartAccountAddress || address,
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

    /* Shared by the right-click menus and the cards' overflow menus so both
     * queue exactly the same set. */
    const tracksForArtist = (artistName: string) =>
        filteredTracks.filter(t => (t.artist || "Unknown Artist") === artistName);

    const handleArtistContextMenu = (e: React.MouseEvent, artistName: string) => {
        e.preventDefault();
        const artistTracks = tracksForArtist(artistName);
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play Artist", icon: "▶️", onClick: () => playQueue(artistTracks, 0) },
                ...queueActions.contextMenuItems(artistTracks),
                { separator: true, label: "", onClick: () => { } },
                { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist(artistTracks) },
                { label: "Remove from library", icon: "🗑️", variant: "destructive", onClick: () => requestRemoval(artistTracks, artistName) },
            ]
        });
    };

    const handleAlbumContextMenu = (e: React.MouseEvent, albumName: string, artistName: string, albumTracks: LocalTrack[]) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play Album", icon: "▶️", onClick: () => playQueue(albumTracks, 0) },
                ...queueActions.contextMenuItems(albumTracks),
                { separator: true, label: "", onClick: () => { } },
                { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist(albumTracks) },
                { label: "Remove from library", icon: "🗑️", variant: "destructive", onClick: () => requestRemoval(albumTracks, `${albumName} by ${artistName}`) },
            ]
        });
    };

    const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
            // Queue actions disappear on an unavailable row rather than
            // sitting there doing nothing (#1793).
            ...(isPlayableEntry(track) ? queueActions.contextMenuItems(track) : []),
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
        }

        items.push(track.isOwned
            ? { label: "Why can't I remove this?", icon: "ℹ️", onClick: () => requestRemoval([track], track.title) }
            : { label: "Remove from library", icon: "🗑️", variant: "destructive", onClick: () => requestRemoval([track], track.title) });

        return items;
    };

    const renderTrackList = (trackList: LocalTrack[]) => {
        const removableTracks = trackList.filter(track => !track.isOwned);
        const selectedRemovable = removableTracks.filter(track => selectedTrackIds.has(track.id));
        return (
        <div className="library-list">
            {selectedRemovable.length > 0 && (
                <div className="library-selection-bar">
                    <span>{selectedRemovable.length} track{selectedRemovable.length === 1 ? "" : "s"} selected</span>
                    <button type="button" onClick={() => requestRemoval(selectedRemovable, `${selectedRemovable.length} selected track${selectedRemovable.length === 1 ? "" : "s"}`)}>
                        Remove {selectedRemovable.length} track{selectedRemovable.length === 1 ? "" : "s"}
                    </button>
                    <button type="button" onClick={() => setSelectedTrackIds(new Set())}>Clear selection</button>
                </div>
            )}
            <div className="library-item library-item-header">
                <div style={{ width: 28, flexShrink: 0 }}>
                    <input
                        type="checkbox"
                        checked={removableTracks.length > 0 && removableTracks.every(track => selectedTrackIds.has(track.id))}
                        disabled={removableTracks.length === 0}
                        onChange={(e) => {
                            if (e.target.checked) {
                                setSelectedTrackIds(new Set(removableTracks.map(track => track.id)));
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
                // Owned items resolve as playable whatever the catalog says —
                // a purchase is not affected by a withdrawal (#1793).
                const availability = resolveAvailability(track);
                return (
                    <div
                        key={track.id}
                        className={`library-item ${isMultiSelected ? "selected" : ""} ${selectedTrackId === track.id ? "focused" : ""} ${currentTrack?.id === track.id ? "playing" : ""} ${availability.playable ? "" : "is-unplayable"}`}
                        aria-disabled={availability.playable ? undefined : true}
                        style={availability.playable ? undefined : { opacity: 0.55 }}
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
                                        if (!trackList[i].isOwned) next.add(trackList[i].id);
                                    }
                                    return next;
                                });
                            } else if (e.ctrlKey || e.metaKey) {
                                // Ctrl/Cmd+click: toggle single
                                setSelectedTrackIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(track.id)) next.delete(track.id);
                                    else if (!track.isOwned) next.add(track.id);
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
                                disabled={track.isOwned}
                                title={track.isOwned ? "Owned stems stay in your library while you hold them" : "Select track"}
                                onChange={() => {
                                    setSelectedTrackIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(track.id)) next.delete(track.id);
                                        else if (!track.isOwned) next.add(track.id);
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
                            {track.stemType && track.tokenId ? (
                                <span
                                    className="clickable hover:underline"
                                    title="Open stem page"
                                    role="link"
                                    tabIndex={0}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(`/stem/${track.tokenId}`);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            router.push(`/stem/${track.tokenId}`);
                                        }
                                    }}
                                >
                                    {track.title}
                                </span>
                            ) : (
                                track.title
                            )}
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
                            <TrackUnavailableNote availability={availability} />
                        </div>
                        <div
                            className="library-item-artist clickable hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                                const target = track.artist;
                                if (target) router.push(libraryArtistHref(target));
                            }}
                        >
                            {track.artist || "Unknown Artist"}
                        </div>
                        <div
                            className="library-item-album"
                            onClick={(e) => {
                                if (!track.album) return;
                                e.stopPropagation();
                                const albumArtist = track.albumArtist || track.artist || "Unknown Artist";
                                router.push(libraryAlbumHref(track.album, albumArtist, track.releaseId));
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
                            {track.stemType && track.sourceTrackId && (
                                <span onClick={(e) => e.stopPropagation()}>
                                    <RemixCta
                                        trackId={track.sourceTrackId}
                                        stemIds={[track.id]}
                                        trackTitle={track.title}
                                        variant="chip"
                                        hideWhenLicenseRequired
                                    />
                                </span>
                            )}
                            <TrackActionMenu
                                actions={[
                                    ...(availability.playable ? queueActions.actionMenuItems(track) : []),
                                    { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist([track]) },
                                    ...(track.stemType && track.tokenId
                                        ? [{
                                            label: "View stem page",
                                            icon: "🎛️",
                                            onClick: () => router.push(`/stem/${track.tokenId}`),
                                        }]
                                        : []),
                                    track.isOwned
                                        ? { label: "Why can't I remove this?", icon: "ℹ️", onClick: () => requestRemoval([track], track.title) }
                                        : { label: "Remove from library", icon: "🗑️", variant: "destructive" as const, onClick: () => requestRemoval([track], track.title) },
                                ]}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
    };

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
                        onClick={() => router.push(libraryArtistHref(artist.name))}
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
                        {/* Queueing a whole artist was right-click only, so most
                          * people never found it. */}
                        <div className="library-card-actions" onClick={(e) => e.stopPropagation()}>
                            <TrackActionMenu actions={[
                                ...queueActions.actionMenuItems(tracksForArtist(artist.name)),
                                { label: "Remove from library", icon: "🗑️", variant: "destructive", onClick: () => requestRemoval(tracksForArtist(artist.name), artist.name) },
                            ]} />
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
                        onClick={() => router.push(libraryAlbumHref(
                            album.name,
                            album.artist,
                            sharedLibraryReleaseId(album.tracks),
                        ))}
                        onContextMenu={(e) => handleAlbumContextMenu(e, album.name, album.artist, album.tracks)}
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
                        <div className="library-card-actions" onClick={(e) => e.stopPropagation()}>
                            <TrackActionMenu actions={[
                                ...queueActions.actionMenuItems(album.tracks),
                                { label: "Remove from library", icon: "🗑️", variant: "destructive", onClick: () => requestRemoval(album.tracks, `${album.name} by ${album.artist}`) },
                            ]} />
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderAlbumDetail = () => {
        if (!selectedAlbum) return null;
        const albumTracks = filteredTracks.filter(
            t => selectedAlbum.releaseId
                ? t.releaseId === selectedAlbum.releaseId
                : (t.album || "Unknown Album") === selectedAlbum.name &&
                    (t.albumArtist || t.artist || "Unknown Artist") === selectedAlbum.artist
        );
        const catalogReleaseId = selectedAlbum.releaseId || sharedLibraryReleaseId(albumTracks);

        // Find cover art
        const trackWithArt = albumTracks.find(t => (t.remoteArtworkUrl || artworkUrls.has(t.id)));
        const artUrl = trackWithArt ? (trackWithArt.remoteArtworkUrl || artworkUrls.get(trackWithArt.id)) : null;

        const year = albumTracks.find(t => t.year)?.year;

        return (
            <div className="library-detail">
                <div className="library-detail-back">
                    <Button variant="ghost" onClick={() => router.push(libraryAlbumsHref())}>← Back to Albums</Button>
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
                        <div className="detail-hero-label">My Library · Album</div>
                        <h1 className="detail-hero-title">{selectedAlbum.name}</h1>
                        <div className="detail-hero-meta">
                            <span
                                className="text-accent cursor-pointer hover:underline"
                                onClick={() => router.push(libraryArtistHref(selectedAlbum.artist))}
                            >
                                {selectedAlbum.artist}
                            </span>
                            {year && ` • ${year}`} • {albumTracks.length} track{albumTracks.length !== 1 ? "s" : ""}
                        </div>
                        <div className="detail-hero-actions" style={{ marginTop: "var(--space-4)" }}>
                            <Button
                                variant="primary"
                                onClick={() => playQueue(albumTracks, 0)}
                                disabled={albumTracks.length === 0}
                            >
                                ▶ Play Album
                            </Button>
                            <QueueActionsButton
                                tracks={albumTracks}
                                label="Queue album"
                                nextLabel="Play album next"
                                disabled={albumTracks.length === 0}
                            />
                            <Button
                                variant="ghost"
                                onClick={() => setTracksToAddToPlaylist(albumTracks)}
                            >
                                Add Album to Playlist
                            </Button>
                            {catalogReleaseId ? (
                                <Link href={publicReleaseHref(catalogReleaseId)}>
                                    <Button variant="ghost">View catalog release</Button>
                                </Link>
                            ) : null}
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
                                    placeholder={isPhone ? "Search library" : "Search tracks, artists, albums..."}
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
                        <div className="library-tabs" ref={tabsRef}>
                            <button
                                className={`library-tab ${activeTab === "tracks" ? "active" : ""}`}
                                onClick={() => router.push("/library?tab=tracks")}
                            >
                                Tracks ({unifiedTracks.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "artists" ? "active" : ""}`}
                                onClick={() => router.push(libraryArtistsHref())}
                            >
                                Artists ({artists.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "albums" ? "active" : ""}`}
                                onClick={() => router.push(libraryAlbumsHref())}
                            >
                                Albums ({albums.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "playlists" ? "active" : ""}`}
                                onClick={() => router.push("/library?tab=playlists")}
                            >
                                Playlists ({playlistCount})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "stems" ? "active" : ""}`}
                                onClick={() => router.push("/library?tab=stems")}
                            >
                                Stems ({ownedStems.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "ai_creations" ? "active" : ""}`}
                                onClick={() => router.push("/library?tab=ai_creations")}
                            >
                                ✨ AI Creations ({aiCreations.length})
                            </button>
                            <button
                                className={`library-tab ${activeTab === "moments" ? "active" : ""}`}
                                onClick={() => router.push("/library?tab=moments")}
                            >
                                🎤 Moments ({ownedMoments.length})
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
                            {loading && tracks.length === 0 && activeTab !== "playlists" && activeTab !== "ai_creations" ? (
                                <div className="home-subtitle">Loading your library...</div>
                            ) : activeTab !== "playlists" && activeTab !== "ai_creations" && unifiedTracks.length === 0 && !isCollectionLoading ? (
                                <div className="library-empty">
                                    <div className="library-empty__icon" aria-hidden="true">
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M9 18V5l12-2v13" />
                                            <circle cx="6" cy="18" r="3" />
                                            <circle cx="18" cy="16" r="3" />
                                        </svg>
                                    </div>
                                    <h2 className="library-empty__title">Your library is quiet</h2>
                                    <p className="library-empty__text">
                                        Index a local music folder to play your own files and train the AI DJ, or explore the on-chain catalog to start collecting stems and releases.
                                    </p>
                                    <div className="library-empty__actions">
                                        <Link href="/settings">
                                            <Button variant="primary">Add a music folder</Button>
                                        </Link>
                                        <Link href="/">
                                            <Button variant="ghost">Browse the catalog</Button>
                                        </Link>
                                    </div>
                                </div>
                            ) : activeTab !== "playlists" && activeTab !== "ai_creations" && filteredTracks.length === 0 ? (
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
                                    {activeTab === "artists" && renderArtists()}
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
                                    {activeTab === "moments" && (
                                        <PunchlineInventory
                                            items={ownedMoments}
                                            unlocks={momentUnlocks}
                                            loading={momentsLoading}
                                            signedIn={!!token}
                                        />
                                    )}
                                    {activeTab === "ai_creations" && (
                                        <>
                                            <div className="create-analytics-strip ai-analytics-header">
                                                <div className="create-analytics-item">
                                                    <span className="create-analytics-label">Generations</span>
                                                    <span className="create-analytics-value">{aiAnalytics.totalGenerations}</span>
                                                </div>
                                                <div className="create-analytics-divider" />
                                                <div className="create-analytics-item">
                                                    <span className="create-analytics-label">Total Cost</span>
                                                    <span className="create-analytics-value">${aiAnalytics.totalCost.toFixed(2)}</span>
                                                </div>
                                                <div className="create-analytics-divider" />
                                                <div className="create-analytics-item">
                                                    <span className="create-analytics-label">Rate Limit</span>
                                                    <span className={`create-analytics-value rate-status ${aiAnalytics.rateLimit.remaining === 0 ? "exhausted" : aiAnalytics.rateLimit.remaining <= 2 ? "low" : "ok"}`}>
                                                        {aiAnalytics.rateLimit.remaining}/{aiAnalytics.rateLimit.limit}
                                                    </span>
                                                </div>
                                            </div>
                                            {aiCreationsLoading ? (
                                                <div className="home-subtitle">Loading AI creations...</div>
                                            ) : aiCreations.length === 0 ? (
                                                <div className="home-subtitle">
                                                    No AI-generated tracks yet.{" "}
                                                    <Link href="/create" className="text-accent">Create your first track</Link>
                                                </div>
                                            ) : (
                                                <div className="library-grid-view">
                                                    {aiCreations.map((gen) => {
                                                        const timeAgo = getRelativeTime(gen.generatedAt);
                                                        return (
                                                            <div
                                                                key={gen.trackId}
                                                                className="library-card ai-creation-card"
                                                                onClick={() => setSelectedGeneration(gen)}
                                                            >
                                                                <div className="library-card-icon ai-creation-icon">🤖</div>
                                                                <div className="library-card-title ai-creation-prompt">
                                                                    {gen.prompt.length > 60 ? gen.prompt.slice(0, 57) + "..." : gen.prompt}
                                                                </div>
                                                                <div className="library-card-meta">
                                                                    {timeAgo} • {gen.durationSeconds}s
                                                                </div>
                                                                <div className="ai-creation-actions">
                                                                    <button
                                                                        className="ai-creation-play-btn"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const asTrack: LocalTrack = {
                                                                                id: gen.trackId,
                                                                                catalogTrackId: gen.trackId,
                                                                                artistId: gen.artistId,
                                                                                title: gen.prompt.slice(0, 60),
                                                                                artist: "AI (Lyria)",
                                                                                album: "AI Creations",
                                                                                albumArtist: "AI (Lyria)",
                                                                                year: null,
                                                                                genre: "AI Generated",
                                                                                duration: gen.durationSeconds,
                                                                                createdAt: gen.generatedAt,
                                                                                source: "remote",
                                                                                remoteUrl: gen.audioUri ? (gen.audioUri.startsWith('http') ? gen.audioUri : `${API_BASE}/${gen.audioUri.replace(/^\//, '')}`) : undefined,
                                                                            };
                                                                            void playQueue([asTrack], 0);
                                                                        }}
                                                                        type="button"
                                                                        title="Play"
                                                                    >
                                                                        ▶
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Generation Detail Modal */}
                                            {selectedGeneration && (
                                                <div className="ai-detail-overlay" onClick={() => setSelectedGeneration(null)}>
                                                    <div className="ai-detail-modal" onClick={(e) => e.stopPropagation()}>
                                                        <button className="ai-detail-close" onClick={() => setSelectedGeneration(null)} type="button">✕</button>
                                                        <h3 className="ai-detail-title">Generation Details</h3>
                                                        <div className="ai-detail-field">
                                                            <span className="ai-detail-label">Prompt</span>
                                                            <p className="ai-detail-value">{selectedGeneration.prompt}</p>
                                                        </div>
                                                        {selectedGeneration.negativePrompt && (
                                                            <div className="ai-detail-field">
                                                                <span className="ai-detail-label">Negative Prompt</span>
                                                                <p className="ai-detail-value">{selectedGeneration.negativePrompt}</p>
                                                            </div>
                                                        )}
                                                        <div className="ai-detail-grid">
                                                            <div className="ai-detail-field">
                                                                <span className="ai-detail-label">Provider</span>
                                                                <span className="ai-detail-value">{selectedGeneration.provider}</span>
                                                            </div>
                                                            <div className="ai-detail-field">
                                                                <span className="ai-detail-label">Seed</span>
                                                                <span className="ai-detail-value">{selectedGeneration.seed ?? "Random"}</span>
                                                            </div>
                                                            <div className="ai-detail-field">
                                                                <span className="ai-detail-label">Duration</span>
                                                                <span className="ai-detail-value">{selectedGeneration.durationSeconds}s</span>
                                                            </div>
                                                            <div className="ai-detail-field">
                                                                <span className="ai-detail-label">Cost</span>
                                                                <span className="ai-detail-value">${selectedGeneration.cost.toFixed(2)}</span>
                                                            </div>
                                                        </div>
                                                        <div className="ai-detail-field">
                                                            <span className="ai-detail-label">Generated</span>
                                                            <span className="ai-detail-value">{new Date(selectedGeneration.generatedAt).toLocaleString()}</span>
                                                        </div>
                                                        <div className="ai-detail-actions">
                                                            <button
                                                                className="result-action-btn"
                                                                onClick={() => {
                                                                    const asTrack: LocalTrack = {
                                                                        id: selectedGeneration.trackId,
                                                                        catalogTrackId: selectedGeneration.trackId,
                                                                        artistId: selectedGeneration.artistId,
                                                                        title: selectedGeneration.prompt.slice(0, 60),
                                                                        artist: "AI (Lyria)",
                                                                        album: "AI Creations",
                                                                        albumArtist: "AI (Lyria)",
                                                                        year: null,
                                                                        genre: "AI Generated",
                                                                        duration: selectedGeneration.durationSeconds,
                                                                        createdAt: selectedGeneration.generatedAt,
                                                                        source: "remote",
                                                                        remoteUrl: selectedGeneration.audioUri ? (selectedGeneration.audioUri.startsWith('http') ? selectedGeneration.audioUri : `${API_BASE}/${selectedGeneration.audioUri.replace(/^\//, '')}`) : undefined,
                                                                    };
                                                                    void playQueue([asTrack], 0);
                                                                }}
                                                                type="button"
                                                            >
                                                                ▶ Play
                                                            </button>
                                                            <Link href="/create">
                                                                <button className="result-action-btn primary" type="button">
                                                                    ✨ Create New
                                                                </button>
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
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

                <ConfirmDialog
                    isOpen={removalRequest !== null}
                    title={removalRequest?.title ?? "Remove from library?"}
                    message={removalRequest?.message ?? ""}
                    confirmLabel="Remove from library"
                    variant="danger"
                    onConfirm={confirmRemoval}
                    onCancel={() => setRemovalRequest(null)}
                />

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
