/**
 * Library Scanner - Recursively scan folders for audio files
 * Uses File System Access API to read directory contents
 */
import { extractMetadata } from "./metadataExtractor";
import { saveTrack, listTracks } from "./localLibrary";

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aiff|m4a|ogg|wma|aac)$/i;

export interface ScanProgress {
    phase: "scanning" | "indexing" | "complete";
    filesFound: number;
    filesIndexed: number;
    currentFile: string;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Recursively collect all audio files from a directory
 */
async function collectAudioFiles(
    dirHandle: FileSystemDirectoryHandle,
    files: { handle: FileSystemFileHandle; path: string }[] = [],
    path: string = ""
): Promise<{ handle: FileSystemFileHandle; path: string }[]> {
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
 * Scan a directory and index all new audio files
 */
export async function scanAndIndex(
    dirHandle: FileSystemDirectoryHandle,
    onProgress?: ScanProgressCallback
): Promise<{ added: number; skipped: number; total: number }> {
    // Phase 1: Scan for audio files
    onProgress?.({
        phase: "scanning",
        filesFound: 0,
        filesIndexed: 0,
        currentFile: "",
    });

    const audioFiles = await collectAudioFiles(dirHandle);

    // Get existing tracks to avoid duplicates
    const existingTracks = await listTracks();
    const existingPaths = new Set(
        existingTracks.map((t) => t.title) // Use title as rough dedup key
    );

    let added = 0;
    let skipped = 0;

    // Phase 2: Index new files
    for (let i = 0; i < audioFiles.length; i++) {
        const { handle, path } = audioFiles[i]!;

        onProgress?.({
            phase: "indexing",
            filesFound: audioFiles.length,
            filesIndexed: i + 1,
            currentFile: handle.name,
        });

        try {
            const file = await handle.getFile();
            const metadata = await extractMetadata(file);

            // Skip if already exists (by title match)
            if (existingPaths.has(metadata.title || file.name)) {
                skipped++;
                continue;
            }

            await saveTrack(file, {
                title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
                artist: metadata.artist,
                album: metadata.album,
                year: metadata.year,
                genre: metadata.genre,
                duration: metadata.duration,
            });

            existingPaths.add(metadata.title || file.name);
            added++;
        } catch (error) {
            console.error(`[Scanner] Failed to index ${path}:`, error);
            skipped++;
        }
    }

    onProgress?.({
        phase: "complete",
        filesFound: audioFiles.length,
        filesIndexed: audioFiles.length,
        currentFile: "",
    });

    return { added, skipped, total: audioFiles.length };
}

/**
 * Quick scan to check for new files without full indexing
 */
export async function countNewFiles(
    dirHandle: FileSystemDirectoryHandle
): Promise<number> {
    const audioFiles = await collectAudioFiles(dirHandle);
    const existingTracks = await listTracks();
    const existingTitles = new Set(existingTracks.map((t) => t.title));

    let newCount = 0;
    for (const { handle } of audioFiles) {
        const name = handle.name.replace(/\.[^/.]+$/, "");
        if (!existingTitles.has(name)) {
            newCount++;
        }
    }

    return newCount;
}
