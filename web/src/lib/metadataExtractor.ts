/**
 * Metadata Extractor - Client-side audio metadata extraction
 * Uses music-metadata to parse ID3 tags and other audio metadata
 */
import type { IAudioMetadata, ICommonTagsResult } from "music-metadata";

/** The tags Resonate reads from a file, shared by release upload and the local library. */
export interface ExtractedTags {
    title: string | null;
    artist: string | null;
    albumArtist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    label: string | null;
    isrc: string | null;
    /** Position on the album, from "2" or "2/18". */
    trackNumber: number | null;
    discNumber: number | null;
    /** The ℗/© line. */
    copyright: string | null;
    composer: string | null;
    producer: string | null;
}

export interface ExtractedMetadata extends ExtractedTags {
    duration: number | null;
    artworkBlob: Blob | null;
}

const EMPTY_TAGS: Omit<ExtractedTags, "title"> = {
    artist: null,
    albumArtist: null,
    album: null,
    year: null,
    genre: null,
    label: null,
    isrc: null,
    trackNumber: null,
    discNumber: null,
    copyright: null,
    composer: null,
    producer: null,
};

/** A four-digit year from a year or date tag ("2022", "2022-07-08", 2022). */
function yearFrom(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const match = /(\d{4})/.exec(String(value));
    if (!match) return null;
    const year = Number(match[1]);
    return year >= 1000 && year <= 2999 ? year : null;
}

function positionFrom(value: number | null | undefined, max: number): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

function text(value: string | string[] | null | undefined): string | null {
    const first = Array.isArray(value) ? value.find((v) => v && v.trim()) : value;
    const trimmed = first?.trim();
    return trimmed ? trimmed : null;
}

/** Join a multi-value credit ("A", "B") into one line. */
function credit(values: string[] | undefined): string | null {
    const names = (values ?? []).map((v) => v.trim()).filter(Boolean);
    return names.length > 0 ? [...new Set(names)].join(", ") : null;
}

/**
 * Map music-metadata's common tags to Resonate's. The year falls back from the
 * recording year to the release and original dates, which some rippers and
 * stores write instead.
 */
export function tagsFromCommon(common: Partial<ICommonTagsResult>, fileName: string): ExtractedTags {
    return {
        title: text(common.title) || fileName.replace(/\.[^/.]+$/, ""),
        artist: text(common.artist) || text(common.albumartist),
        albumArtist: text(common.albumartist),
        album: text(common.album),
        year: yearFrom(common.year) ?? yearFrom(common.date) ?? yearFrom(common.releasedate)
            ?? yearFrom(common.originalyear) ?? yearFrom(common.originaldate),
        genre: text(common.genre),
        label: text(common.label),
        isrc: text(common.isrc),
        trackNumber: positionFrom(common.track?.no, 999),
        discNumber: positionFrom(common.disk?.no, 99),
        copyright: text(common.copyright),
        composer: credit(common.composer),
        producer: credit(common.producer),
    };
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

        const tags = tagsFromCommon(common, file.name);
        return {
            ...tags,
            duration: format.duration || null,
            artworkBlob: extractArtworkFromMetadata(metadata),
        };
    } catch (error) {
        console.error("[MetadataExtractor] Failed to parse metadata:", error);
        // Fallback to filename if parsing fails
        return {
            ...EMPTY_TAGS,
            title: file.name.replace(/\.[^/.]+$/, ""),
            duration: null,
            artworkBlob: null,
        };
    }
}

/**
 * Read only the tags of a file: no cover, no full scan for the duration. Used
 * to fill in tags on files imported before Resonate read them.
 */
export async function extractTags(file: File): Promise<ExtractedTags | null> {
    try {
        const { parseBlob } = await import("music-metadata");
        const metadata = await parseBlob(file, { duration: false, skipCovers: true });
        return tagsFromCommon(metadata.common, file.name);
    } catch (error) {
        console.warn("[MetadataExtractor] Could not read tags:", error);
        return null;
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
