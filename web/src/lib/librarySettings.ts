/**
 * Library Settings - Persistent storage for library configuration
 * Uses IndexedDB to store File System Access API directory handles
 * Supports multiple local FS sources (list of folders).
 */
import localforage from "localforage";

const settingsStore = localforage.createInstance({
    name: "resonate",
    storeName: "librarySettings",
});

const SOURCE_HANDLES_KEY = "sourceHandles";
const LEGACY_SOURCE_HANDLE_KEY = "sourceHandle";

export interface LibrarySettings {
    autoScanOnLoad: boolean;
    lastScanTime: string | null;
    /** Display names of configured source folders (parallel to stored handles) */
    sourceFolderNames: string[];
}

const DEFAULT_SETTINGS: LibrarySettings = {
    autoScanOnLoad: true,
    lastScanTime: null,
    sourceFolderNames: [],
};

/**
 * Migrate legacy single handle to sourceHandles array (one-time)
 */
async function migrateLegacyHandleIfNeeded(): Promise<void> {
    const legacy = await settingsStore.getItem<FileSystemDirectoryHandle>(LEGACY_SOURCE_HANDLE_KEY);
    if (!legacy) return;

    const existing = await settingsStore.getItem<FileSystemDirectoryHandle[]>(SOURCE_HANDLES_KEY);
    if (existing && existing.length > 0) return;

    await settingsStore.setItem(SOURCE_HANDLES_KEY, [legacy]);
    await settingsStore.removeItem(LEGACY_SOURCE_HANDLE_KEY);
    const s = await getSettings();
    await updateSettings({ sourceFolderNames: [...(s.sourceFolderNames || []), legacy.name] });
}

/**
 * Get the list of library source directory handles
 */
export async function getLibrarySourceHandles(): Promise<FileSystemDirectoryHandle[]> {
    await migrateLegacyHandleIfNeeded();
    const handles = await settingsStore.getItem<FileSystemDirectoryHandle[]>(SOURCE_HANDLES_KEY);
    return Array.isArray(handles) ? handles : [];
}

/**
 * Check if a handle refers to the same folder as any in the list (uses isSameEntry when available)
 */
async function isSameFolderAsExisting(
    handle: FileSystemDirectoryHandle,
    existing: FileSystemDirectoryHandle[]
): Promise<boolean> {
    if (typeof (handle as FileSystemHandle).isSameEntry !== "function") return false;
    for (const h of existing) {
        try {
            if (await (handle as FileSystemHandle).isSameEntry(h)) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

/**
 * Add a directory handle to the library sources list.
 * Returns false if this folder is already in the list (same entry); true if added.
 */
export async function addLibrarySourceHandle(
    handle: FileSystemDirectoryHandle
): Promise<boolean> {
    await migrateLegacyHandleIfNeeded();
    const handles = await getLibrarySourceHandles();
    if (await isSameFolderAsExisting(handle, handles)) return false;
    const next = [...handles, handle];
    await settingsStore.setItem(SOURCE_HANDLES_KEY, next);
    const s = await getSettings();
    await updateSettings({
        sourceFolderNames: [...(s.sourceFolderNames || []), handle.name],
    });
    return true;
}

/**
 * Return library source handles deduplicated by same entry (so we don't scan the same folder twice).
 */
export async function getUniqueLibrarySourceHandles(): Promise<FileSystemDirectoryHandle[]> {
    const handles = await getLibrarySourceHandles();
    if (handles.length <= 1) return handles;
    if (typeof (handles[0] as FileSystemHandle).isSameEntry !== "function") return handles;
    const unique: FileSystemDirectoryHandle[] = [];
    for (const h of handles) {
        let isDup = false;
        for (const u of unique) {
            try {
                if (await (h as FileSystemHandle).isSameEntry(u)) {
                    isDup = true;
                    break;
                }
            } catch {
                // ignore
            }
        }
        if (!isDup) unique.push(h);
    }
    return unique;
}

/**
 * Remove a library source by index
 */
export async function removeLibrarySourceHandle(index: number): Promise<void> {
    await migrateLegacyHandleIfNeeded();
    const handles = await getLibrarySourceHandles();
    if (index < 0 || index >= handles.length) return;
    const nextHandles = handles.filter((_, i) => i !== index);
    await settingsStore.setItem(SOURCE_HANDLES_KEY, nextHandles);
    // Derive names from remaining handles so we stay in sync
    const nextNames = nextHandles.map((h) => h.name);
    await updateSettings({ sourceFolderNames: nextNames });
}

/**
 * Clear all library source handles
 */
export async function clearLibrarySourceHandles(): Promise<void> {
    await settingsStore.removeItem(SOURCE_HANDLES_KEY);
    await settingsStore.removeItem(LEGACY_SOURCE_HANDLE_KEY);
    await updateSettings({ sourceFolderNames: [] });
}

/**
 * Get the first library source handle (for backward compatibility)
 * @deprecated Prefer getLibrarySourceHandles() for multi-source support
 */
export async function getLibrarySourceHandle(): Promise<FileSystemDirectoryHandle | null> {
    const handles = await getLibrarySourceHandles();
    return handles[0] ?? null;
}

/**
 * Store a single library source (replaces list with one entry – for backward compat)
 * @deprecated Prefer addLibrarySourceHandle() for multi-source support
 */
export async function setLibrarySourceHandle(
    handle: FileSystemDirectoryHandle
): Promise<void> {
    await settingsStore.setItem(SOURCE_HANDLES_KEY, [handle]);
    await updateSettings({ sourceFolderNames: [handle.name] });
}

/**
 * Clear the single library source (legacy)
 * @deprecated Prefer clearLibrarySourceHandles()
 */
export async function clearLibrarySourceHandle(): Promise<void> {
    await clearLibrarySourceHandles();
}

/**
 * Get library settings
 */
export async function getSettings(): Promise<LibrarySettings> {
    const stored = await settingsStore.getItem<Partial<LibrarySettings>>("settings");
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if ("sourceFolderName" in (stored || {})) {
        const legacy = (stored as { sourceFolderName?: string | null }).sourceFolderName;
        if (legacy && !merged.sourceFolderNames?.length) {
            merged.sourceFolderNames = [legacy];
        }
    }
    return merged;
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
