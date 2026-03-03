/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * libraryGrouping unit tests — Issue #362
 *
 * Tests the pure grouping/filtering utilities used by the music library UI.
 */
import { describe, it, expect } from 'vitest';
import { groupByArtist, groupByAlbum, getArtistTracks, getAlbumTracks } from './libraryGrouping';

// Minimal LocalTrack stub matching the fields used by grouping functions
type TrackStub = {
  id: string;
  title: string;
  artist?: string | null;
  albumArtist?: string | null;
  album?: string | null;
  year?: number | null;
};

const tracks: TrackStub[] = [
  { id: '1', title: 'Song A', artist: 'Alpha', album: 'Album One', year: 2024 },
  { id: '2', title: 'Song B', artist: 'Alpha', album: 'Album One', year: 2024 },
  { id: '3', title: 'Song C', artist: 'Alpha', album: 'Album Two', year: 2025 },
  { id: '4', title: 'Song D', artist: 'Beta', album: 'Beta Album', year: 2023 },
  { id: '5', title: 'Song E', artist: null, album: null, year: null },
];

describe('groupByArtist', () => {
  it('groups tracks by artist name', () => {
    const artists = groupByArtist(tracks as any);
    expect(artists).toHaveLength(3); // Alpha, Beta, Unknown Artist
  });

  it('assigns Unknown Artist for null artist', () => {
    const artists = groupByArtist(tracks as any);
    const unknown = artists.find(a => a.name === 'Unknown Artist');
    expect(unknown).toBeDefined();
    expect(unknown!.trackCount).toBe(1);
  });

  it('counts tracks per artist', () => {
    const artists = groupByArtist(tracks as any);
    const alpha = artists.find(a => a.name === 'Alpha');
    expect(alpha!.trackCount).toBe(3);
  });

  it('collects album names per artist', () => {
    const artists = groupByArtist(tracks as any);
    const alpha = artists.find(a => a.name === 'Alpha');
    expect(alpha!.albums).toContain('Album One');
    expect(alpha!.albums).toContain('Album Two');
  });

  it('sorts artists alphabetically', () => {
    const artists = groupByArtist(tracks as any);
    const names = artists.map(a => a.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('groupByAlbum', () => {
  it('groups tracks by album', () => {
    const albums = groupByAlbum(tracks as any);
    expect(albums.length).toBeGreaterThanOrEqual(3);
  });

  it('uses Unknown Album for null album', () => {
    const albums = groupByAlbum(tracks as any);
    const unknown = albums.find(a => a.name === 'Unknown Album');
    expect(unknown).toBeDefined();
  });

  it('includes tracks array in each album', () => {
    const albums = groupByAlbum(tracks as any);
    const albumOne = albums.find(a => a.name === 'Album One');
    expect(albumOne!.tracks).toHaveLength(2);
  });

  it('preserves year from tracks', () => {
    const albums = groupByAlbum(tracks as any);
    const albumOne = albums.find(a => a.name === 'Album One');
    expect(albumOne!.year).toBe(2024);
  });
});

describe('getArtistTracks', () => {
  it('filters tracks by artist name', () => {
    const result = getArtistTracks(tracks as any, 'Alpha');
    expect(result).toHaveLength(3);
  });

  it('returns empty for non-existent artist', () => {
    const result = getArtistTracks(tracks as any, 'Nonexistent');
    expect(result).toHaveLength(0);
  });

  it('matches Unknown Artist for null-artist tracks', () => {
    const result = getArtistTracks(tracks as any, 'Unknown Artist');
    expect(result).toHaveLength(1);
  });
});

describe('getAlbumTracks', () => {
  it('filters tracks by album and artist', () => {
    const result = getAlbumTracks(tracks as any, 'Album One', 'Alpha');
    expect(result).toHaveLength(2);
  });

  it('returns empty for mismatched artist', () => {
    const result = getAlbumTracks(tracks as any, 'Album One', 'Beta');
    expect(result).toHaveLength(0);
  });
});
