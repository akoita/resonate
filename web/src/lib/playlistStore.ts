/**
 * Playlist Store - IndexedDB storage for user playlists and folders
 * Uses localforage for cross-browser IndexedDB abstraction
 */
import localforage from "localforage";
import {
    createPlaylistAPI,
    listPlaylistsAPI,
    updatePlaylistAPI,
    deletePlaylistAPI,
    createFolderAPI,
    listFoldersAPI,
    updateFolderAPI,
    deleteFolderAPI,
} from "./api";

// Configure localforage instances
const playlistStore = localforage.createInstance({
    name: "resonate",
    storeName: "playlists",
});

const folderStore = localforage.createInstance({
    name: "resonate",
    storeName: "playlistFolders",
});

function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("resonate.token");
}

// ============================================
// Types
// ============================================

export interface Playlist {
    id: string;
    name: string;
    trackIds: string[];
    folderId: string | null; // null = root level
    createdAt: string;
    updatedAt: string;
}

export interface PlaylistFolder {
    id: string;
    name: string;
    createdAt: string;
}

// ============================================
// Playlist CRUD
// ============================================

/**
 * Create a new playlist
 */
export async function createPlaylist(
    name: string,
    folderId: string | null = null
): Promise<Playlist> {
    const token = getToken();
    if (token) {
        try {
            const apiPlaylist = await createPlaylistAPI(token, { name, folderId: folderId ?? undefined });
            const playlist: Playlist = {
                id: apiPlaylist.id,
                name: apiPlaylist.name,
                trackIds: apiPlaylist.trackIds,
                folderId: apiPlaylist.folderId ?? null,
                createdAt: apiPlaylist.createdAt,
                updatedAt: apiPlaylist.updatedAt,
            };
            await playlistStore.setItem(playlist.id, playlist);
            return playlist;
        } catch (err) {
            console.error("Failed to create playlist on backend", err);
        }
    }

    const id = `playlist_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const now = new Date().toISOString();

    const playlist: Playlist = {
        id,
        name,
        trackIds: [],
        folderId,
        createdAt: now,
        updatedAt: now,
    };

    await playlistStore.setItem(id, playlist);
    return playlist;
}

/**
 * Get a playlist by ID
 */
export async function getPlaylist(id: string): Promise<Playlist | null> {
    return playlistStore.getItem<Playlist>(id);
}

/**
 * Rename a playlist
 */
export async function renamePlaylist(
    id: string,
    newName: string
): Promise<Playlist | null> {
    const token = getToken();
    if (token && !id.startsWith("playlist_")) {
        try {
            const apiPlaylist = await updatePlaylistAPI(id, token, { name: newName });
            const playlist: Playlist = {
                id: apiPlaylist.id,
                name: apiPlaylist.name,
                trackIds: apiPlaylist.trackIds,
                folderId: apiPlaylist.folderId ?? null,
                createdAt: apiPlaylist.createdAt,
                updatedAt: apiPlaylist.updatedAt,
            };
            await playlistStore.setItem(id, playlist);
            return playlist;
        } catch (err) {
            console.error("Failed to rename playlist on backend", err);
        }
    }

    const playlist = await getPlaylist(id);
    if (!playlist) return null;

    playlist.name = newName;
    playlist.updatedAt = new Date().toISOString();
    await playlistStore.setItem(id, playlist);
    return playlist;
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(id: string): Promise<void> {
    const token = getToken();
    if (token && !id.startsWith("playlist_")) {
        try {
            await deletePlaylistAPI(id, token);
        } catch (err) {
            console.error("Failed to delete playlist on backend", err);
        }
    }
    await playlistStore.removeItem(id);
}

/**
 * Move playlist to a different folder (or root if folderId is null)
 */
export async function movePlaylistToFolder(
    playlistId: string,
    folderId: string | null
): Promise<Playlist | null> {
    const token = getToken();
    if (token && !playlistId.startsWith("playlist_")) {
        try {
            const apiPlaylist = await updatePlaylistAPI(playlistId, token, { folderId });
            const playlist: Playlist = {
                id: apiPlaylist.id,
                name: apiPlaylist.name,
                trackIds: apiPlaylist.trackIds,
                folderId: apiPlaylist.folderId ?? null,
                createdAt: apiPlaylist.createdAt,
                updatedAt: apiPlaylist.updatedAt,
            };
            await playlistStore.setItem(playlistId, playlist);
            return playlist;
        } catch (err) {
            console.error("Failed to move playlist on backend", err);
        }
    }

    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    playlist.folderId = folderId;
    playlist.updatedAt = new Date().toISOString();
    await playlistStore.setItem(playlistId, playlist);
    return playlist;
}

/**
 * List all playlists
 */
export async function listPlaylists(): Promise<Playlist[]> {
    const playlists: Playlist[] = [];
    await playlistStore.iterate<Playlist, void>((value) => {
        playlists.push(value);
    });
    return playlists.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

/**
 * Get playlists in a specific folder (or root-level playlists if folderId is null)
 */
export async function getPlaylistsInFolder(
    folderId: string | null
): Promise<Playlist[]> {
    const all = await listPlaylists();
    return all.filter((p) => p.folderId === folderId);
}

// ============================================
// Folder CRUD
// ============================================

/**
 * Create a new folder
 */
export async function createFolder(name: string): Promise<PlaylistFolder> {
    const token = getToken();
    if (token) {
        try {
            const apiFolder = await createFolderAPI(token, name);
            const folder: PlaylistFolder = {
                id: apiFolder.id,
                name: apiFolder.name,
                createdAt: apiFolder.createdAt,
            };
            await folderStore.setItem(folder.id, folder);
            return folder;
        } catch (err) {
            console.error("Failed to create folder on backend", err);
        }
    }

    const id = `folder_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const folder: PlaylistFolder = {
        id,
        name,
        createdAt: new Date().toISOString(),
    };
    await folderStore.setItem(id, folder);
    return folder;
}

/**
 * Get a folder by ID
 */
export async function getFolder(id: string): Promise<PlaylistFolder | null> {
    return folderStore.getItem<PlaylistFolder>(id);
}

/**
 * Rename a folder
 */
export async function renameFolder(
    id: string,
    newName: string
): Promise<PlaylistFolder | null> {
    const token = getToken();
    if (token && !id.startsWith("folder_")) {
        try {
            const apiFolder = await updateFolderAPI(id, token, newName);
            const folder: PlaylistFolder = {
                id: apiFolder.id,
                name: apiFolder.name,
                createdAt: apiFolder.createdAt,
            };
            await folderStore.setItem(id, folder);
            return folder;
        } catch (err) {
            console.error("Failed to rename folder on backend", err);
        }
    }

    const folder = await getFolder(id);
    if (!folder) return null;

    folder.name = newName;
    await folderStore.setItem(id, folder);
    return folder;
}

/**
 * Delete a folder and optionally move its playlists to root
 */
export async function deleteFolder(
    id: string,
    movePlaylistsToRoot: boolean = true
): Promise<void> {
    const token = getToken();
    if (token && !id.startsWith("folder_")) {
        try {
            await deleteFolderAPI(id, token);
        } catch (err) {
            console.error("Failed to delete folder on backend", err);
        }
    }

    if (movePlaylistsToRoot) {
        const playlists = await getPlaylistsInFolder(id);
        for (const playlist of playlists) {
            await movePlaylistToFolder(playlist.id, null);
        }
    }
    await folderStore.removeItem(id);
}

/**
 * List all folders
 */
export async function listFolders(): Promise<PlaylistFolder[]> {
    const folders: PlaylistFolder[] = [];
    await folderStore.iterate<PlaylistFolder, void>((value) => {
        folders.push(value);
    });
    return folders.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

// ============================================
// Sync Management
// ============================================

/**
 * Sync playlists and folders with the backend
 */
export async function syncPlaylists(): Promise<void> {
    const token = getToken();
    if (!token) return;

    try {
        const [apiPlaylists, apiFolders] = await Promise.all([
            listPlaylistsAPI(token),
            listFoldersAPI(token)
        ]);

        // Overwrite local with backend truth
        await playlistStore.clear();
        for (const p of apiPlaylists) {
            const playlist: Playlist = {
                id: p.id,
                name: p.name,
                trackIds: p.trackIds,
                folderId: p.folderId ?? null,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
            };
            await playlistStore.setItem(p.id, playlist);
        }

        await folderStore.clear();
        for (const f of apiFolders) {
            const folder: PlaylistFolder = {
                id: f.id,
                name: f.name,
                createdAt: f.createdAt,
            };
            await folderStore.setItem(f.id, folder);
        }
    } catch (err) {
        console.error("Failed to sync with backend", err);
    }
}

// ============================================
// Track Management
// ============================================

/**
 * Add a track to a playlist
 */
export async function addTrackToPlaylist(
    playlistId: string,
    trackId: string,
    index?: number
): Promise<Playlist | null> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    // Avoid duplicates
    if (!playlist.trackIds.includes(trackId)) {
        if (typeof index === 'number' && index >= 0 && index <= playlist.trackIds.length) {
            playlist.trackIds.splice(index, 0, trackId);
        } else {
            playlist.trackIds.push(trackId);
        }
        playlist.updatedAt = new Date().toISOString();

        const token = getToken();
        if (token && !playlistId.startsWith("playlist_")) {
            try {
                const apiPlaylist = await updatePlaylistAPI(playlistId, token, { trackIds: playlist.trackIds });
                // We trust the local update as well, but API is truth
                playlist.updatedAt = apiPlaylist.updatedAt;
            } catch (err) {
                console.error("Failed to update track list on backend", err);
            }
        }

        await playlistStore.setItem(playlistId, playlist);
    }
    return playlist;
}

/**
 * Add multiple tracks to a playlist
 */
export async function addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    index?: number
): Promise<Playlist | null> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    const existingSet = new Set(playlist.trackIds);
    const newTrackIds: string[] = [];
    for (const trackId of trackIds) {
        if (!existingSet.has(trackId)) {
            newTrackIds.push(trackId);
            existingSet.add(trackId);
        }
    }

    if (newTrackIds.length > 0) {
        if (typeof index === 'number' && index >= 0 && index <= playlist.trackIds.length) {
            playlist.trackIds.splice(index, 0, ...newTrackIds);
        } else {
            playlist.trackIds.push(...newTrackIds);
        }
        playlist.updatedAt = new Date().toISOString();

        const token = getToken();
        if (token && !playlistId.startsWith("playlist_")) {
            try {
                const apiPlaylist = await updatePlaylistAPI(playlistId, token, { trackIds: playlist.trackIds });
                playlist.updatedAt = apiPlaylist.updatedAt;
            } catch (err) {
                console.error("Failed to update track list on backend", err);
            }
        }

        await playlistStore.setItem(playlistId, playlist);
    }

    return playlist;
}

/**
 * Remove a track from a playlist
 */
export async function removeTrackFromPlaylist(
    playlistId: string,
    trackId: string
): Promise<Playlist | null> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    playlist.updatedAt = new Date().toISOString();

    const token = getToken();
    if (token && !playlistId.startsWith("playlist_")) {
        try {
            const apiPlaylist = await updatePlaylistAPI(playlistId, token, { trackIds: playlist.trackIds });
            playlist.updatedAt = apiPlaylist.updatedAt;
        } catch (err) {
            console.error("Failed to update track list on backend", err);
        }
    }

    await playlistStore.setItem(playlistId, playlist);
    return playlist;
}

/**
 * Reorder tracks in a playlist
 */
export async function reorderTracks(
    playlistId: string,
    newTrackIds: string[]
): Promise<Playlist | null> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    playlist.trackIds = newTrackIds;
    playlist.updatedAt = new Date().toISOString();

    const token = getToken();
    if (token && !playlistId.startsWith("playlist_")) {
        try {
            const apiPlaylist = await updatePlaylistAPI(playlistId, token, { trackIds: playlist.trackIds });
            playlist.updatedAt = apiPlaylist.updatedAt;
        } catch (err) {
            console.error("Failed to update track list on backend", err);
        }
    }

    await playlistStore.setItem(playlistId, playlist);
    return playlist;
}

/**
 * Add tracks to a playlist based on criteria (album, artist, etc.)
 */
export async function addTracksByCriteria(
    playlistId: string,
    criteria: { album?: string; artist?: string }
): Promise<Playlist | null> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist) return null;

    // Import listTracks to get all library tracks
    const { listTracks } = await import("./localLibrary");
    const allTracks = await listTracks();

    const tracksToAdd = allTracks.filter(t => {
        if (criteria.album && t.album === criteria.album && t.artist === criteria.artist) return true;
        if (criteria.artist && !criteria.album && t.artist === criteria.artist) return true;
        return false;
    });

    if (tracksToAdd.length === 0) return playlist;

    return addTracksToPlaylist(playlistId, tracksToAdd.map(t => t.id));
}
