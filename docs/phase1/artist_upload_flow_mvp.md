---
title: "Phase 1: Artist Upload Flow MVP"
status: draft
owner: "@akoita"
issue: 20
---

# Phase 1: Artist Upload Flow MVP

## Goal

Ship an MVP upload flow that accepts artist audio, triggers stem separation,
and registers the resulting assets in the catalog.

## Actions

1. **Upload endpoint & staging**
   - Accept audio files (wav/mp3/flac).
   - Store raw uploads in GCS staging bucket.
2. **Async processing job**
   - Trigger stem separation job.
   - Persist processing status and model version.
3. **Status & error handling**
   - Track `queued`, `processing`, `complete`, `failed`.
   - Provide retry for recoverable failures.
4. **Catalog linkage**
   - Create track + stem records.
   - Link IPFS/GCS URIs to catalog entries.

## MVP Acceptance Criteria

- Uploads return a `track_id` immediately.
- Processing status is queryable via API.
- Stems are discoverable in the catalog after completion.

## Dependencies

- GCS bucket configuration.
- Vertex AI stem separation pipeline.
- Catalog service CRUD endpoints.
