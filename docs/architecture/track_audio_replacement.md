---
title: "Track audio replacement"
status: implemented
issues: ["https://github.com/akoita/resonate/issues/1762"]
---

# Track audio replacement

The track audio replacement slice of [artist and release management](artist_management_authority.md)
is implemented. The broader #1762 management issue remains open for other workflows.
Owners and accepted release managers with `TRACK_AUDIO` can replace one track's
audio on a ready, unpublished release. The backend checks authority and release
state when it accepts the upload and again before activation.

The authenticated `POST /ingestion/releases/:releaseId/tracks/:trackId/audio`
endpoint accepts one `file` up to 100 MiB. Supported extensions are MP3, WAV,
FLAC, AIFF (`.aif` or `.aiff`), M4A, AAC, and OGG. The backend derives the
stored MIME type from the extension and ignores the client MIME type.

## Versioned processing

The endpoint creates a server-generated audio revision and stores it as the
track's pending revision. The revision follows the request through synchronous
processing or the queued worker path, progress and fingerprint updates, result
messages, stem storage keys, and activation. Conditional status and result
updates discard stale revisions. `Release.status` stays `ready` during
replacement; the track reports `audioReplacementStatus` and
`audioReplacementError` while the current revision remains playable.

## Activation and history

Before activation, the backend locks the release and track and verifies the
release remains ready and the result matches the pending revision. In one
transaction it marks old stems historical, marks the replacement stems current,
and advances `activeAudioRevision`. A failed or stale attempt leaves the current
audio active. Current catalog, playback, preview, pricing, and new remix paths
use current stems; exact historical stem IDs remain resolvable for existing
purchases and saved remix projects.

## Scope in #1762

This audio replacement flow, its `TRACK_AUDIO` permission, release-page upload
control, status feedback, User Guide entry, and local synchronous and worker-path
coverage are implemented. The broader #1762 issue remains in progress for other
management work, including invite notifications and transfer recovery. Live
cloud Pub/Sub end-to-end validation remains an operational follow-up.
