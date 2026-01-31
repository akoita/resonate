"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import { useSearchParams, useRouter } from "next/navigation";
import {
    listTracks,
    deleteTrack,
    getArtworkUrl,
    LocalTrack,
} from "../../lib/localLibrary";
import {
    Playlist,
    // getPlaylist, // removed unused import
    removeTrackFromPlaylist,
    reorderTracks,
    renamePlaylist,
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
import { MarqueeText } from "../../components/ui/MarqueeText";
import Link from "next/link";

type ViewTab = "tracks" | "artists" | "albums" | "playlists";

export default function LibraryPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryTab = searchParams.get("tab");
    const { playQueue, stop: handleStop, currentTrack, isPlaying, playNext, addToQueue } = usePlayer();
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
    const { tracksToAddToPlaylist, setTracksToAddToPlaylist } = useUIStore();
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, items: ContextMenuItem[] } | null>(null);

    // Filtered tracks
    const filteredTracks = useMemo(() => {
        if (!searchQuery.trim()) return tracks;
        const q = searchQuery.toLowerCase();
        return tracks.filter(t =>
            t.title.toLowerCase().includes(q) ||
            (t.artist && t.artist.toLowerCase().includes(q)) ||
            (t.album && t.album.toLowerCase().includes(q))
        );
    }, [tracks, searchQuery]);

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

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadTracks();
    }, []);

    // Handle deep-linking from query params
    useEffect(() => {
        const tab = searchParams.get("tab");
        const artist = searchParams.get("artist");
        const album = searchParams.get("album");
        const albumArtist = searchParams.get("albumArtist");

        if (tab === "playlists") {
            // eslint-disable-next-line react-hooks/set-state-in-effect
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
                // eslint-disable-next-line react-hooks/set-state-in-effect
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

    const handlePlay = (track: LocalTrack, trackList: LocalTrack[]) => {
        const index = trackList.findIndex(t => t.id === track.id);
        void playQueue(trackList, index >= 0 ? index : 0);
    };

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
    }, [selectedTrackId, tracks]);

    const handleDelete = async (id: string) => {
        if (currentTrack?.id === id) handleStop();
        await deleteTrack(id);
        addToast({ type: "success", title: "Deleted", message: "Track removed from library" });
        loadTracks();
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

    const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => [
        { label: "Play Next", icon: "⏭️", onClick: () => { playNext(track); addToast({ type: "success", title: "Queued", message: `"${track.title}" will play next` }); } },
        { label: "Add to Queue", icon: "➕", onClick: () => { addToQueue(track); addToast({ type: "success", title: "Queued", message: `Added "${track.title}" to queue` }); } },
        { separator: true, label: "", onClick: () => { } },
        { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist([track]) },
        { separator: true, label: "", onClick: () => { } },
        { label: "Delete from Library", icon: "🗑️", variant: "destructive", onClick: () => handleDelete(track.id) },
    ];

    const renderTrackList = (trackList: LocalTrack[]) => (
        <div className="library-list">
            <div className="library-item library-item-header">
                <div></div>
                <div>Title</div>
                <div>Artist</div>
                <div>Album</div>
                <div>Duration</div>
                <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {trackList.map((track) => {
                const artUrl = artworkUrls.get(track.id);
                return (
                    <div
                        key={track.id}
                        className={`library-item ${selectedTrackId === track.id ? "selected" : ""} ${currentTrack?.id === track.id ? "playing" : ""}`}
                        draggable
                        onClick={() => {
                            setSelectedTrackId(track.id);
                            handlePlay(track, trackList);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, track)}
                        onDragStart={(e) => {
                            const payload = JSON.stringify({
                                type: "track",
                                id: track.id,
                                title: track.title,
                                artist: track.artist
                            });
                            e.dataTransfer.setData("application/json", payload);
                            e.dataTransfer.setData("text/plain", payload);
                            e.dataTransfer.effectAllowed = "copy";
                        }}
                    >
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
                        <div className="library-item-title">{track.title}</div>
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
                        </div>
                        <div className="library-item-actions">
                            <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setTracksToAddToPlaylist([track]); }}>+ Playlist</Button>
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
                const trackWithArt = tracks.find(t => (t.artist || "Unknown Artist") === artist.name && artworkUrls.has(t.id));
                const artUrl = trackWithArt ? artworkUrls.get(trackWithArt.id) : null;
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
                const trackWithArt = tracks.find(
                    t => (t.album || "Unknown Album") === album.name &&
                        (t.artist || "Unknown Artist") === album.artist &&
                        artworkUrls.has(t.id)
                );
                const artUrl = trackWithArt ? artworkUrls.get(trackWithArt.id) : null;
                return (
                    <div
                        key={`${album.artist}::${album.name}`}
                        className="library-card"
                        onClick={() => setSelectedAlbum({ name: album.name, artist: album.artist })}
                        onContextMenu={(e) => handleAlbumContextMenu(e, album.name, album.artist)}
                        draggable
                        onDragStart={(e) => {
                            const albumTracks = tracks.filter(t =>
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
        const artistTracks = tracks.filter(t => (t.artist || "Unknown Artist") === selectedArtist);
        const artistAlbums = albums.filter(a => (a.artist || "Unknown Artist") === selectedArtist);

        // Find best image for artist
        const trackWithArt = artistTracks.find(t => artworkUrls.has(t.id));
        const artUrl = trackWithArt ? artworkUrls.get(trackWithArt.id) : null;

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
                                const albumTrackWithArt = tracks.find(
                                    t => (t.album || "Unknown Album") === album.name &&
                                        (t.artist || "Unknown Artist") === album.artist &&
                                        artworkUrls.has(t.id)
                                );
                                const albumArtUrl = albumTrackWithArt ? artworkUrls.get(albumTrackWithArt.id) : null;
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
                                            const albumTracks = tracks.filter(t =>
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
        const albumTracks = tracks.filter(
            t => (t.album || "Unknown Album") === selectedAlbum.name &&
                (t.artist || "Unknown Artist") === selectedAlbum.artist
        );

        // Find cover art
        const trackWithArt = albumTracks.find(t => artworkUrls.has(t.id));
        const artUrl = trackWithArt ? artworkUrls.get(trackWithArt.id) : null;

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

                    {/* Tabs */}
                    <div className="library-tabs">
                        <button
                            className={`library-tab ${activeTab === "tracks" ? "active" : ""}`}
                            onClick={() => { setActiveTab("tracks"); setSelectedArtist(null); setSelectedAlbum(null); }}
                        >
                            Tracks ({tracks.length})
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
                            Playlists
                        </button>
                    </div>

                    {/* Sidebar + Content Layout */}
                    <div className="library-layout">
                        <div className="library-content w-full">
                            {loading ? (
                                <div className="home-subtitle">Loading your library...</div>
                            ) : tracks.length === 0 ? (
                                <div className="home-subtitle">
                                    Your library is empty.{" "}
                                    <Link href="/settings" className="text-accent">Add library sources in Settings</Link>{" "}
                                    to get started!
                                </div>
                            ) : filteredTracks.length === 0 ? (
                                <div className="home-subtitle">
                                    No results found for &quot;{searchQuery}&quot;
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
