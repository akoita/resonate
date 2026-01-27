/**
 * Library Grouping Utilities
 * Organize tracks into Artists and Albums for structured browsing
 */
import { LocalTrack } from "./localLibrary";

export interface Artist {
    name: string;
    trackCount: number;
    albums: string[];
}

export interface Album {
    name: string;
    artist: string;
    year: number | null;
    trackCount: number;
    tracks: LocalTrack[];
}

/**
 * Group tracks by artist
 */
export function groupByArtist(tracks: LocalTrack[]): Artist[] {
    const artistMap = new Map<string, { trackCount: number; albums: Set<string> }>();

    for (const track of tracks) {
        const artistName = track.artist || "Unknown Artist";
        const existing = artistMap.get(artistName);

        if (existing) {
            existing.trackCount++;
            if (track.album) {
                existing.albums.add(track.album);
            }
        } else {
            artistMap.set(artistName, {
                trackCount: 1,
                albums: new Set(track.album ? [track.album] : []),
            });
        }
    }

    return Array.from(artistMap.entries())
        .map(([name, data]) => ({
            name,
            trackCount: data.trackCount,
            albums: Array.from(data.albums),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Normalize strings for comparison (lowercase, remove dots, extra spaces)
 */
function normalizeForGrouping(str: string): string {
    return str
        .toLowerCase()
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Group tracks by album
 * Aggregates tracks by normalized (Artist + Album) to handle variations
 */
export function groupByAlbum(tracks: LocalTrack[]): Album[] {
    const albumMap = new Map<string, Album>();

    for (const track of tracks) {
        // Use normalized forms for grouping but keep original for display
        const rawAlbum = track.album || "Unknown Album";
        const rawArtist = track.albumArtist || track.artist || "Unknown Artist";

        const normAlbum = normalizeForGrouping(rawAlbum);
        const normArtist = normalizeForGrouping(rawArtist);

        // Key: Normalized Artist + Album
        const key = `${normArtist}::${normAlbum}`;

        const existing = albumMap.get(key);
        if (existing) {
            existing.trackCount++;
            existing.tracks.push(track);

            // Prefer the track with a year if the first didn't have one
            if (!existing.year && track.year) {
                existing.year = track.year;
            }
            // Update to original names if they look "better" (e.g. longer)
            if (rawAlbum.length > existing.name.length) existing.name = rawAlbum;
            if (rawArtist.length > existing.artist.length) existing.artist = rawArtist;
        } else {
            albumMap.set(key, {
                name: rawAlbum,
                artist: rawArtist,
                year: track.year,
                trackCount: 1,
                tracks: [track],
            });
        }
    }

    // Secondary pass: Merge albums with same name if they share tracks or seem identical
    // (This helps if one track has "Artist A" and another has "Artist A & B" but same album title)

    return Array.from(albumMap.values())
        .sort((a, b) => {
            const artistCompare = a.artist.localeCompare(b.artist);
            if (artistCompare !== 0) return artistCompare;
            return a.name.localeCompare(b.name);
        });
}

/**
 * Get all tracks for a specific artist
 */
export function getArtistTracks(tracks: LocalTrack[], artistName: string): LocalTrack[] {
    return tracks.filter((t) => (t.artist || "Unknown Artist") === artistName);
}

/**
 * Get all tracks for a specific album
 */
export function getAlbumTracks(tracks: LocalTrack[], albumName: string, artistName: string): LocalTrack[] {
    return tracks.filter(
        (t) =>
            (t.album || "Unknown Album") === albumName &&
            (t.artist || "Unknown Artist") === artistName
    );
}
