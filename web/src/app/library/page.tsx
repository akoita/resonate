"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import {
    listTracks,
    deleteTrack,
    getArtworkUrl,
    LocalTrack,
} from "../../lib/localLibrary";
import { formatDuration } from "../../lib/metadataExtractor";
import { useToast } from "../../components/ui/Toast";
import { useAutoScan } from "../../lib/useAutoScan";
import { groupByArtist, groupByAlbum } from "../../lib/libraryGrouping";
import { usePlayer } from "../../lib/playerContext";
import Link from "next/link";

type ViewTab = "tracks" | "artists" | "albums";

export default function LibraryPage() {
    const { playQueue, stop: handleStop, currentTrack, isPlaying } = usePlayer();
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

        // Load artwork for all tracks
        const urls = new Map<string, string>();
        for (const track of items) {
            const url = await getArtworkUrl(track);
            if (url) urls.set(track.id, url);
        }
        setArtworkUrls(urls);
        setLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadTracks();
    }, []);

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

    const handleDelete = async (id: string) => {
        if (currentTrack?.id === id) handleStop();
        await deleteTrack(id);
        addToast({ type: "success", title: "Deleted", message: "Track removed from library" });
        loadTracks();
    };

    const renderTrackList = (trackList: LocalTrack[]) => (
        <div className="library-list">
            {trackList.map((track) => {
                const artUrl = artworkUrls.get(track.id);
                return (
                    <div key={track.id} className="library-item">
                        <div
                            className="library-item-artwork"
                            onMouseEnter={() => artUrl && setHoveredArtwork({ url: artUrl, title: track.title })}
                            onMouseLeave={() => setHoveredArtwork(null)}
                        >
                            {artUrl ? (
                                <img src={artUrl} alt={track.title} />
                            ) : (
                                <div className="library-item-artwork-placeholder">🎵</div>
                            )}
                        </div>
                        <div className="library-item-info">
                            <div className="library-item-title">{track.title}</div>
                            <div className="library-item-meta">
                                <span
                                    className="cursor-pointer hover:text-accent transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedArtist(track.artist || "Unknown Artist");
                                        setActiveTab("artists");
                                    }}
                                >
                                    {track.artist || "Unknown Artist"}
                                </span>
                                {track.album && ` • ${track.album}`}
                                {track.year && ` (${track.year})`}
                            </div>
                        </div>
                        <div className="library-item-duration">
                            {formatDuration(track.duration)}
                        </div>
                        <div className="library-item-actions">
                            {currentTrack?.id === track.id && isPlaying ? (
                                <Button variant="ghost" onClick={handleStop}>Stop</Button>
                            ) : (
                                <Button variant="primary" onClick={() => handlePlay(track, trackList)}>Play</Button>
                            )}
                            <Button variant="ghost" onClick={() => handleDelete(track.id)}>Delete</Button>
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
                        onClick={() => setSelectedArtist(artist.name)}
                    >
                        {artUrl ? (
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
                    >
                        {artUrl ? (
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
                                    >
                                        {albumArtUrl ? (
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
            <main className="library-grid">
                <Card>
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
                            <Link href="/import">
                                <Button variant="primary">Import Music</Button>
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
                            onClick={() => { setActiveTab("albums"); setSelectedArtist(null); setSelectedAlbum(null); }}
                        >
                            Albums ({albums.length})
                        </button>
                    </div>

                    {loading ? (
                        <div className="home-subtitle">Loading your library...</div>
                    ) : tracks.length === 0 ? (
                        <div className="home-subtitle">
                            Your library is empty.{" "}
                            <Link href="/import" className="text-accent">Import some tracks</Link>{" "}
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
                        </>
                    )}
                </Card>

                {/* Artwork Preview Modal */}
                {hoveredArtwork && (
                    <div className="artwork-preview-overlay">
                        <img
                            src={hoveredArtwork.url}
                            alt={hoveredArtwork.title}
                            className="artwork-preview-image"
                        />
                        <div className="artwork-preview-title">{hoveredArtwork.title}</div>
                    </div>
                )}
            </main>
        </AuthGate>
    );
}
