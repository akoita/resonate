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
 * Group tracks by album
 */
export function groupByAlbum(tracks: LocalTrack[]): Album[] {
    const albumMap = new Map<string, Album>();

    for (const track of tracks) {
        const albumName = track.album || "Unknown Album";
        const artistName = track.artist || "Unknown Artist";
        const key = `${artistName}::${albumName}`;

        const existing = albumMap.get(key);
        if (existing) {
            existing.trackCount++;
            existing.tracks.push(track);
        } else {
            albumMap.set(key, {
                name: albumName,
                artist: artistName,
                year: track.year,
                trackCount: 1,
                tracks: [track],
            });
        }
    }

    return Array.from(albumMap.values())
        .sort((a, b) => {
            // Sort by artist, then album name
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
