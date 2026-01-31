/**
 * Metadata Extractor - Client-side audio metadata extraction
 * Uses music-metadata to parse ID3 tags and other audio metadata
 */
import type { IAudioMetadata } from "music-metadata";

export interface ExtractedMetadata {
    title: string | null;
    artist: string | null;
    albumArtist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    label: string | null;
    isrc: string | null;
    duration: number | null;
    artworkBlob: Blob | null;
}

/**
 * Extract artwork from parsed metadata as a Blob
 */
function extractArtworkFromMetadata(metadata: IAudioMetadata): Blob | null {
    // 1. Check common metadata (highest level abstraction)
    const pictures = metadata.common.picture;
    if (pictures && pictures.length > 0) {
        const pic = pictures[0];
        return new Blob([new Uint8Array(pic.data)], { type: pic.format });
    }

    // 2. Fallback: Scan all native tags for anything that looks like a picture
    // This is crucial for WAV/AIFF/FLAC where metadata might be in non-standard chunks
    if (metadata.native) {
        for (const tagType in metadata.native) {
            const tags = metadata.native[tagType];
            for (const tag of tags) {
                // music-metadata pictures in native tags often have a value with 'data' and 'format'
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const val = tag.value as any;
                if (val && typeof val === 'object' && val.data && (val.format || val.mime || (typeof val.type === 'string' && val.type.startsWith('image/')))) {
                    return new Blob([new Uint8Array(val.data)], { type: val.format || val.mime || val.type });
                }

                // Specifically for ID3v2 APIC/PIC frames if they weren't mapped to common
                if ((tag.id === 'APIC' || tag.id === 'PIC' || tag.id === 'metadata:picture') && val && val.data) {
                    return new Blob([new Uint8Array(val.data)], { type: val.format || 'image/jpeg' });
                }
            }
        }
    }

    return null;
}

/**
 * Extract metadata from an audio file
 */
export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
    try {
        const { parseBlob } = await import("music-metadata");
        // Using duration:true to ensure we hit the end of the file where some tags might hide
        const metadata: IAudioMetadata = await parseBlob(file, { duration: true });
        const common = metadata.common;
        const format = metadata.format;

        // Debug logging for non-MP3 files that might have issues
        if (!file.type.includes("mpeg")) {
            console.log(`[MetadataExtractor] Parsing ${file.name} (${file.type}):`, {
                hasCommonArt: !!common.picture?.length,
                nativeTags: Object.keys(metadata.native || {}),
                commonKeys: Object.keys(common),
                format: format.container
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dateStr = common.year?.toString() || (common as any).date?.toString();
        const year = dateStr ? parseInt(dateStr.substring(0, 4)) : null;

        return {
            title: common.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: common.artist || common.albumartist || null,
            albumArtist: common.albumartist || null,
            album: common.album || null,
            year: year,
            genre: common.genre?.[0] || null,
            label: common.label?.[0] || common.copyright || null,
            isrc: common.isrc?.[0] || null,
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
            label: null,
            isrc: null,
            duration: null,
            artworkBlob: null,
        };
    }
}

/**
 * Format duration in seconds to mm:ss
 */
export function formatDuration(seconds: number | string | null | undefined): string {
    const s = typeof seconds === 'string' ? parseFloat(seconds) : seconds;
    if (s === null || s === undefined || isNaN(s) || s < 0) return "--:--";
    if (s === 0) return "0:00";
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}
