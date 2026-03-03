---
title: "Phase 1: Catalog Indexing MVP"
status: draft
owner: "@akoita"
issue: 21
---

# Phase 1: Catalog Indexing MVP

## Goal

Expose a minimal catalog service to store, index, and query tracks and stems.

## Actions

1. **Schema & CRUD**
   - Define track + stem metadata schemas.
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

## Dependencies

- Event taxonomy (Phase 0).
- Ingestion service events.
