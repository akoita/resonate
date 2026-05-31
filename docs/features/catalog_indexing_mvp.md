---
title: "Phase 1: Catalog Indexing MVP"
status: draft
owner: "@akoita"
issue: 21
---

# Phase 1: Catalog Indexing MVP

## Goal

Expose a minimal catalog service to store, index, and query tracks and stems.

## Current User Surfaces

- The home page catalog browser (`/`) lists published releases, artists, and
  stems from `GET /catalog/published`.
- Global artist discovery groups releases by first-class `ReleaseArtistCredit`
  rows. Main artist credits can include several equal-billing collaborators;
  featured and production credits are preserved for richer metadata.
- Public artist pages show credited public-artist discography. Uploader-owned
  releases credited to another artist remain in the authenticated managed
  catalog but are not presented as the uploader profile's official artist
  releases.
- `primaryArtist` and `featuredArtists` remain compatibility snapshots for
  older records and clients, but catalog APIs now return `artistCredits` so
  UI and machine clients can distinguish manager ownership from public artist
  identity.
- Release rows in the home catalog expose direct listener actions:
  - add all release tracks to a playlist using the existing playlist modal
  - save all release tracks to the listener library as remote catalog tracks
- Authenticated artists can open `/artist/catalog` for a complete managed
  inventory with release and track tabs, search, status, rights-route, and
  resource counts. The home page keeps only compact previews and links to this
  full inventory when the artist owns more catalog objects than fit there.
- Full release details, track-level actions, mixer previews, and owner tools
  remain available from `/release/:id`.

## Actions

1. **Schema & CRUD**
   - Define track + stem metadata schemas.
   - Maintain public release artist credits separately from manager/uploader
     ownership.
   - Implement create/update/read endpoints.
2. **Indexing hooks**
   - Consume ingestion events (`stems.processed`, `ipnft.minted`).
   - Update catalog status and asset URIs.
3. **Search & filters**
   - Basic search by title/artist.
   - Filters for stem type and availability.

## MVP Acceptance Criteria

- Catalog returns a track with associated stems.
- Search returns results within 1 second for small datasets.
- Index updates occur within 1 minute of ingestion events.
- Listeners can add or save catalog release tracks from the home catalog
  browser without opening the release detail page.

## Dependencies

- Event taxonomy (Phase 0).
- Ingestion service events.
