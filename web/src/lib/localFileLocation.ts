/**
 * Where one of the listener's own files lives, for the "File location" action.
 *
 * Browsers never reveal a drive path such as `F:\Discs\…`; a file is only
 * known relative to the folder the listener added. On the device that links
 * the file we name that folder and can open the system file picker there.
 */
import { getFileHandle, type LocalTrack } from "./localLibrary";
import { getLibrarySourceHandles } from "./librarySettings";

export type LocalFileLocation = {
    /** The added folder's name, when this device still has it. */
    folderName: string | null;
    /** Folder name and path inside it, joined with the platform-neutral "/". */
    displayPath: string;
    /** The file on this device, or null when it lives on another device. */
    handle: FileSystemFileHandle | null;
};

export async function getLocalFileLocation(track: LocalTrack): Promise<LocalFileLocation> {
    const fallbackPath = track.sourcePath || track.title;
    const handle = await getFileHandle(track.id).catch(() => null);
    if (!handle) return { folderName: null, displayPath: fallbackPath, handle: null };

    for (const folder of await getLibrarySourceHandles().catch(() => [])) {
        try {
            const parts = typeof folder.resolve === "function" ? await folder.resolve(handle) : null;
            if (parts) {
                return { folderName: folder.name, displayPath: [folder.name, ...parts].join("/"), handle };
            }
        } catch {
            // A folder the browser can no longer read: try the next one.
        }
    }
    return { folderName: null, displayPath: fallbackPath, handle };
}

type PickerWindow = Window & {
    showOpenFilePicker?: (options: { startIn?: FileSystemHandle; multiple?: boolean }) => Promise<unknown>;
};

/**
 * Open the system file picker in the folder that holds the file. The browser
 * cannot open the file manager itself; the picker shows the same folder.
 * Returns false when the browser has no picker.
 */
export async function revealInFilePicker(handle: FileSystemFileHandle): Promise<boolean> {
    const picker = (globalThis as unknown as PickerWindow).showOpenFilePicker;
    if (typeof picker !== "function") return false;
    try {
        await picker({ startIn: handle, multiple: false });
    } catch (error) {
        // Closing the picker is the expected way out.
        if ((error as { name?: string })?.name !== "AbortError") throw error;
    }
    return true;
}
