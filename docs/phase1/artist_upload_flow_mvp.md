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

- Storage provider configuration (Local/IPFS/GCS).
- Demucs worker running (`docker compose up demucs-worker`).
- Redis for BullMQ job queue.
- Catalog service CRUD endpoints.

## Technical Implementation

### Demucs Worker
The stem separation is handled by a containerized Demucs worker using the `htdemucs_6s` model:

| Component | Details |
|-----------|---------|
| Model | `htdemucs_6s` - 6-stem separation |
| Output Stems | vocals, drums, bass, guitar, piano, other |
| Output Format | MP3 320kbps |
| Processing | CPU (~10 min/song) or GPU (~45 sec/song) |

### Processing Flow
1. Upload endpoint accepts audio → returns `release_id`
2. Job queued to BullMQ `stems` queue
3. `StemsProcessor` sends file to Demucs worker
4. Worker separates stems, converts to MP3
5. Stems uploaded to storage provider
6. `stems.processed` event emitted with stem URIs

### GPU Acceleration
For production, enable GPU processing:
```bash
make worker-gpu
```

See [README.md](../README.md#-gpu-acceleration-recommended-for-production) for setup details.
