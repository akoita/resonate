/**
 * Metadata Extractor - Client-side audio metadata extraction
 * Uses music-metadata-browser to parse ID3 tags and other audio metadata
 */
import { parseBlob, type IAudioMetadata } from "music-metadata-browser";

export interface ExtractedMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
}

/**
 * Extract metadata from an audio file
 */
export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
    try {
        const metadata: IAudioMetadata = await parseBlob(file);
        const common = metadata.common;
        const format = metadata.format;

        return {
            title: common.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: common.artist || null,
            album: common.album || null,
            year: common.year || null,
            genre: common.genre?.[0] || null,
            duration: format.duration || null,
        };
    } catch (error) {
        console.error("[MetadataExtractor] Failed to parse metadata:", error);
        // Fallback to filename if parsing fails
        return {
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: null,
            album: null,
            year: null,
            genre: null,
            duration: null,
        };
    }
}

/**
 * Format duration in seconds to mm:ss
 */
export function formatDuration(seconds: number | null): string {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}
