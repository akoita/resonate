---
title: "Audio features"
status: implemented
audiences: [backend/worker developers, operators]
issues:
  - "https://github.com/akoita/resonate/issues/1184"
  - "https://github.com/akoita/resonate/issues/1959"
  - "https://github.com/akoita/resonate/issues/1960"
---

# Audio features

Resonate measures tempo, key and energy for uploaded music and stores the
result on `Stem.audioFeatures` (JSON, nullable) using the versioned
`stem-audio-features/v1` schema. The measurements feed remix grounding and,
later, discovery.

**Vision alignment (ADR-BM-6):** vision-neutral infrastructure. It prepares
data for Line 3 and Line 4 surfaces but changes no money, rights, payouts, or
fees.

## What is measured, and where

- Separated stems (#1184): the demucs worker measures each separated stem
  (vocals, drums, bass, other, piano, guitar) from its lossless WAV.
- Full mix (#1959): the worker also measures the input file and returns it as
  `stemFeatures.original`. The full mix is where tempo and key are most
  reliable, so it is the preferred source for track-level tempo and key. The
  `original` entry is a feature key only; it never joins the stem URI map.

The backend subscriber sanitizes every entry at the trust boundary and stores
the result on the matching stem row, including the `original` row. The worker
also exposes `POST /analyze`, which the admin backfill uses.

## Fields

`schemaVersion`, `extractor { name, version }`, `sampleRate`,
`durationSeconds`, `tempoBpm` (30-300, else null), `tempoConfidence`,
`beatCount`, `firstBeatSec`, `key { tonic, mode, confidence }`, `energyRms`,
`onsetDensity`, plus the derived `camelot` code. Every field except the schema
version and extractor name may be null.

## Camelot code

`camelot` is derived in the backend (`camelotCode` in
`backend/src/modules/ingestion/stem-audio-features.ts`), not measured by the
worker. Major keys map to the `B` ring and minor keys to the `A` ring: C major
is `8B`, A minor is `8A`. Sharp spellings and the flat spellings Db, Eb, Gb, Ab
and Bb are accepted. The code is null when the key is missing, the tonic is not
recognized, or key confidence is null or below `CAMELOT_MIN_KEY_CONFIDENCE`
(0.1). The extractor's confidence is a best-versus-runner-up correlation
margin, so a low value means the key is ambiguous and a code would be
misleading.

## Failure behavior

Malformed, missing or failed features degrade to null and never block
ingestion. A worker extraction error stores null for that entry and does not
fail separation. The backend logs a warning and drops a payload that fails
sanitization. Older workers that omit `stemFeatures.original` leave the
original row without features until the backfill runs.

## Admin backfill

`POST /admin/stems/backfill-audio-features` (admin JWT) analyzes unencrypted
stems that still lack features, through the worker's `/analyze` endpoint.

Request body:

- `limit`: stems per run, 1-100, default 25.
- `types`: optional list of stem types to target, for example
  `["original"]` to fill full mixes first. Accepted values are `original`,
  `master`, `vocals`, `drums`, `bass`, `other`, `piano`, `guitar`. Unknown
  values are ignored; an empty or absent list targets every type.

Response: `scanned`, `updated`, `skipped[]`, `remaining` (stems still lacking
features for the requested filter) and `remainingByType` (the count per stem
type across all types, so the operator sees the whole picture). Re-run until
`remaining` reaches 0. Backfilled features carry `camelot` too.

The staging backfill run is tracked in the private deployment repository; this
page holds no environment URLs or schedules.

## Tests

- Worker: `cd workers/demucs && python3 -m unittest test_main`
- Backend unit: `cd backend && npx jest src/tests/stem-audio-features.spec.ts src/tests/maintenance.controller.http.spec.ts`
- Backend integration (Docker):
  `npm run test:integration -- --testPathPattern='stem-feature-backfill|stem-result-original-features'`

## Follow-ups

Using tempo, key and Camelot in ranking and discovery is tracked in
[#1960](https://github.com/akoita/resonate/issues/1960) and is not part of this
feature.
