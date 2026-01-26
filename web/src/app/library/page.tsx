"use client";

import { useEffect, useState } from "react";
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
import Link from "next/link";

export default function LibraryPage() {
    const [tracks, setTracks] = useState<LocalTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
    const { addToast } = useToast();
    const autoScan = useAutoScan();

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

    // Real-time: append newly scanned tracks as they're indexed
    useEffect(() => {
        if (autoScan.newTracks.length > 0) {
            // Get the latest track added
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

                    {loading ? (
                        <div className="home-subtitle">Loading your library...</div>
                    ) : tracks.length === 0 ? (
                        <div className="home-subtitle">
                            Your library is empty.{" "}
                            <Link href="/import" className="text-accent">
                                Import some tracks
                            </Link>{" "}
                            to get started!
                        </div>
                    ) : (
                        <div className="library-list">
                            {tracks.map((track) => (
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
                                            <Button variant="ghost" onClick={handleStop}>
                                                Stop
                                            </Button>
                                        ) : (
                                            <Button variant="primary" onClick={() => handlePlay(track)}>
                                                Play
                                            </Button>
                                        )}
                                        <Button variant="ghost" onClick={() => handleDelete(track.id)}>
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </main>
        </AuthGate>
    );
}
