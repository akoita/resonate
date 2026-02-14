"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import {
    Playlist,
    getPlaylist,
    removeTrackFromPlaylist,
    reorderTracks,
    renamePlaylist,
} from "../../lib/playlistStore";
import { LocalTrack, getTrack, getArtworkUrl } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";
import { useWebSockets } from "../../hooks/useWebSockets";

interface PlaylistDetailProps {
    playlistId: string;
    onBack: () => void;
}

export function PlaylistDetail({ playlistId, onBack }: PlaylistDetailProps) {
    const router = useRouter();
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [tracks, setTracks] = useState<LocalTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [editName, setEditName] = useState("");
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const { playQueue, currentTrack, isPlaying, stop: handleStop, playNext, addToQueue } = usePlayer();
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: LocalTrack } | null>(null);
    const { addToast } = useToast();
    const [trackProgress, setTrackProgress] = useState<Map<string, number>>(new Map());

    const loadPlaylistData = async () => {
        setLoading(true);
        const p = await getPlaylist(playlistId);
        if (p) {
            setPlaylist(p);
            setEditName(p.name);

            // Load actual track data
            const trackData = await Promise.all(
                p.trackIds.map((id) => getTrack(id))
            );
            const filteredTracks = trackData.filter((t): t is LocalTrack => t !== null);
            setTracks(filteredTracks);

            // Load artwork
            const urls = new Map<string, string>();
            for (const track of filteredTracks) {
                const url = await getArtworkUrl(track);
                if (url) urls.set(track.id, url);
            }
            setArtworkUrls(urls);
        }
        setLoading(false);
    };

    useWebSockets(
        (data) => {
            if (data.status === 'ready') {
                void loadPlaylistData();
                setTrackProgress((prev) => {
                    const next = new Map(prev);
                    next.delete(data.releaseId);
                    return next;
                });
            }
        },
        (data) => {
            setTrackProgress((prev) => new Map(prev).set(data.trackId, data.progress));
        }
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadPlaylistData();
    }, [playlistId]);

    const handlePlayTrack = (track: LocalTrack) => {
        const index = tracks.findIndex((t) => t.id === track.id);
        void playQueue(tracks, index >= 0 ? index : 0);
    };

    const handleRemoveTrack = async (trackId: string) => {
        if (!confirm("Remove this track from the playlist?")) return;
        await removeTrackFromPlaylist(playlistId, trackId);
        await loadPlaylistData();
        addToast({ type: "success", title: "Removed", message: "Track removed from playlist" });
    };

    const handleContextMenu = (e: React.MouseEvent, track: LocalTrack) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, track });
    };

    const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => [
        { label: "Play Next", icon: "⏭️", onClick: () => { playNext(track); addToast({ type: "success", title: "Queued", message: `"${track.title}" will play next` }); } },
        { label: "Add to Queue", icon: "➕", onClick: () => { addToQueue(track); addToast({ type: "success", title: "Queued", message: `Added "${track.title}" to queue` }); } },
        { separator: true, label: "", onClick: () => { } },
        { label: "Remove from Playlist", icon: "❌", variant: "destructive", onClick: () => handleRemoveTrack(track.id) },
    ];

    const handlePlayAll = () => {
        if (tracks.length > 0) {
            void playQueue(tracks, 0);
        }
    };

    // Global key listener for playback
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.code === "Space" && selectedTrackId) {
                e.preventDefault();
                const track = tracks.find(t => t.id === selectedTrackId);
                if (track) {
                    handlePlayTrack(track);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedTrackId, tracks, handlePlayTrack]);

    const handleRename = async (newName: string) => {
        if (!newName.trim() || !playlist) {
            setShowRenameModal(false);
            return;
        }
        await renamePlaylist(playlist.id, newName.trim());
        setPlaylist({ ...playlist, name: newName.trim() });
        setShowRenameModal(false);
    };

    const handleReorder = async (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || !playlist) return;

        const newTrackIds = [...playlist.trackIds];
        const [movedTrackId] = newTrackIds.splice(fromIndex, 1);

        // Adjust toIndex if it's after fromIndex
        const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        newTrackIds.splice(adjustedToIndex, 0, movedTrackId);

        await reorderTracks(playlistId, newTrackIds);
        await loadPlaylistData();
    };

    if (loading) {
        return <div className="detail-loading">Loading playlist...</div>;
    }

    if (!playlist) {
        return (
            <div className="detail-error">
                <p>Playlist not found</p>
                <Button onClick={onBack}>Back to Library</Button>
            </div>
        );
    }

    const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const heroArt = tracks.length > 0 ? artworkUrls.get(tracks[0].id) : null;

    return (
        <div className="library-detail">
            <div className="library-detail-back">
                <Button variant="ghost" onClick={onBack}>← Back to Playlists</Button>
            </div>

            <div className="detail-hero">
                {heroArt ? (
                    <img src={heroArt} alt={playlist.name} className="detail-hero-artwork" />
                ) : (
                    <div className="detail-hero-artwork" style={{ background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "80px" }}>
                        🎶
                    </div>
                )}
                <div className="detail-hero-content">
                    <div className="detail-hero-label">Playlist</div>
                    <h1
                        className="detail-hero-title cursor-pointer hover:text-accent"
                        onClick={() => setShowRenameModal(true)}
                        title="Click to rename"
                    >
                        {playlist.name}
                    </h1>
                    <div className="detail-hero-meta">
                        {tracks.length} track{tracks.length !== 1 ? "s" : ""} • {formatDuration(totalDuration)}
                    </div>
                    <div className="detail-hero-actions">
                        <Button variant="primary" onClick={handlePlayAll} disabled={tracks.length === 0}>
                            Play All
                        </Button>
                    </div>
                </div>
            </div>

            <div className="detail-tracks">
                <h2 className="detail-section-title">Tracks</h2>
                {tracks.length === 0 ? (
                    <div className="home-subtitle">This playlist is empty. Add some tracks from your library!</div>
                ) : (
                    <div className="library-list">
                        {tracks.map((track, index) => {
                            const artUrl = artworkUrls.get(track.id);
                            const isCurrent = currentTrack?.id === track.id;

                            return (
                                <div
                                    key={`${track.id}-${index}`}
                                    draggable
                                    className={`library-item playlist-track-item ${selectedTrackId === track.id ? "selected" : ""} ${isCurrent ? "playing" : ""} ${draggingTrackId === track.id ? "dragging" : ""} ${dragOverIndex === index ? "drag-before" : ""} ${dragOverIndex === index + 1 && index === tracks.length - 1 ? "drag-after" : ""}`}
                                    onClick={() => {
                                        setSelectedTrackId(track.id);
                                        handlePlayTrack(track);
                                    }}
                                    onContextMenu={(e) => handleContextMenu(e, track)}
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(track.id);
                                        const payload = JSON.stringify({ type: "reorder-track", trackId: track.id, index });
                                        e.dataTransfer.setData("application/json", payload);
                                        e.dataTransfer.setData("text/plain", payload);
                                        e.dataTransfer.effectAllowed = "move";

                                        // Set a ghost image or just let it be
                                        if (e.currentTarget instanceof HTMLElement) {
                                            e.currentTarget.style.opacity = '0.4';
                                        }
                                    }}
                                    onDragEnd={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(null);
                                        setDragOverIndex(null);
                                        if (e.currentTarget instanceof HTMLElement) {
                                            e.currentTarget.style.opacity = '1';
                                        }
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = "move";

                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        if (e.clientY < midpoint) {
                                            if (dragOverIndex !== index) setDragOverIndex(index);
                                        } else {
                                            if (dragOverIndex !== index + 1) setDragOverIndex(index + 1);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDragOverIndex(null);

                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        const finalToIndex = e.clientY < midpoint ? index : index + 1;

                                        const jsonData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
                                        if (jsonData) {
                                            try {
                                                const data = JSON.parse(jsonData);
                                                if (data.type === "reorder-track") {
                                                    void handleReorder(data.index, finalToIndex);
                                                }
                                            } catch (err) {
                                                console.error("Failed to parse drop data", err);
                                            }
                                        }
                                    }}
                                >
                                    <div className="library-item-drag-handle">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="9" cy="12" r="1" />
                                            <circle cx="9" cy="5" r="1" />
                                            <circle cx="9" cy="19" r="1" />
                                            <circle cx="15" cy="12" r="1" />
                                            <circle cx="15" cy="5" r="1" />
                                            <circle cx="15" cy="19" r="1" />
                                        </svg>
                                    </div>
                                    <div className="library-item-artwork">
                                        {artUrl ? (
                                            <img src={artUrl} alt={track.title} />
                                        ) : (
                                            <div className="library-item-artwork-placeholder">🎵</div>
                                        )}
                                        {track.stemType && track.stemType.toLowerCase() !== 'original' && (
                                            <div className="absolute top-0 right-0 bg-accent text-white text-[9px] px-1 py-0.5 rounded-bl font-bold shadow-md">
                                                STEM
                                            </div>
                                        )}
                                    </div>
                                    <div className="library-item-info">
                                        <div className="library-item-title">{track.title}</div>
                                        <div className="library-item-meta">
                                            <span
                                                className="clickable hover:underline"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // For local tracks, we might rely on name
                                                    const target = track.artist;
                                                    if (target) router.push(`/artist/${encodeURIComponent(target)}`);
                                                }}
                                            >
                                                {track.artist || "Unknown Artist"}
                                            </span>
                                            {track.album && ` • ${track.album}`}
                                            {track.stemType && track.stemType.toLowerCase() !== 'original' && (
                                                <span className="text-accent text-xs ml-2 font-medium border border-accent/30 px-1.5 py-0.5 rounded-full">
                                                    {track.stemType}
                                                </span>
                                            )}
                                        </div>
                                        {trackProgress.get(track.id) !== undefined && trackProgress.get(track.id)! < 100 && (
                                            <div className="track-progress-container">
                                                <div className="track-progress-bar" style={{ width: `${trackProgress.get(track.id)}%` }} />
                                                <span className="track-progress-label">Separating Stems: {trackProgress.get(track.id)}%</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="library-item-duration">
                                        {formatDuration(track.duration)}
                                    </div>
                                    <div className="library-item-actions">
                                        <Button variant="ghost" onClick={(e) => { e.stopPropagation(); handleRemoveTrack(track.id); }}>Remove</Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={getTrackContextMenuItems(contextMenu.track)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <PromptModal
                isOpen={showRenameModal}
                title="Rename Playlist"
                initialValue={playlist.name}
                onConfirm={handleRename}
                onCancel={() => setShowRenameModal(false)}
            />
        </div>
    );
}
