"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "../ui/Button";
import {
    Playlist,
    PlaylistFolder,
    listPlaylists,
    listFolders,
    createPlaylist,
    createFolder,
    deletePlaylist,
    deleteFolder,
    renamePlaylist,
    renameFolder,
    getPlaylistsInFolder,
    addTrackToPlaylist,
    addTracksByCriteria,
} from "../../lib/playlistStore";
import { LocalTrack, getArtworkUrl } from "../../lib/localLibrary";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";
import { usePlayer } from "../../lib/playerContext";
import { getTrack } from "../../lib/localLibrary";

interface PlaylistTabProps {
    tracks: LocalTrack[];
    artworkUrls: Map<string, string>;
    onSelectPlaylist: (playlist: Playlist) => void;
}

export function PlaylistTab({
    tracks,
    artworkUrls,
    onSelectPlaylist,
}: PlaylistTabProps) {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<PlaylistFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createType, setCreateType] = useState<"playlist" | "folder">("playlist");
    const [newName, setNewName] = useState("");
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [currentFolder, setCurrentFolder] = useState<PlaylistFolder | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const { addToast } = useToast();
    const { playQueue } = usePlayer();

    const loadData = async () => {
        setLoading(true);
        const [allPlaylists, allFolders] = await Promise.all([
            listPlaylists(),
            listFolders(),
        ]);
        setPlaylists(allPlaylists);
        setFolders(allFolders);
        setLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadData();
    }, []);

    // Filter playlists for current view (root or inside folder)
    const visiblePlaylists = useMemo(() => {
        return playlists.filter((p) => p.folderId === (currentFolder?.id ?? null));
    }, [playlists, currentFolder]);

    // Get artwork for playlist (from first track)
    const getPlaylistArtwork = (playlist: Playlist): string | null => {
        if (playlist.trackIds.length === 0) return null;
        const firstTrackId = playlist.trackIds[0];
        return artworkUrls.get(firstTrackId) || null;
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;

        if (createType === "playlist") {
            await createPlaylist(newName.trim(), currentFolder?.id ?? null);
        } else {
            await createFolder(newName.trim());
        }

        setNewName("");
        setShowCreateModal(false);
        await loadData();
    };

    const handleDelete = async (id: string, type: "playlist" | "folder") => {
        const name = type === "playlist"
            ? playlists.find(p => p.id === id)?.name
            : folders.find(f => f.id === id)?.name;

        if (!confirm(`Delete ${type} "${name}"?`)) return;

        if (type === "playlist") {
            await deletePlaylist(id);
        } else {
            await deleteFolder(id, true); // Move playlists to root
        }
        await loadData();
    };

    const handleRename = async (id: string, type: "playlist" | "folder") => {
        if (!editName.trim()) {
            setEditingId(null);
            return;
        }

        if (type === "playlist") {
            await renamePlaylist(id, editName.trim());
        } else {
            await renameFolder(id, editName.trim());
        }

        setEditingId(null);
        setEditName("");
        await loadData();
    };

    const handleDrop = async (e: React.DragEvent, playlistId: string) => {
        e.preventDefault();
        setDragOverId(null);

        try {
            const data = JSON.parse(e.dataTransfer.getData("application/json"));
            let result = null;

            if (data.type === "track") {
                result = await addTrackToPlaylist(playlistId, data.id);
            } else if (data.type === "album") {
                result = await addTracksByCriteria(playlistId, { album: data.name, artist: data.artist });
            } else if (data.type === "artist") {
                result = await addTracksByCriteria(playlistId, { artist: data.name });
            }

            if (result) {
                addToast({
                    type: "success",
                    title: "Tracks Added",
                    message: `Added to ${result.name}`,
                });
                await loadData();
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };

    const startEditing = (id: string, currentName: string) => {
        setEditingId(id);
        setEditName(currentName);
    };

    const navigateToFolder = (folder: PlaylistFolder) => {
        setCurrentFolder(folder);
    };

    const navigateToRoot = () => {
        setCurrentFolder(null);
    };

    const handlePlayPlaylist = async (e: React.MouseEvent, playlist: Playlist) => {
        e.stopPropagation();
        if (playlist.trackIds.length === 0) {
            addToast({ type: "warning", title: "Empty Playlist", message: "This playlist has no tracks." });
            return;
        }

        const playlistTracks = await Promise.all(playlist.trackIds.map(id => getTrack(id)));
        const validTracks = playlistTracks.filter((t): t is LocalTrack => t !== null);

        if (validTracks.length > 0) {
            await playQueue(validTracks, 0);
            addToast({ type: "success", title: "Playing Playlist", message: `Started playing "${playlist.name}"` });
        }
    };

    if (loading) {
        return <div className="playlist-loading">Loading playlists...</div>;
    }

    return (
        <div className="playlist-tab">
            {/* Header */}
            <div className="playlist-header">
                {currentFolder && (
                    <Button variant="ghost" onClick={navigateToRoot}>
                        ← Back
                    </Button>
                )}
                <h2 className="playlist-section-title">
                    {currentFolder ? currentFolder.name : "Playlists"}
                </h2>
                <div className="playlist-header-actions">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setCreateType("folder");
                            setShowCreateModal(true);
                        }}
                    >
                        📁 New Folder
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => {
                            setCreateType("playlist");
                            setShowCreateModal(true);
                        }}
                    >
                        + New Playlist
                    </Button>
                </div>
            </div>

            {/* Folders (only at root level) */}
            {!currentFolder && folders.length > 0 && (
                <div className="playlist-folders">
                    {folders.map((folder) => {
                        const folderPlaylists = playlists.filter(
                            (p) => p.folderId === folder.id
                        );
                        return (
                            <div
                                key={folder.id}
                                className="playlist-card playlist-folder-card"
                                onClick={() => navigateToFolder(folder)}
                            >
                                <div className="playlist-card-icon">📁</div>
                                {editingId === folder.id ? (
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={() => handleRename(folder.id, "folder")}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleRename(folder.id, "folder");
                                            if (e.key === "Escape") setEditingId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        autoFocus
                                        className="playlist-card-edit-input"
                                    />
                                ) : (
                                    <div className="playlist-card-title">{folder.name}</div>
                                )}
                                <div className="playlist-card-meta">
                                    {folderPlaylists.length} playlist
                                    {folderPlaylists.length !== 1 ? "s" : ""}
                                </div>
                                <div className="playlist-card-actions">
                                    <button
                                        className="playlist-action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            startEditing(folder.id, folder.name);
                                        }}
                                        title="Rename"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        className="playlist-action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(folder.id, "folder");
                                        }}
                                        title="Delete"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Playlists */}
            <div className="playlist-grid">
                {visiblePlaylists.length === 0 && folders.length === 0 ? (
                    <div className="playlist-empty">
                        <div className="playlist-empty-icon">🎵</div>
                        <div className="playlist-empty-text">No playlists yet</div>
                        <Button
                            variant="primary"
                            onClick={() => {
                                setCreateType("playlist");
                                setShowCreateModal(true);
                            }}
                        >
                            Create your first playlist
                        </Button>
                    </div>
                ) : (
                    visiblePlaylists.map((playlist) => {
                        const artUrl = getPlaylistArtwork(playlist);
                        const trackCount = playlist.trackIds.length;
                        return (
                            <div
                                key={playlist.id}
                                className={`playlist-card ${dragOverId === playlist.id ? "drag-over" : ""}`}
                                onClick={() => onSelectPlaylist(playlist)}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    setDragOverId(playlist.id);
                                }}
                                onDragLeave={() => setDragOverId(null)}
                                onDrop={(e) => handleDrop(e, playlist.id)}
                            >
                                {artUrl ? (
                                    <img
                                        src={artUrl}
                                        alt={playlist.name}
                                        className="playlist-card-artwork"
                                    />
                                ) : (
                                    <div className="playlist-card-icon">🎶</div>
                                )}
                                {editingId === playlist.id ? (
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={() => handleRename(playlist.id, "playlist")}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                handleRename(playlist.id, "playlist");
                                            if (e.key === "Escape") setEditingId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        autoFocus
                                        className="playlist-card-edit-input"
                                    />
                                ) : (
                                    <div className="playlist-card-title">{playlist.name}</div>
                                )}
                                <div className="playlist-card-meta">
                                    {trackCount} track{trackCount !== 1 ? "s" : ""}
                                </div>
                                <button
                                    className="playlist-play-hover-btn"
                                    onClick={(e) => handlePlayPlaylist(e, playlist)}
                                    title="Play Playlist"
                                >
                                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                    </svg>
                                </button>
                                <div className="playlist-card-actions">
                                    <button
                                        className="playlist-action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            startEditing(playlist.id, playlist.name);
                                        }}
                                        title="Rename"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        className="playlist-action-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(playlist.id, "playlist");
                                        }}
                                        title="Delete"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Create Modal */}
            <PromptModal
                isOpen={showCreateModal}
                title={`Create ${createType === "playlist" ? "Playlist" : "Folder"}`}
                onConfirm={(name) => {
                    // eslint-disable-next-line react-hooks/set-state-in-effect
                    void (async () => {
                        if (createType === "playlist") {
                            await createPlaylist(name, currentFolder?.id ?? null);
                        } else {
                            await createFolder(name);
                        }
                        setShowCreateModal(false);
                        await loadData();
                    })();
                }}
                onCancel={() => setShowCreateModal(false)}
            />

            {/* Rename Modal */}
            <PromptModal
                isOpen={editingId !== null}
                title={`Rename ${editingId?.startsWith("folder") ? "Folder" : "Playlist"}`}
                initialValue={editName}
                onConfirm={(name) => {
                    if (editingId) {
                        // eslint-disable-next-line react-hooks/set-state-in-effect
                        void handleRename(editingId, editingId.startsWith("folder") ? "folder" : "playlist");
                    }
                }}
                onCancel={() => setEditingId(null)}
            />
        </div>
    );
}
