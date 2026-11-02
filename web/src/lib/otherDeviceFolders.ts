/**
 * Local files across devices.
 *
 * The library (titles, paths inside each folder, sizes, folder names) is part
 * of the account; the audio never leaves the device it lives on. A file plays
 * on whichever device can reach it: adding the same folder on another device
 * links every file whose path inside that folder and size match, and those
 * rows become playable there too. Nothing is copied or uploaded.
 *
 * Browsers never reveal where a folder sits on disk and cannot open one by
 * path, so the account only knows each folder's name. This module groups the
 * files this device cannot reach by that name, so the library can say "Add the
 * folder “Caravelle” here" instead of leaving the listener to guess.
 */
import { isOnOtherDevice, type LocalTrack } from "./localLibrary";
import { addLibrarySourceHandle, getLibrarySourceHandles } from "./librarySettings";
import { scanAndIndex } from "./libraryScanner";

export type OtherDeviceFolder = {
    /** The folder's name on the device that added it; null for files imported before names were kept. */
    name: string | null;
    /** How many files from that folder this device cannot play yet. */
    count: number;
};

/** Files this device cannot reach, grouped by library folder, largest first. */
export function summarizeOtherDeviceFolders(
    tracks: ReadonlyArray<Pick<LocalTrack, "source" | "available" | "sourceFolder">>,
): OtherDeviceFolder[] {
    const counts = new Map<string | null, number>();
    for (const track of tracks) {
        if (!isOnOtherDevice(track)) continue;
        const name = track.sourceFolder?.trim() || null;
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
            // Unnamed files last: there is no folder to point at.
            if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
            return b.count - a.count || (a.name ?? "").localeCompare(b.name ?? "");
        });
}

export type LinkFolderResult =
    /** The listener closed the picker. */
    | { status: "cancelled" }
    /** The folder was scanned. `linked` files from other devices now play here. */
    | { status: "scanned"; folderName: string; linked: number; added: number; alreadyAdded: boolean };

type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

/**
 * Ask for a folder on this device, add it to the library sources, and scan it.
 * Files already in the account are linked here, not imported again. Picking a
 * folder that is already a source just rescans it.
 */
export async function addFolderOnThisDevice(): Promise<LinkFolderResult> {
    const picker = (globalThis as unknown as DirectoryPickerWindow).showDirectoryPicker;
    if (typeof picker !== "function") throw new Error("This browser cannot open folders");
    let handle: FileSystemDirectoryHandle;
    try {
        handle = await picker({ mode: "read" });
    } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return { status: "cancelled" };
        throw error;
    }
    const added = await addLibrarySourceHandle(handle);
    let scanTarget = handle;
    if (!added) {
        // Already a source: scan the stored handle, which keeps its permission.
        for (const existing of await getLibrarySourceHandles()) {
            try {
                if (await existing.isSameEntry(handle)) {
                    scanTarget = existing;
                    break;
                }
            } catch {
                // Unreadable stored handle: scan the fresh one.
            }
        }
    }
    const result = await scanAndIndex(scanTarget);
    return {
        status: "scanned",
        folderName: handle.name,
        linked: result.linked,
        added: result.added,
        alreadyAdded: !added,
    };
}

/** One sentence for the toast after a folder is linked. */
export function describeLinkResult(result: Extract<LinkFolderResult, { status: "scanned" }>): string {
    const parts: string[] = [];
    if (result.linked > 0) {
        parts.push(`${result.linked} file${result.linked === 1 ? "" : "s"} from your other devices now play${result.linked === 1 ? "s" : ""} here.`);
    }
    if (result.added > 0) {
        parts.push(`${result.added} new file${result.added === 1 ? "" : "s"} added.`);
    }
    if (parts.length === 0) {
        return `Nothing in “${result.folderName}” matched files from your other devices. Pick the folder that holds them, with the same layout inside.`;
    }
    return parts.join(" ");
}
