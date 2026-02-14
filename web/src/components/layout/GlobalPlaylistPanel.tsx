import { useEffect, useState } from "react";
import { ContextMenuItem } from "../ui/ContextMenu";
import {
    Playlist,
    PlaylistFolder,
    listPlaylists,
    listFolders,
    getPlaylist,
    addTrackToPlaylist,
    addTracksToPlaylist,
    createPlaylist,
    createFolder,
    renamePlaylist,
    renameFolder,
    deletePlaylist,
    deleteFolder,
    reorderTracks,
    removeTrackFromPlaylist,
    syncPlaylists,
    addTracksByCriteria,
} from "../../lib/playlistStore";
import { LocalTrack, getTrack } from "../../lib/localLibrary";
import { useUIStore } from "../../lib/uiStore";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";
import { ContextMenu } from "../ui/ContextMenu";
import { usePlayer } from "../../lib/playerContext";

interface GlobalPlaylistPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function GlobalPlaylistPanel({ isOpen, onClose }: GlobalPlaylistPanelProps) {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<PlaylistFolder[]>([]);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set());
    const [playlistTracks, setPlaylistTracks] = useState<Map<string, LocalTrack[]>>(new Map());
    const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const { addToast } = useToast();
    const { togglePlaylistPanel } = useUIStore();
    const { playQueue, currentTrack, playNext, addToQueue } = usePlayer();
    const [isSyncing, setIsSyncing] = useState(false);

    // Keyboard shortcut: Ctrl+J / Cmd+J to toggle
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check for Ctrl+J or Cmd+J
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                togglePlaylistPanel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlaylistPanel]);

    // Auto-open playlist panel when dragging near right edge
    const { openPlaylistPanel } = useUIStore();
    useEffect(() => {
        let openTimeout: ReturnType<typeof setTimeout> | null = null;
        const handleGlobalDragOver = (e: DragEvent) => {
            if (e.clientX > window.innerWidth - 60 && !isOpen) {
                if (!openTimeout) {
                    openTimeout = setTimeout(() => {
                        openPlaylistPanel();
                        openTimeout = null;
                    }, 400); // 400ms delay to avoid accidental opens
                }
            } else if (openTimeout) {
                clearTimeout(openTimeout);
                openTimeout = null;
            }
        };
        window.addEventListener('dragover', handleGlobalDragOver);
        return () => {
            window.removeEventListener('dragover', handleGlobalDragOver);
            if (openTimeout) clearTimeout(openTimeout);
        };
    }, [isOpen, openPlaylistPanel]);

    // UX States
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
    const [modalState, setModalState] = useState<{
        type: 'create-playlist' | 'create-folder' | 'rename-playlist' | 'rename-folder';
        isOpen: boolean;
        targetId?: string;
        initialValue?: string;
    }>({ type: 'create-playlist', isOpen: false });

    // Load data
    const refreshLibrary = async () => {
        const [p, f] = await Promise.all([listPlaylists(), listFolders()]);
        setPlaylists(p);
        setFolders(f);
    };

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await syncPlaylists();
            await refreshLibrary();
            addToast({ type: "success", title: "Synced", message: "Playlists updated from cloud" });
        } catch (err) {
            addToast({ type: "error", title: "Sync Failed", message: "Could not sync with backend" });
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            refreshLibrary();
        }
    }, [isOpen]);

    // -- Handlers --

    const handleCreatePlaylist = async (name: string) => {
        await createPlaylist(name);
        addToast({ type: "success", title: "Playlist Created", message: `Created "${name}"` });
        refreshLibrary();
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const handleCreateFolder = async (name: string) => {
        await createFolder(name);
        addToast({ type: "success", title: "Folder Created", message: `Created "${name}"` });
        refreshLibrary();
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const handleRenamePlaylist = async (name: string) => {
        if (!modalState.targetId) return;
        await renamePlaylist(modalState.targetId, name);
        refreshLibrary();
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const handleRenameFolder = async (name: string) => {
        if (!modalState.targetId) return;
        await renameFolder(modalState.targetId, name);
        refreshLibrary();
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    const handleDeletePlaylist = async (id: string, name: string) => {
        if (confirm(`Delete playlist "${name}"?`)) {
            await deletePlaylist(id);
            refreshLibrary();
            addToast({ type: "success", title: "Deleted", message: "Playlist deleted" });
        }
    };

    const handleDeleteFolder = async (id: string, name: string) => {
        if (confirm(`Delete folder "${name}"? Playlists will be moved to root.`)) {
            await deleteFolder(id, true);
            refreshLibrary();
            addToast({ type: "success", title: "Deleted", message: "Folder deleted" });
        }
    };

    // -- Context Menus --

    const showPlaylistMenu = (e: React.MouseEvent, p: Playlist) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Rename", icon: "✏️", onClick: () => setModalState({ type: 'rename-playlist', isOpen: true, targetId: p.id, initialValue: p.name }) },
                { label: "Delete", icon: "🗑️", variant: "destructive", onClick: () => handleDeletePlaylist(p.id, p.name) },
            ]
        });
    };

    const showFolderMenu = (e: React.MouseEvent, f: PlaylistFolder) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Rename", icon: "✏️", onClick: () => setModalState({ type: 'rename-folder', isOpen: true, targetId: f.id, initialValue: f.name }) },
                { label: "Delete", icon: "🗑️", variant: "destructive", onClick: () => handleDeleteFolder(f.id, f.name) },
            ]
        });
    };

    const showTrackMenu = (e: React.MouseEvent, p: Playlist, track: LocalTrack) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                { label: "Play Next", icon: "⏭️", onClick: () => { playNext(track); addToast({ type: "success", title: "Queued", message: `"${track.title}" will play next` }); } },
                { label: "Add to Queue", icon: "➕", onClick: () => { addToQueue(track); addToast({ type: "success", title: "Queued", message: `Added "${track.title}" to queue` }); } },
                { separator: true, label: "", onClick: () => { } },
                { label: "Remove from Playlist", icon: "❌", variant: "destructive", onClick: () => handleRemoveTrack(p.id, track.id) },
            ]
        });
    };

    const handleRemoveTrack = async (playlistId: string, trackId: string) => {
        await removeTrackFromPlaylist(playlistId, trackId);
        await refreshPlaylistTracks(playlistId);
        refreshLibrary();
        addToast({ type: "success", title: "Removed", message: "Track removed from playlist" });
    };

    const toggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    const togglePlaylist = async (playlistId: string) => {
        const isExpanding = !expandedPlaylists.has(playlistId);

        setExpandedPlaylists(prev => {
            const next = new Set(prev);
            if (next.has(playlistId)) next.delete(playlistId);
            else next.add(playlistId);
            return next;
        });

        if (isExpanding && !playlistTracks.has(playlistId)) {
            await refreshPlaylistTracks(playlistId);
        }
    };

    const refreshPlaylistTracks = async (playlistId: string) => {
        const p = await getPlaylist(playlistId);
        if (p) {
            const tracks = await Promise.all(p.trackIds.map(id => getTrack(id)));
            const validTracks = tracks.filter((t): t is LocalTrack => t !== null);
            setPlaylistTracks(prev => {
                const next = new Map(prev);
                next.set(playlistId, validTracks);
                return next;
            });
        }
    };

    const handlePlayPlaylist = async (p: Playlist) => {
        const tracks = playlistTracks.get(p.id);
        if (tracks && tracks.length > 0) {
            await playQueue(tracks, 0);
            addToast({ type: "success", title: "Playing Playlist", message: `Started playing "${p.name}"` });
        } else {
            // Load if not in cache
            const playlist = await getPlaylist(p.id);
            if (playlist && playlist.trackIds.length > 0) {
                const tracksToPlay = await Promise.all(playlist.trackIds.map(id => getTrack(id)));
                const valid = tracksToPlay.filter((t): t is LocalTrack => t !== null);
                await playQueue(valid, 0);
                addToast({ type: "success", title: "Playing Playlist", message: `Started playing "${p.name}"` });
            } else {
                addToast({ type: "warning", title: "Empty Playlist", message: "This playlist has no tracks." });
            }
        }
    };

    const handlePlayTrack = async (playlistId: string, trackId: string) => {
        const tracks = playlistTracks.get(playlistId);
        if (tracks) {
            const idx = tracks.findIndex(t => t.id === trackId);
            if (idx !== -1) {
                await playQueue(tracks, idx);
            }
        }
    };

    const handleReorder = async (playlistId: string, fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        const playlist = playlists.find(p => p.id === playlistId);
        if (!playlist) return;

        const newTrackIds = [...playlist.trackIds];
        const [movedTrackId] = newTrackIds.splice(fromIndex, 1);

        // Adjust toIndex if it's after fromIndex
        const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        newTrackIds.splice(adjustedToIndex, 0, movedTrackId);

        await reorderTracks(playlistId, newTrackIds);
        await refreshPlaylistTracks(playlistId);
    };

    // -- Drag and Drop --

    const handleDrop = async (e: React.DragEvent, playlistId?: string, index?: number) => {
        if (!playlistId) return; // For now, only drop on playlists is supported

        e.stopPropagation();
        setDragOverId(null);
        setDragOverIndex(null);

        try {
            const jsonData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
            if (!jsonData) return;

            let data;
            try {
                data = JSON.parse(jsonData);
            } catch (parseError) {
                console.warn("Dropped data is not valid JSON:", jsonData.substring(0, 50));
                return;
            }

            if (data.type === "reorder-track") {
                if (data.playlistId === playlistId) {
                    await handleReorder(playlistId, data.index, index ?? 0);
                }
                return;
            }

            let addedCount = 0;
            let title = "";

            if (data.type === "album" && data.tracks) {
                const tracks = data.tracks as LocalTrack[];
                const trackIdsToAdd = tracks.map(track => track.id);
                await addTracksToPlaylist(playlistId, trackIdsToAdd, index);
                addedCount = tracks.length;
                title = data.name || "album";
            } else if (data.type === "track") {
                // Handle both full track object and just ID
                const trackId = data.id;
                // Use full track object if available for title, but don't save metadata
                if (data.title) {
                    title = data.title;
                } else {
                    const track = await getTrack(trackId);
                    if (track) title = track.title;
                }
                await addTrackToPlaylist(playlistId, trackId, index);
                addedCount = 1;
            } else if (data.type === "artist") {
                const result = await addTracksByCriteria(playlistId, { artist: data.name });
                if (result) {
                    addedCount = result.trackIds.length;
                    title = data.name;
                }
            } else if (data.type === "release-track" && data.track) {
                // Single track dragged from release page
                const trackId = data.track.id;
                title = data.track.title || data.title || "track";
                await addTrackToPlaylist(playlistId, trackId, index);
                addedCount = 1;
            } else if ((data.type === "release-selection" || data.type === "release-album") && data.tracks) {
                // Multiple tracks or full album dragged from release page
                const tracks = data.tracks as LocalTrack[];
                const trackIdsToAdd = tracks.map(track => track.id);
                await addTracksToPlaylist(playlistId, trackIdsToAdd, index);
                addedCount = tracks.length;
                title = data.title || `${tracks.length} tracks`;
            }

            if (addedCount > 0) {
                const playlist = playlists.find(p => p.id === playlistId);
                addToast({
                    type: "success",
                    title: addedCount > 1 ? "Tracks Added" : "Track Added",
                    message: `Added ${addedCount > 1 ? addedCount + " tracks" : `"${title}"`} to ${playlist?.name || "playlist"}`,
                });
                await refreshPlaylistTracks(playlistId);
                refreshLibrary();
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };


    const renderPlaylist = (p: Playlist, isNested: boolean) => {
        const isExpanded = expandedPlaylists.has(p.id);
        const tracks = playlistTracks.get(p.id) || [];

        return (
            <div key={p.id} className="gpp-playlist-group">
                <div
                    className={`gpp-item ${isNested ? "nested" : ""} ${isExpanded ? "expanded" : ""} ${dragOverId === p.id ? "drag-over" : ""}`}
                    style={{ userSelect: "none" }}
                    onClick={() => togglePlaylist(p.id)}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        setDragOverId(p.id);
                    }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={(e) => handleDrop(e, p.id)}
                    onContextMenu={(e) => showPlaylistMenu(e, p)}
                >
                    <span className={`gpp-chevron ${isExpanded ? "rotated" : ""}`}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </span>
                    <span className="gpp-icon">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18V5l12-2v13"></path>
                            <circle cx="6" cy="18" r="3"></circle>
                            <circle cx="18" cy="16" r="3"></circle>
                        </svg>
                    </span>
                    <span className="gpp-name">{p.name}</span>

                    <div className="gpp-item-actions">
                        <button
                            className="gpp-play-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                handlePlayPlaylist(p);
                            }}
                            title="Play Playlist"
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                        </button>
                    </div>

                    <span className="gpp-count">{p.trackIds.length}</span>
                </div>

                {isExpanded && (
                    <div className="gpp-tracks-list">
                        {tracks.length === 0 ? (
                            <div className="gpp-track-item empty">Empty</div>
                        ) : (
                            tracks.map((track, idx) => (
                                <div
                                    key={`${track.id}-${idx}`}
                                    draggable
                                    className={`gpp-track-item ${currentTrack?.id === track.id ? "playing" : ""} ${draggingTrackId === track.id ? "dragging" : ""} ${dragOverId === p.id && dragOverIndex === idx ? "drag-before" : ""} ${dragOverId === p.id && dragOverIndex === idx + 1 && idx === tracks.length - 1 ? "drag-after" : ""}`}
                                    onClick={() => handlePlayTrack(p.id, track.id)}
                                    onContextMenu={(e) => showTrackMenu(e, p, track)}
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(track.id);
                                        const payload = JSON.stringify({ type: "reorder-track", playlistId: p.id, trackId: track.id, index: idx });
                                        e.dataTransfer.setData("application/json", payload);
                                        e.dataTransfer.setData("text/plain", payload);
                                        e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragEnd={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(null);
                                        setDragOverId(null);
                                        setDragOverIndex(null);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = "move";
                                        setDragOverId(p.id);
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        if (e.clientY < midpoint) {
                                            setDragOverIndex(idx);
                                        } else {
                                            setDragOverIndex(idx + 1);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        const finalIndex = e.clientY < midpoint ? idx : idx + 1;

                                        const jsonData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
                                        if (jsonData) {
                                            try {
                                                const data = JSON.parse(jsonData);
                                                if (data.type === "reorder-track" && data.playlistId === p.id) {
                                                    void handleReorder(p.id, data.index, finalIndex);
                                                } else {
                                                    void handleDrop(e, p.id, finalIndex);
                                                }
                                            } catch (err) {
                                                void handleDrop(e, p.id, finalIndex);
                                            }
                                        }

                                        setDragOverId(null);
                                        setDragOverIndex(null);
                                    }}
                                >
                                    <div className="gpp-track-drag-handle">
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="9" cy="12" r="1" />
                                            <circle cx="9" cy="5" r="1" />
                                            <circle cx="9" cy="19" r="1" />
                                            <circle cx="15" cy="12" r="1" />
                                            <circle cx="15" cy="5" r="1" />
                                            <circle cx="15" cy="19" r="1" />
                                        </svg>
                                    </div>
                                    <span className="gpp-track-icon">
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M9 18V5l12-2v13"></path>
                                            <circle cx="6" cy="18" r="3"></circle>
                                            <circle cx="18" cy="16" r="3"></circle>
                                        </svg>
                                    </span>
                                    <div className="gpp-track-info">
                                        <span className="gpp-track-name">{track.title}</span>
                                        <span className="gpp-track-artist">{track.artist || "Unknown Artist"}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`global-playlist-panel ${isOpen ? 'open' : ''}`}>
            <div className="gpp-header">
                <h3>Your Playlists</h3>
                <div className="gpp-actions">
                    <button
                        className="gpp-action-btn"
                        onClick={() => setModalState({ type: 'create-playlist', isOpen: true })}
                        title="New Playlist"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button
                        className={`gpp-action-btn ${isSyncing ? "animate-spin" : ""}`}
                        onClick={handleSync}
                        disabled={isSyncing}
                        title="Sync with cloud"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 4v6h-6"></path>
                            <path d="M1 20v-6h6"></path>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                    </button>
                    <button
                        className="gpp-action-btn"
                        onClick={() => setModalState({ type: 'create-folder', isOpen: true })}
                        title="New Folder"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            <line x1="12" y1="11" x2="12" y2="17"></line>
                            <line x1="9" y1="14" x2="15" y2="14"></line>
                        </svg>
                    </button>
                    <button className="gpp-close" onClick={onClose}>&times;</button>
                </div>
            </div>

            <div className="gpp-content">
                {playlists.length === 0 && folders.length === 0 && (
                    <div className="gpp-empty">
                        <p>No playlists yet</p>
                        <button className="gpp-create-btn" onClick={() => setModalState({ type: 'create-playlist', isOpen: true })}>
                            Create First Playlist
                        </button>
                    </div>
                )}

                <div className="gpp-list">
                    {/* Folders */}
                    {folders.map((folder) => {
                        const isExpanded = expandedFolders.has(folder.id);
                        const folderPlaylists = playlists.filter(p => p.folderId === folder.id);

                        return (
                            <div key={folder.id} className="gpp-folder-group" onContextMenu={(e) => showFolderMenu(e, folder)}>
                                <div
                                    className={`gpp-folder-item ${isExpanded ? "expanded" : ""}`}
                                    style={{ userSelect: "none" }}
                                    onClick={() => toggleFolder(folder.id)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = "copy";
                                        setDragOverId(folder.id);
                                    }}
                                    onDragLeave={() => setDragOverId(null)}
                                    onDrop={(e) => handleDrop(e, undefined)}
                                >
                                    <span className={`gpp-chevron ${isExpanded ? "rotated" : ""}`}>
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </span>
                                    <span className="gpp-icon">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                        </svg>
                                    </span>
                                    <span className="gpp-name">{folder.name}</span>
                                    <span className="gpp-count">{folderPlaylists.length}</span>
                                </div>

                                {isExpanded && folderPlaylists.map((p) => renderPlaylist(p, true))}
                            </div>
                        );
                    })}

                    {/* Root Playlists */}
                    {playlists.filter(p => !p.folderId).map((p) => renderPlaylist(p, false))}
                </div>
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <PromptModal
                isOpen={modalState.isOpen}
                title={
                    modalState.type === 'create-playlist' ? "New Playlist" :
                        modalState.type === 'create-folder' ? "New Folder" :
                            modalState.type === 'rename-playlist' ? "Rename Playlist" :
                                "Rename Folder"
                }
                initialValue={modalState.initialValue}
                onConfirm={(val) => {
                    if (modalState.type === 'create-playlist') handleCreatePlaylist(val);
                    if (modalState.type === 'create-folder') handleCreateFolder(val);
                    if (modalState.type === 'rename-playlist') handleRenamePlaylist(val);
                    if (modalState.type === 'rename-folder') handleRenameFolder(val);
                }}
                onCancel={() => setModalState(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}
