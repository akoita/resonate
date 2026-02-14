"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "../ui/Button";
import {
    Playlist,
    listPlaylists,
    addTrackToPlaylist,
    addTracksToPlaylist,
    createPlaylist,
    createFolder,
} from "../../lib/playlistStore";
import { LocalTrack } from "../../lib/localLibrary";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";

interface AddToPlaylistModalProps {
    tracks: LocalTrack[] | null;
    onClose: () => void;
}

export function AddToPlaylistModal({ tracks, onClose }: AddToPlaylistModalProps) {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [namingModal, setNamingModal] = useState<{
        isOpen: boolean;
        title: string;
        type: "playlist" | "folder";
    }>({ isOpen: false, title: "", type: "playlist" });
    const { addToast } = useToast();

    useEffect(() => {
        if (tracks && tracks.length > 0) {
            void listPlaylists().then(setPlaylists);
        }
    }, [tracks]);

    const filteredPlaylists = useMemo(() => {
        return playlists.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [playlists, searchQuery]);

    const handleAddToPlaylist = async (playlistId: string) => {
        if (!tracks || tracks.length === 0) return;
        setLoading(playlistId);
        try {

            const trackIds = tracks.map(t => t.id);
            const result = await (trackIds.length === 1
                ? addTrackToPlaylist(playlistId, trackIds[0])
                : addTracksToPlaylist(playlistId, trackIds));

            if (result) {
                addToast({
                    type: "success",
                    title: "Added",
                    message: `${tracks.length} track${tracks.length > 1 ? "s" : ""} added to ${result.name}`,
                });
                onClose();
            }
        } catch (error) {
            console.error("Failed to add to playlist:", error);
            addToast({ type: "error", title: "Error", message: "Failed to add tracks" });
        } finally {
            setLoading(null);
        }
    };

    const handleCreateNewPlaylist = () => {
        setNamingModal({ isOpen: true, title: "New Playlist", type: "playlist" });
    };

    const handleCreateNewFolder = () => {
        setNamingModal({ isOpen: true, title: "New Folder", type: "folder" });
    };

    const handleNamingConfirm = async (name: string) => {
        if (!name.trim()) return;
        setNamingModal(prev => ({ ...prev, isOpen: false }));

        if (namingModal.type === "playlist") {
            if (!tracks || tracks.length === 0) return;
            try {
                const newPlaylist = await createPlaylist(name);

                const trackIds = tracks.map(t => t.id);
                await addTracksToPlaylist(newPlaylist.id, trackIds);

                addToast({
                    type: "success",
                    title: "Playlist Created",
                    message: `${tracks.length} track${tracks.length > 1 ? "s" : ""} added to "${name}"`,
                });
                onClose();
            } catch (error) {
                console.error("Failed to create playlist:", error);
                addToast({ type: "error", title: "Error", message: "Failed to create playlist" });
            }
        } else {
            try {
                await createFolder(name);
                addToast({ type: "success", title: "Folder Created", message: `Folder "${name}" created` });
                void listPlaylists().then(setPlaylists);
            } catch (error) {
                console.error("Failed to create folder:", error);
                addToast({ type: "error", title: "Error", message: "Failed to create folder" });
            }
        }
    };

    if (!tracks || tracks.length === 0) return null;

    const displayTitle = tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks`;

    return (
        <div className="playlist-modal-overlay" onClick={onClose}>
            <div className="playlist-modal redesigned" onClick={(e) => e.stopPropagation()}>
                <div className="playlist-modal-header">
                    <h3>Add to Playlist</h3>
                    <div className="header-metadata">
                        <span className="metadata-label">Adding:</span>
                        <span className="metadata-value">{displayTitle}</span>
                    </div>

                    <div className="playlist-search-container">
                        <input
                            type="text"
                            placeholder="Search playlists..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="playlist-search-input"
                            autoFocus
                        />
                        <span className="search-icon">🔍</span>
                    </div>
                </div>

                <div className="playlist-modal-top-actions">
                    <button className="quick-action-btn" onClick={handleCreateNewPlaylist}>
                        <span className="btn-icon">✨</span>
                        <span>New Playlist</span>
                    </button>
                    <button className="quick-action-btn" onClick={handleCreateNewFolder}>
                        <span className="btn-icon">📁</span>
                        <span>New Folder</span>
                    </button>
                </div>

                <div className="playlist-modal-list custom-scrollbar">
                    {filteredPlaylists.length === 0 ? (
                        <div className="empty-results">
                            {searchQuery ? `No results for "${searchQuery}"` : "No playlists found."}
                        </div>
                    ) : (
                        filteredPlaylists.map((playlist) => (
                            <button
                                key={playlist.id}
                                className={`playlist-modal-item ${loading === playlist.id ? 'loading' : ''}`}
                                onClick={() => handleAddToPlaylist(playlist.id)}
                                disabled={loading !== null}
                            >
                                <div className="playlist-modal-item-icon">
                                    <span className="icon-glow"></span>
                                    🎶
                                </div>
                                <div className="playlist-modal-item-info">
                                    <span className="playlist-modal-item-name">{playlist.name}</span>
                                    <div className="playlist-modal-item-meta">{playlist.trackIds.length} tracks</div>
                                </div>
                                {loading === playlist.id ? (
                                    <div className="loading-spinner-small"></div>
                                ) : (
                                    <div className="add-action-indicator">+</div>
                                )}
                            </button>
                        ))
                    )}
                </div>

                <div className="playlist-modal-footer">
                    <Button variant="ghost" onClick={onClose} className="w-full">
                        Cancel
                    </Button>
                </div>
            </div>

            <PromptModal
                isOpen={namingModal.isOpen}
                title={namingModal.title}
                placeholder={namingModal.type === "playlist" ? "Playlist name..." : "Folder name..."}
                onConfirm={handleNamingConfirm}
                onCancel={() => setNamingModal(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}
