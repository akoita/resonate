/**
 * Metadata Extractor - Client-side audio metadata extraction
 * Uses music-metadata-browser to parse ID3 tags and other audio metadata
 */
import { parseBlob, type IAudioMetadata } from "music-metadata-browser";

export interface ExtractedMetadata {
    title: string | null;
    artist: string | null;
    albumArtist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
    artworkBlob: Blob | null;
}

/**
 * Extract artwork from parsed metadata as a Blob
 */
function extractArtworkFromMetadata(metadata: IAudioMetadata): Blob | null {
    const pictures = metadata.common.picture;
    if (!pictures || pictures.length === 0) {
        return null;
    }

    // Use the first picture (usually the front cover)
    const picture = pictures[0];
    if (!picture) {
        return null;
    }

    // Convert Buffer to Uint8Array then to Blob with proper MIME type
    const uint8Array = new Uint8Array(picture.data);
    return new Blob([uint8Array], { type: picture.format });
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
            albumArtist: common.albumartist || null,
            album: common.album || null,
            year: common.year || null,
            genre: common.genre?.[0] || null,
            duration: format.duration || null,
            artworkBlob: extractArtworkFromMetadata(metadata),
        };
    } catch (error) {
        console.error("[MetadataExtractor] Failed to parse metadata:", error);
        // Fallback to filename if parsing fails
        return {
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: null,
            albumArtist: null,
            album: null,
            year: null,
            genre: null,
            duration: null,
            artworkBlob: null,
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
