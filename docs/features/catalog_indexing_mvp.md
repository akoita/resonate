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

- The home page catalog browser (`/`) presents a compact recent-catalog
  snapshot of published releases, artists, and stems from
  `GET /catalog/published`. It shows visible-vs-total counts and links to a
  larger recent-catalog browser so the preview is not mistaken for an
  exhaustive list.
- The global catalog page (`/catalog`) provides a larger public browse surface
  for recent releases, artists, and stems with shared search and tabbed views.
  It currently searches the latest 200 public releases returned by
  `GET /catalog/published?limit=200`, not the complete database history.
- Catalog discovery sorts recent surfaces by catalog addition time
  (`Release.createdAt`) rather than the musical release date, so legacy albums
  uploaded today still appear in recent artist/release discovery.
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
- Listeners can open `/catalog` from the home snapshot to browse a larger
  recent public catalog window without the home-page preview limit.

## Dependencies

- Event taxonomy (Phase 0).
- Ingestion service events.
