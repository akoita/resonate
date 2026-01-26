/**
 * Library Settings - Persistent storage for library configuration
 * Uses IndexedDB to store File System Access API directory handles
 */
import localforage from "localforage";

const settingsStore = localforage.createInstance({
    name: "resonate",
    storeName: "librarySettings",
});

export interface LibrarySettings {
    autoScanOnLoad: boolean;
    lastScanTime: string | null;
    sourceFolderName: string | null;
}

const DEFAULT_SETTINGS: LibrarySettings = {
    autoScanOnLoad: true,
    lastScanTime: null,
    sourceFolderName: null,
};

/**
 * Store the library source directory handle
 */
export async function setLibrarySourceHandle(
    handle: FileSystemDirectoryHandle
): Promise<void> {
    await settingsStore.setItem("sourceHandle", handle);
    await updateSettings({ sourceFolderName: handle.name });
}

/**
 * Get the stored library source directory handle
 */
export async function getLibrarySourceHandle(): Promise<FileSystemDirectoryHandle | null> {
    return settingsStore.getItem<FileSystemDirectoryHandle>("sourceHandle");
}

/**
 * Clear the library source handle
 */
export async function clearLibrarySourceHandle(): Promise<void> {
    await settingsStore.removeItem("sourceHandle");
    await updateSettings({ sourceFolderName: null });
}

/**
 * Get library settings
 */
export async function getSettings(): Promise<LibrarySettings> {
    const stored = await settingsStore.getItem<Partial<LibrarySettings>>("settings");
    return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Update library settings
 */
export async function updateSettings(
    updates: Partial<LibrarySettings>
): Promise<LibrarySettings> {
    const current = await getSettings();
    const updated = { ...current, ...updates };
    await settingsStore.setItem("settings", updated);
    return updated;
}

/**
 * Request permission for a stored directory handle
 * Returns true if permission was granted
 */
export async function requestPermission(
    handle: FileSystemDirectoryHandle
): Promise<boolean> {
    try {
        const permission = await handle.requestPermission({ mode: "read" });
        return permission === "granted";
    } catch {
        return false;
    }
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
    return "showDirectoryPicker" in window;
}
