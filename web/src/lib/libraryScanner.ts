/**
 * Library Scanner - Recursively scan folders for audio files
 * Uses File System Access API to read directory contents
 * 
 * OPTIMIZATION: Uses path+size based deduplication to avoid
 * re-scanning already indexed files on each app load.
 *
 * Files are never copied into the browser: a scan stores a handle to each file
 * and the player reads it from disk (#2503). Scanning a folder whose files are
 * already in the library (a rescan, or the same folder on a second device)
 * links those rows to this device instead of importing them again.
 */
import { extractMetadata } from "./metadataExtractor";
import {
    attachFileHandle,
    saveTrack,
    listTracks,
    listLocalTrackOmissions,
    updateLocalTrack,
    LocalTrack,
} from "./localLibrary";
import { fileNameOf, folderMetadataFromPath, pickFolderArtwork, titleFromFileName } from "./localFileNaming";

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff|m4a|ogg|wma|aac)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export interface ScanProgress {
    phase: "scanning" | "checking" | "indexing" | "complete";
    filesFound: number;
    filesIndexed: number;
    filesSkipped: number;
    currentFile: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;
export type TrackAddedCallback = (track: LocalTrack) => void;

interface FileEntry {
    handle: FileSystemFileHandle;
    path: string;
}

/** Each folder's sidecar cover image, keyed by the folder's relative path ("" for the picked folder). */
type FolderArtwork = Map<string, FileSystemFileHandle>;

function folderOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Recursively collect all audio files from a directory, and each folder's
 * cover image when it keeps one beside the tracks (Folder.jpg, cover.jpg…).
 */
async function collectAudioFiles(
    dirHandle: FileSystemDirectoryHandle,
    files: FileEntry[] = [],
    path: string = "",
    artwork: FolderArtwork = new Map(),
): Promise<FileEntry[]> {
    const images = new Map<string, FileSystemFileHandle>();
    for await (const entry of dirHandle.values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.kind === "directory") {
            await collectAudioFiles(entry, files, entryPath, artwork);
        } else if (entry.kind === "file" && AUDIO_EXTENSIONS.test(entry.name)) {
            files.push({ handle: entry, path: entryPath });
        } else if (entry.kind === "file" && IMAGE_EXTENSIONS.test(entry.name)) {
            images.set(entry.name, entry);
        }
    }
    const cover = pickFolderArtwork([...images.keys()]);
    if (cover) artwork.set(path, images.get(cover)!);
    return files;
}

type ExistingIndex = {
    /** "path:size" → the local library row for that file. */
    byFile: Map<string, LocalTrack>;
    /**
     * "name:size" → the row for that file, whatever folder it was reached
     * from. Adding a parent folder and one of its subfolders reaches the same
     * file under two relative paths; it is still one track.
     */
    byName: Map<string, LocalTrack>;
    /** Keys to skip without a row to link: removed files, legacy title matches. */
    skip: Set<string>;
};

/**
 * Build an index of existing tracks by path+size for fast lookup
 */
async function buildExistingIndex(): Promise<ExistingIndex> {
    const tracks = await listTracks();
    const byFile = new Map<string, LocalTrack>();
    const byName = new Map<string, LocalTrack>();
    const skip = new Set<string>();

    for (const track of tracks) {
        if (track.source !== "local") continue;
        if (track.sourcePath && track.fileSize) {
            byFile.set(`${track.sourcePath}:${track.fileSize}`, track);
            const nameKey = `${fileNameOf(track.sourcePath)}:${track.fileSize}`;
            if (!byName.has(nameKey)) byName.set(nameKey, track);
        } else if (track.title) {
            // Rows imported before paths were recorded can only match by title.
            skip.add(`title:${track.title}`);
        }
    }

    for (const key of await listLocalTrackOmissions()) {
        skip.add(key);
    }

    return { byFile, byName, skip };
}

function findExisting(index: ExistingIndex, path: string, size: number): LocalTrack | undefined {
    return index.byFile.get(`${path}:${size}`) ?? index.byName.get(`${fileNameOf(path)}:${size}`);
}

/** Tags the file lacks, filled from its file name and folders. */
function fallbackMetadata(path: string, rootName: string) {
    return {
        title: titleFromFileName(fileNameOf(path)),
        ...folderMetadataFromPath(path, rootName),
    };
}

/**
 * A row imported before folder fallbacks: its title is the raw file name and
 * it has no artist or album. Edited rows never match, so edits stay.
 */
function needsNameRepair(track: LocalTrack, path: string): boolean {
    const rawName = fileNameOf(path).replace(/\.[^/.]+$/, "");
    return track.title === rawName && !track.artist && !track.album;
}

async function readFolderArtwork(
    artwork: FolderArtwork,
    cache: Map<string, Promise<Blob | null>>,
    path: string,
): Promise<Blob | null> {
    const folder = folderOf(path);
    const handle = artwork.get(folder);
    if (!handle) return null;
    let pending = cache.get(folder);
    if (!pending) {
        pending = handle.getFile().then((file) => file as Blob, () => null);
        cache.set(folder, pending);
    }
    return pending;
}

/**
 * Scan a directory and index only NEW audio files
 * Skips files that are already indexed (by path+size match)
 */
export async function scanAndIndex(
    dirHandle: FileSystemDirectoryHandle,
    onProgress?: ScanProgressCallback,
    onTrackAdded?: TrackAddedCallback
): Promise<{ added: number; skipped: number; total: number }> {
    // Phase 1: Scan filesystem for audio files
    onProgress?.({
        phase: "scanning",
        filesFound: 0,
        filesIndexed: 0,
        filesSkipped: 0,
        currentFile: "",
    });

    const folderArtwork: FolderArtwork = new Map();
    const audioFiles = await collectAudioFiles(dirHandle, [], "", folderArtwork);
    const artworkCache = new Map<string, Promise<Blob | null>>();

    // Phase 2: Build index of existing tracks for O(1) lookup
    onProgress?.({
        phase: "checking",
        filesFound: audioFiles.length,
        filesIndexed: 0,
        filesSkipped: 0,
        currentFile: "Building index...",
    });

    const existingIndex = await buildExistingIndex();

    // Identify which files need indexing
    const toIndex: { file: File; handle: FileSystemFileHandle; path: string }[] = [];
    let skipped = 0;

    for (const { handle, path } of audioFiles) {
        const file = await handle.getFile();
        const key = `${path}:${file.size}`;
        const titleKey = `title:${file.name.replace(/\.[^/.]+$/, "")}`;
        const existing = findExisting(existingIndex, path, file.size);

        if (existing && !existing.id) {
            // A second copy of a file this scan is already importing.
            skipped++;
        } else if (existing) {
            // Already in the library: make sure this device can play it, and
            // give rows imported before folder fallbacks their names and cover.
            if (!existing.available) await attachFileHandle(existing, handle);
            try {
                await repairExisting(existing, path);
            } catch (error) {
                console.warn(`[Scanner] Could not refresh ${path}:`, error);
            }
            skipped++;
        } else if (existingIndex.skip.has(key) || existingIndex.skip.has(titleKey)) {
            skipped++;
        } else {
            toIndex.push({ file, handle, path });
            // A second copy reached through another folder in this same scan.
            const placeholder = { id: "", source: "local", sourcePath: path, fileSize: file.size } as LocalTrack;
            existingIndex.byName.set(`${fileNameOf(path)}:${file.size}`, placeholder);
        }
    }

    async function repairExisting(existing: LocalTrack, path: string) {
        if (!existing.id) return;
        const patch: Partial<LocalTrack> = {};
        if (needsNameRepair(existing, path)) {
            const fallback = fallbackMetadata(path, dirHandle.name);
            if (fallback.title !== existing.title) patch.title = fallback.title;
            if (fallback.album) patch.album = fallback.album;
            if (fallback.artist) patch.artist = fallback.artist;
        }
        const artwork = existing.artworkKey ? null : await readFolderArtwork(folderArtwork, artworkCache, path);
        if (Object.keys(patch).length === 0 && !artwork) return;
        await updateLocalTrack(existing, patch, artwork);
    }

    // Phase 3: Index only new files
    let added = 0;

    for (let i = 0; i < toIndex.length; i++) {
        const { file, handle, path } = toIndex[i]!;

        onProgress?.({
            phase: "indexing",
            filesFound: audioFiles.length,
            filesIndexed: i + 1,
            filesSkipped: skipped,
            currentFile: file.name,
        });

        try {
            const metadata = await extractMetadata(file);
            const fallback = fallbackMetadata(path, dirHandle.name);
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const hasTitleTag = Boolean(metadata.title && metadata.title !== rawName);
            const artwork = metadata.artworkBlob ?? await readFolderArtwork(folderArtwork, artworkCache, path);

            const newTrack = await saveTrack({ handle }, {
                title: hasTitleTag ? metadata.title! : fallback.title,
                artist: metadata.artist ?? fallback.artist,
                albumArtist: metadata.albumArtist,
                album: metadata.album ?? fallback.album,
                year: metadata.year,
                genre: metadata.genre,
                duration: metadata.duration,
                sourcePath: path,
                fileSize: file.size,
            }, artwork);

            // Notify UI immediately after saving
            onTrackAdded?.(newTrack);

            added++;
        } catch (error) {
            console.error(`[Scanner] Failed to index ${path}:`, error);
            skipped++;
        }
    }

    onProgress?.({
        phase: "complete",
        filesFound: audioFiles.length,
        filesIndexed: added,
        filesSkipped: skipped,
        currentFile: "",
    });

    return { added, skipped, total: audioFiles.length };
}

/**
 * Quick scan to count new files without indexing
 */
export async function countNewFiles(
    dirHandle: FileSystemDirectoryHandle
): Promise<number> {
    const audioFiles = await collectAudioFiles(dirHandle);
    const existingIndex = await buildExistingIndex();

    let newCount = 0;
    for (const { handle, path } of audioFiles) {
        const file = await handle.getFile();
        const key = `${path}:${file.size}`;
        const titleKey = `title:${file.name.replace(/\.[^/.]+$/, "")}`;

        if (!findExisting(existingIndex, path, file.size) && !existingIndex.skip.has(key) && !existingIndex.skip.has(titleKey)) {
            newCount++;
        }
    }

    return newCount;
}
