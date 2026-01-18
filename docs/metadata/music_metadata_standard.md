---
title: Music Metadata Standard (Interop)
status: draft
owner: "@akoita"
issue: 100
---

# Music Metadata Standard (Interop)

## Goal

Define a reference metadata set that aligns with industry standards so Resonate
content can interoperate with other digital music systems.

## Reference Standards (Summary)

- **DDEX**: Industry messaging standard for digital music supply chain.
- **MusicBrainz**: Open music metadata database (artist/release/recording IDs).
- **ID3**: Tagging standard embedded in audio files (track, album, artist).
- **ISRC**: Recording identifier for tracks.
- **ISWC**: Composition identifier for works.
- **UPC/EAN**: Release identifier for albums/EPs.
- **schema.org**: Web vocabulary (`MusicRecording`, `MusicAlbum`).

## Canonical Fields for v1

### Release

- `releaseTitle` (album/EP/single title)
- `releaseType` (single | EP | album)
- `releaseDate`
- `upc` (optional)
- `label` (optional)
- `artworkUri` (optional)

### Recording (Track)

- `trackTitle`
- `trackNumber` (optional)
- `durationMs` (optional)
- `isrc` (optional)
- `genre` (optional)
- `language` (optional)
- `explicit` (boolean)

### Contributors

- `primaryArtist`
- `featuredArtists` (optional)
- `producers` (optional)
- `writers` (optional, ISWC compatible)

## Mapping Notes

- **DDEX**: maps to Release + Recording + Contributor entities.
- **ID3**: maps to track/release fields (TIT2, TALB, TPE1, TRCK).
- **MusicBrainz**: can store external IDs for artist, release, recording.
- **schema.org**: publish as `MusicRecording` with `inAlbum`.

## UI Capture (First Release)

Collect a minimal subset in the upload flow:

- Release type + release title
- Track title
- Primary artist + featured artists
- Genre + explicit flag
- Optional: ISRC, label, release date

## Future Extensions

- Rights holders and splits (PRO, publisher, label).
- Territory restrictions and licensing scopes.
- Full contributor roles (composer, lyricist, engineer).
