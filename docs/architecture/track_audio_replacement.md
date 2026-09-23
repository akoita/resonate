---
title: "Track audio replacement"
status: planned
issues: ["https://github.com/akoita/resonate/issues/1762"]
---

# Track audio replacement

Track audio replacement is a remaining part of [artist and release management](artist_management_authority.md). It is restricted to unpublished releases. The current ingestion pipeline has no audio revision: jobs, worker callbacks, storage paths, and result events identify a track only by release and track IDs. A late result can therefore be mistaken for a newer attempt. This page defines the contract required before an upload control becomes available.

The first safety change prevents `stems.processed` from modifying tracks or stems after a release has failed. It does not enable replacement or protect two overlapping attempts on the same nonfailed release.

## Identity and authority

Keep the existing release and track IDs. The management owner or an accepted release manager with a dedicated audio-replacement scope may request replacement; metadata and artwork scopes do not imply it. Recheck both authority and unpublished status when the request is accepted and when the new audio is activated. If publication begins during processing, reject activation and retain the existing audio. Rights, pricing, licensing, and payouts remain under their separate controls. This is ADR-BM-6 vision-neutral catalog quality work.

Each request gets a server-generated, immutable audio revision or attempt ID. Persist the pending revision on the track and carry it through the queue job, Pub/Sub request, Demucs progress and fingerprint callbacks, worker result, internal events, and status updates. An old attempt may finish or fail, but it cannot change the state of a newer attempt. Every worker input and output object key must include the attempt ID; a database check alone cannot prevent old workers from overwriting shared object paths.

## Activation and history

Preserve the currently playable audio while separation, encryption, storage, and validation run. Store replacement stems under new IDs and revision-specific object keys. In one database transaction, lock the release and track, verify unpublished status and the matching pending attempt, mark old stems historical, mark new stems current, and change the active revision. No read should observe a mixture of old and new stems. Failure leaves the previous revision active, records an actionable processing error, and permits an authorized retry with a new attempt ID. Repeated, duplicate, and out-of-order results must be idempotent or rejected before destructive writes.

Existing `Stem` IDs are durable references. Purchases, listings, settlements, token metadata, and saved remix projects must continue to resolve their exact historical stem IDs and bytes. Replacement must not delete or repurpose those rows. Current catalog, playback, stream selection, preview creation, new pricing, and new remix eligibility should use only active stems. DMCA, audit, and deletion flows should inspect every revision. Historical listing discoverability and new purchases against superseded stems require an explicit product decision before launch.

## Implementation sequence and verification

1. Add the track attempt and active-audio revision fields, a stem revision/current marker, migration, and server-side attempt validation. Backfill existing tracks and stems as the active revision.
2. Thread the attempt through synchronous ingestion, BullMQ, Pub/Sub, Demucs callbacks and results, fingerprinting, failure handling, progress, and versioned storage keys. Reject stale callbacks before they mutate status or fingerprints, and compare the attempt again inside the final database transaction.
3. Audit every track-to-stems and direct-stem query. Apply current-only filtering to discovery and playback paths while retaining exact-ID access for historical purchases and remix projects. Remove the current result handler's unconditional deletion of separated stems.
4. Add the authenticated replacement endpoint and upload UI with file validation, processing state, failure/retry feedback, and a clear unpublished-only restriction. Update the in-app User Guide and feature documentation when this surface ships.

Integration coverage must exercise failure after a usable prior revision, concurrent attempts finishing in either order, stale progress/fingerprint/success/failure callbacks, publication during processing, duplicate results, preserved purchases and saved remixes, and current-only catalog/playback responses. Test both synchronous and Pub/Sub worker paths. The upload control stays unavailable until these checks and the storage-key isolation are implemented.
