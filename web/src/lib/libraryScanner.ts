/**
 * Library Scanner - Recursively scan folders for audio files
 * Uses File System Access API to read directory contents
 * 
 * OPTIMIZATION: Uses path+size based deduplication to avoid
 * re-scanning already indexed files on each app load.
 */
import { extractMetadata } from "./metadataExtractor";
import { saveTrack, listTracks } from "./localLibrary";

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff|m4a|ogg|wma|aac)$/i;

export interface ScanProgress {
    phase: "scanning" | "checking" | "indexing" | "complete";
    filesFound: number;
    filesIndexed: number;
    filesSkipped: number;
    currentFile: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

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

/**
 * Build an index of existing tracks by path+size for fast lookup
 */
async function buildExistingIndex(): Promise<Map<string, number>> {
    const tracks = await listTracks();
    const index = new Map<string, number>();

    for (const track of tracks) {
        if (track.sourcePath && track.fileSize) {
            // Key: "path:size" for exact match
            index.set(`${track.sourcePath}:${track.fileSize}`, 1);
        }
        // Also index by title for backwards compatibility
        if (track.title) {
            index.set(`title:${track.title}`, 1);
        }
    }

    return index;
}

/**
 * Scan a directory and index only NEW audio files
 * Skips files that are already indexed (by path+size match)
 */
export async function scanAndIndex(
    dirHandle: FileSystemDirectoryHandle,
    onProgress?: ScanProgressCallback
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
    const toIndex: { file: File; path: string }[] = [];
    let skipped = 0;

    for (const { handle, path } of audioFiles) {
        const file = await handle.getFile();
        const key = `${path}:${file.size}`;
        const titleKey = `title:${file.name.replace(/\.[^/.]+$/, "")}`;

        if (existingIndex.has(key) || existingIndex.has(titleKey)) {
            skipped++;
        } else {
            toIndex.push({ file, path });
        }
    }

    // Phase 3: Index only new files
    let added = 0;

    for (let i = 0; i < toIndex.length; i++) {
        const { file, path } = toIndex[i]!;

        onProgress?.({
            phase: "indexing",
            filesFound: audioFiles.length,
            filesIndexed: i + 1,
            filesSkipped: skipped,
            currentFile: file.name,
        });

        try {
            const metadata = await extractMetadata(file);

            await saveTrack(file, {
                title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
                artist: metadata.artist,
                album: metadata.album,
                year: metadata.year,
                genre: metadata.genre,
                duration: metadata.duration,
                sourcePath: path,
                fileSize: file.size,
            });

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

        if (!existingIndex.has(key) && !existingIndex.has(titleKey)) {
            newCount++;
        }
    }

    return newCount;
}
