"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import {
    listTracks,
    deleteTrack,
    getTrackUrl,
    LocalTrack,
} from "../../lib/localLibrary";
import { formatDuration } from "../../lib/metadataExtractor";
import { useToast } from "../../components/ui/Toast";
import { useAutoScan } from "../../lib/useAutoScan";
import { groupByArtist, groupByAlbum, Artist, Album } from "../../lib/libraryGrouping";
import Link from "next/link";

type ViewTab = "tracks" | "artists" | "albums";

export default function LibraryPage() {
    const [tracks, setTracks] = useState<LocalTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
    const [activeTab, setActiveTab] = useState<ViewTab>("tracks");
    const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
    const [selectedAlbum, setSelectedAlbum] = useState<{ name: string; artist: string } | null>(null);
    const { addToast } = useToast();
    const autoScan = useAutoScan();

    // Grouped data
    const artists = useMemo(() => groupByArtist(tracks), [tracks]);
    const albums = useMemo(() => groupByAlbum(tracks), [tracks]);

    const loadTracks = async () => {
        setLoading(true);
        const items = await listTracks();
        setTracks(items);
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

    const handlePlay = async (track: LocalTrack) => {
        if (audio) {
            audio.pause();
            URL.revokeObjectURL(audio.src);
        }
        const url = await getTrackUrl(track);
        if (!url) {
            addToast({ type: "error", title: "Error", message: "Could not load track" });
            return;
        }
        const newAudio = new Audio(url);
        newAudio.play();
        newAudio.onended = () => setPlaying(null);
        setAudio(newAudio);
        setPlaying(track.id);
    };

    const handleStop = () => {
        if (audio) {
            audio.pause();
            URL.revokeObjectURL(audio.src);
            setAudio(null);
            setPlaying(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (playing === id) handleStop();
        await deleteTrack(id);
        addToast({ type: "success", title: "Deleted", message: "Track removed from library" });
        loadTracks();
    };

    const renderTrackList = (trackList: LocalTrack[]) => (
        <div className="library-list">
            {trackList.map((track) => (
                <div key={track.id} className="library-item">
                    <div className="library-item-info">
                        <div className="library-item-title">{track.title}</div>
                        <div className="library-item-meta">
                            {track.artist || "Unknown Artist"}
                            {track.album && ` • ${track.album}`}
                            {track.year && ` (${track.year})`}
                        </div>
                    </div>
                    <div className="library-item-duration">
                        {formatDuration(track.duration)}
                    </div>
                    <div className="library-item-actions">
                        {playing === track.id ? (
                            <Button variant="ghost" onClick={handleStop}>Stop</Button>
                        ) : (
                            <Button variant="primary" onClick={() => handlePlay(track)}>Play</Button>
                        )}
                        <Button variant="ghost" onClick={() => handleDelete(track.id)}>Delete</Button>
                    </div>
                </div>
            ))}
        </div>
    );

    const renderArtists = () => (
        <div className="library-grid-view">
            {artists.map((artist) => (
                <div
                    key={artist.name}
                    className="library-card"
                    onClick={() => setSelectedArtist(artist.name)}
                >
                    <div className="library-card-icon">🎤</div>
                    <div className="library-card-title">{artist.name}</div>
                    <div className="library-card-meta">
                        {artist.trackCount} track{artist.trackCount !== 1 ? "s" : ""}
                        {artist.albums.length > 0 && ` • ${artist.albums.length} album${artist.albums.length !== 1 ? "s" : ""}`}
                    </div>
                </div>
            ))}
        </div>
    );

    const renderAlbums = () => (
        <div className="library-grid-view">
            {albums.map((album) => (
                <div
                    key={`${album.artist}::${album.name}`}
                    className="library-card"
                    onClick={() => setSelectedAlbum({ name: album.name, artist: album.artist })}
                >
                    <div className="library-card-icon">💿</div>
                    <div className="library-card-title">{album.name}</div>
                    <div className="library-card-meta">
                        {album.artist}
                        {album.year && ` • ${album.year}`}
                    </div>
                    <div className="library-card-count">
                        {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                    </div>
                </div>
            ))}
        </div>
    );

    const renderArtistDetail = () => {
        const artistTracks = tracks.filter(t => (t.artist || "Unknown Artist") === selectedArtist);
        return (
            <div className="library-detail">
                <Button variant="ghost" onClick={() => setSelectedArtist(null)}>← Back to Artists</Button>
                <h2 className="library-detail-title">🎤 {selectedArtist}</h2>
                <p className="library-detail-meta">{artistTracks.length} tracks</p>
                {renderTrackList(artistTracks)}
            </div>
        );
    };

    const renderAlbumDetail = () => {
        if (!selectedAlbum) return null;
        const albumTracks = tracks.filter(
            t => (t.album || "Unknown Album") === selectedAlbum.name &&
                (t.artist || "Unknown Artist") === selectedAlbum.artist
        );
        return (
            <div className="library-detail">
                <Button variant="ghost" onClick={() => setSelectedAlbum(null)}>← Back to Albums</Button>
                <h2 className="library-detail-title">💿 {selectedAlbum.name}</h2>
                <p className="library-detail-meta">{selectedAlbum.artist}</p>
                {renderTrackList(albumTracks)}
            </div>
        );
    };

    return (
        <AuthGate title="Connect your wallet to view your library.">
            <main className="library-grid">
                <Card>
                    <div className="library-header">
                        <h1 className="library-title">My Library</h1>
                        <Link href="/import">
                            <Button variant="primary">Import Music</Button>
                        </Link>
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
                    ) : (
                        <>
                            {activeTab === "tracks" && renderTrackList(tracks)}
                            {activeTab === "artists" && (selectedArtist ? renderArtistDetail() : renderArtists())}
                            {activeTab === "albums" && (selectedAlbum ? renderAlbumDetail() : renderAlbums())}
                        </>
                    )}
                </Card>
            </main>
        </AuthGate>
    );
}
