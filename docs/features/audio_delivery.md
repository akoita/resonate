---
title: "Audio delivery and streaming renditions"
status: implemented
owner: "@akoita"
---

# Audio delivery and streaming renditions

**Status:** implemented (application half, #2661). Private audio storage,
object versioning and a second copy are deployment work in `resonate-iac`.
**Audience:** backend developers, operators

## What it is for

An artist's uploaded file is the archive copy and is never delivered to a
listener. Listeners receive a streaming rendition: an MP3 at
`STREAM_RENDITION_BITRATE_KBPS` (192 kbps) made from the archive, stored under
its own `renditions/` storage prefix.

## How it works

- **Creation.** `StreamRenditionService` (`backend/src/modules/catalog/`)
  transcodes the archive with ffmpeg and records `Stem.streamUri`,
  `streamMimeType` and `streamCreatedAt`. A background sweep
  (`streamRenditionSweep`, every `STREAM_RENDITION_SWEEP_INTERVAL_MS`, default
  30 s, `STREAM_RENDITION_SWEEP_BATCH` stems per pass, default 4) picks up new
  uploads and backfills the existing catalog, full mixes first. Each stem is
  committed on its own, so the work is resumable. A stem that fails three times
  is parked (`streamFailureCount`) until an operator retries.
- **AI tags.** The encode drops the archive's own tags. For a track disclosed
  as AI-generated (`ALL`) or AI-assisted (`PARTLY`) it writes `AI_GENERATED`
  and the IPTC digital source type (`trainedAlgorithmicMedia` or
  `compositeWithTrainedAlgorithmicMedia`) again, and stores the rendition as
  `rendition-<stem>.ai.mp3`. The sweep also picks up an AI track whose
  rendition lacks that suffix (made before the tags, or before the track's
  disclosure changed) and makes it again once, deleting the old object. An
  inaudible remix or provider mark is in the audio and survives the encode.
  The generated-audio inventory row is `stream-rendition` in
  [Remix Studio](remix_studio.md).
- **Which stems.** Every current stem except official stems (#1976), whose
  public preview is already a bounded lossy transcode and whose buyers download
  through their entitlement.
- **Delivery.** The public track stream, stem blob and stem preview routes serve
  the rendition only. Without one they answer
  `503 { code: "rendition_not_ready" }` with `Retry-After: 30`; they never fall
  back to the archive. Two kinds of row keep the earlier path: encrypted stems
  (the stored bytes are ciphertext) and the local development storage provider.
  The owner's own stream route plays the rendition when it exists, otherwise the
  archive, behind the owner's sign-in.
- **Memory.** Delivery proxies the rendition one range read at a time
  (`STREAM_CHUNK_BYTES`, 1 MiB). A ranged request gets a `206` of at most one
  chunk (players request the rest); a request without a Range header is
  streamed chunk by chunk. Memory use does not grow with file size.
- **Caching.** Audio responses carry `Cache-Control: private, max-age=3600`;
  no long-lived public caching.
- **No storage locations in public JSON.** Public catalog reads (published,
  release, track, artist, search) replace each stem's `uri` with
  `/catalog/stems/<id>/blob`, or `/catalog/stems/<id>/preview` for an official
  stem. Encrypted stems keep their location.
- **Archive downloads** stay limited to the owner and entitled buyers through
  the existing authenticated routes.

## Operating it

- `GET /admin/stems/stream-renditions` → `{ ready, remaining, failed }`.
- `POST /admin/stems/stream-renditions/backfill` `{ limit?: 1-50, retryFailed?: boolean }`
  runs one batch and returns `{ processed, failed, remaining }`; repeat until
  `remaining` is 0. Admin only, recorded in the admin audit log.
- The backend's storage identity must be able to write the `renditions/`
  prefix in the audio bucket.

## How to test

- `stream_rendition_delivery.controller.http.spec.ts`: rendition-only bytes on
  every public route, `503` instead of an original, bounded chunk reads on a
  multi-megabyte object, seeking (`206`) and `416`.
- `stream_rendition.integration.spec.ts`: the public blob path refuses cloud
  originals, the sweep backfills to `remaining: 0`, failures are parked,
  withdrawal still applies.
- `byte_range.spec.ts`, `public_stem_uri.spec.ts`.
