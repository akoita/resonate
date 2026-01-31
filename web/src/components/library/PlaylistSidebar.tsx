"use client";

import { useEffect, useState } from "react";
import {
    Playlist,
    PlaylistFolder,
    listPlaylists,
    listFolders,
    addTrackToPlaylist,
    addTracksByCriteria,
    createFolder,
    createPlaylist,
    renameFolder,
    deleteFolder,
    renamePlaylist,
    deletePlaylist,
} from "../../lib/playlistStore";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";

interface PlaylistSidebarProps {
    onSelectPlaylist: (playlist: Playlist) => void;
    activePlaylistId?: string;
}

export function PlaylistSidebar({
    onSelectPlaylist,
    activePlaylistId,
}: PlaylistSidebarProps) {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<PlaylistFolder[]>([]);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [namingState, setNamingState] = useState<{
        isOpen: boolean;
        title: string;
        type: "folder" | "playlist" | "rename-folder" | "rename-playlist";
        id?: string;
        initialValue?: string;
    }>({ isOpen: false, title: "", type: "folder" });
    const { addToast } = useToast();

    const loadData = async () => {
        const [allP, allF] = await Promise.all([
            listPlaylists(),
            listFolders()
        ]);
        setPlaylists(allP);
        setFolders(allF);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadData();
        const interval = setInterval(() => {
            void loadData();
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const toggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    const handleCreateFolder = () => {
        setNamingState({ isOpen: true, title: "New Folder", type: "folder" });
    };

    const handleCreatePlaylist = () => {
        setNamingState({ isOpen: true, title: "New Playlist", type: "playlist" });
    };

    const handleNamingConfirm = async (name: string) => {
        if (!name.trim()) return;
        const currentType = namingState.type;
        setNamingState(prev => ({ ...prev, isOpen: false }));

        try {
            if (currentType === "folder") {
                await createFolder(name);
                addToast({ type: "success", title: "Folder Created", message: `Folder "${name}" created` });
            } else if (currentType === "playlist") {
                await createPlaylist(name);
                addToast({ type: "success", title: "Playlist Created", message: `Playlist "${name}" created` });
            } else if (currentType === "rename-folder" && namingState.id) {
                await renameFolder(namingState.id, name);
                addToast({ type: "success", title: "Folder Renamed", message: `Folder renamed to "${name}"` });
            } else if (currentType === "rename-playlist" && namingState.id) {
                await renamePlaylist(namingState.id, name);
                addToast({ type: "success", title: "Playlist Renamed", message: `Playlist renamed to "${name}"` });
            }
            await loadData();
        } catch (error) {
            console.error("Action failed:", error);
            addToast({ type: "error", title: "Error", message: "Action failed" });
        }
    };

    const handleRenameFolder = (e: React.MouseEvent, folderId: string, currentName: string) => {
        e.stopPropagation();
        setNamingState({
            isOpen: true,
            title: "Rename Folder",
            type: "rename-folder",
            id: folderId,
            initialValue: currentName
        });
    };

    const handleDeleteFolder = async (e: React.MouseEvent, folderId: string, name: string) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${name}"? Playlists will be moved to the root level.`)) {
            await deleteFolder(folderId, true);
            await loadData();
        }
    };

    const handleRenamePlaylist = (e: React.MouseEvent, p: Playlist) => {
        e.stopPropagation();
        setNamingState({
            isOpen: true,
            title: "Rename Playlist",
            type: "rename-playlist",
            id: p.id,
            initialValue: p.name
        });
    };

    const handleDeletePlaylist = async (e: React.MouseEvent, p: Playlist) => {
        e.stopPropagation();
        if (confirm(`Delete playlist "${p.name}"?`)) {
            await deletePlaylist(p.id);
            await loadData();
        }
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

    return (
        <div className="playlist-sidebar">
            <div className="sidebar-header">
                <h3 className="sidebar-title">Your Playlists</h3>
                <div className="sidebar-header-actions">
                    <button className="sidebar-action-btn" onClick={handleCreatePlaylist} title="New Playlist">
                        🎶+
                    </button>
                    <button className="sidebar-action-btn" onClick={handleCreateFolder} title="New Folder">
                        📁+
                    </button>
                </div>
            </div>
            <div className="sidebar-list custom-scrollbar">
                {playlists.length === 0 && folders.length === 0 ? (
                    <div className="sidebar-empty">No playlists</div>
                ) : (
                    <>
                        {/* Folders */}
                        {folders.map(folder => {
                            const isExpanded = expandedFolders.has(folder.id);
                            const folderPlaylists = playlists.filter(p => p.folderId === folder.id);

                            return (
                                <div key={folder.id} className="sidebar-folder-group">
                                    <div
                                        className={`sidebar-item sidebar-folder ${isExpanded ? "expanded" : ""}`}
                                        style={{ userSelect: "none" }}
                                        onClick={() => toggleFolder(folder.id)}
                                    >
                                        <span className="sidebar-item-icon">{isExpanded ? "📂" : "📁"}</span>
                                        <span className="sidebar-item-name">{folder.name}</span>
                                        <div className="sidebar-item-actions ml-auto">
                                            <button onClick={(e) => handleRenameFolder(e, folder.id, folder.name)} title="Rename">✏️</button>
                                            <button onClick={(e) => handleDeleteFolder(e, folder.id, folder.name)} title="Delete">🗑️</button>
                                        </div>
                                        <span className="sidebar-item-count">{folderPlaylists.length}</span>
                                    </div>

                                    {isExpanded && (
                                        <div className="sidebar-nested">
                                            {folderPlaylists.map(p => (
                                                <div
                                                    key={p.id}
                                                    className={`sidebar-item sidebar-nested-item ${activePlaylistId === p.id ? "active" : ""} ${dragOverId === p.id ? "drag-over" : ""}`}
                                                    style={{ userSelect: "none" }}
                                                    onClick={() => onSelectPlaylist(p)}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        e.dataTransfer.dropEffect = "copy";
                                                        setDragOverId(p.id);
                                                    }}
                                                    onDragLeave={() => setDragOverId(null)}
                                                    onDrop={(e) => handleDrop(e, p.id)}
                                                >
                                                    <span className="sidebar-item-icon">🎶</span>
                                                    <span className="sidebar-item-name">{p.name}</span>
                                                    <div className="sidebar-item-actions ml-auto">
                                                        <button onClick={(e) => handleRenamePlaylist(e, p)} title="Rename">✏️</button>
                                                        <button onClick={(e) => handleDeletePlaylist(e, p)} title="Delete">🗑️</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Root Playlists */}
                        {playlists.filter(p => !p.folderId).map((p) => (
                            <div
                                key={p.id}
                                className={`sidebar-item ${activePlaylistId === p.id ? "active" : ""} ${dragOverId === p.id ? "drag-over" : ""}`}
                                style={{ userSelect: "none" }}
                                onClick={() => onSelectPlaylist(p)}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                    setDragOverId(p.id);
                                }}
                                onDragLeave={() => setDragOverId(null)}
                                onDrop={(e) => handleDrop(e, p.id)}
                            >
                                <span className="sidebar-item-icon">🎶</span>
                                <span className="sidebar-item-name">{p.name}</span>
                                <div className="sidebar-item-actions ml-auto">
                                    <button onClick={(e) => handleRenamePlaylist(e, p)} title="Rename">✏️</button>
                                    <button onClick={(e) => handleDeletePlaylist(e, p)} title="Delete">🗑️</button>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <PromptModal
                isOpen={namingState.isOpen}
                title={namingState.title}
                initialValue={namingState.initialValue}
                placeholder="Enter name..."
                onConfirm={handleNamingConfirm}
                onCancel={() => setNamingState(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}
