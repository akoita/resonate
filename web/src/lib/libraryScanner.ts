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
import { attachFileHandle, saveTrack, listTracks, listLocalTrackOmissions, LocalTrack } from "./localLibrary";

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff|m4a|ogg|wma|aac)$/i;

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

/**
 * Recursively collect all audio files from a directory
 */
async function collectAudioFiles(
    dirHandle: FileSystemDirectoryHandle,
    files: FileEntry[] = [],
    path: string = ""
): Promise<FileEntry[]> {
    for await (const entry of dirHandle.values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.kind === "directory") {
            await collectAudioFiles(entry, files, entryPath);
        } else if (entry.kind === "file" && AUDIO_EXTENSIONS.test(entry.name)) {
            files.push({ handle: entry, path: entryPath });
        }
    }
    return files;
}

type ExistingIndex = {
    /** "path:size" → the local library row for that file. */
    byFile: Map<string, LocalTrack>;
    /** Keys to skip without a row to link: removed files, legacy title matches. */
    skip: Set<string>;
};

/**
 * Build an index of existing tracks by path+size for fast lookup
 */
async function buildExistingIndex(): Promise<ExistingIndex> {
    const tracks = await listTracks();
    const byFile = new Map<string, LocalTrack>();
    const skip = new Set<string>();

    for (const track of tracks) {
        if (track.source !== "local") continue;
        if (track.sourcePath && track.fileSize) {
            byFile.set(`${track.sourcePath}:${track.fileSize}`, track);
        } else if (track.title) {
            // Rows imported before paths were recorded can only match by title.
            skip.add(`title:${track.title}`);
        }
    }

    for (const key of await listLocalTrackOmissions()) {
        skip.add(key);
    }

    return { byFile, skip };
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

    const audioFiles = await collectAudioFiles(dirHandle);

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
        const existing = existingIndex.byFile.get(key);

        if (existing) {
            // Already in the library: make sure this device can play it.
            if (!existing.available) await attachFileHandle(existing, handle);
            skipped++;
        } else if (existingIndex.skip.has(key) || existingIndex.skip.has(titleKey)) {
            skipped++;
        } else {
            toIndex.push({ file, handle, path });
        }
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

            const newTrack = await saveTrack({ handle }, {
                title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
                artist: metadata.artist,
                albumArtist: metadata.albumArtist,
                album: metadata.album,
                year: metadata.year,
                genre: metadata.genre,
                duration: metadata.duration,
                sourcePath: path,
                fileSize: file.size,
            }, metadata.artworkBlob);

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

        if (!existingIndex.byFile.has(key) && !existingIndex.skip.has(key) && !existingIndex.skip.has(titleKey)) {
            newCount++;
        }
    }

    return newCount;
}
