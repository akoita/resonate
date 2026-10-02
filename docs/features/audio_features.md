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
`stem-audio-features/v1` schema. The measurements feed remix grounding, discovery
ranking and the public catalog track API.

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
`onsetDensity`, `analysisRevision`, plus the derived `camelot` code. Every field
except the schema version and extractor name may be null.

`analysisRevision` records which extraction method produced the payload. The
shape is unchanged, so the schema version stays `v1`, and a payload without
the field is revision 1.

| Revision | Method |
| --- | --- |
| 1 | Tempo, onsets, energy and key all measured on the whole signal. |
| 2 ([#2016](https://github.com/akoita/resonate/issues/2016)) | Key chroma measured at 22.05 kHz on the harmonic component (`librosa.effects.harmonic`, margin 3). Files load at their native rate (usually 44.1 or 48 kHz), where the 2048-sample chroma window has half the frequency resolution and low notes smear across pitch classes; percussion also flattens the pitch-class profile of a full mix. Tempo, onsets and energy are unchanged and still use the native-rate signal. |

On a 25-track evaluation set of full mixes loaded as in production, revision 2
raised keys with confidence of at least 0.1 from 15 to 19, and the first and
second halves of a track agreed on the key for 20 tracks instead of 13. One of
the 15 previously confident keys moved a fifth (C minor to G minor), a known
ambiguity that cannot be settled without a reference key. The evaluation and
the rejected variants are in #2016.

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
stems that still lack features. The transport follows how the worker is
deployed (#2013):

| Configuration | Transport | Behaviour |
| --- | --- | --- |
| `DEMUCS_WORKER_URL` set (resident worker service) | `http` | Each stem's audio is sent to the worker's `POST /analyze`; features are stored within the call. |
| No worker URL, Pub/Sub publisher available (job mode, or the local emulator) | `pubsub` | One analysis-only message (`kind: "analyze"`, up to 50 stems) goes to the `stem-separate` topic, the same dispatch as separation, and triggers one job execution when `DEMUCS_CLOUD_RUN_JOB_*` is set. The worker downloads each stem, measures it, and publishes one `kind: "analysis"` result on `stem-results`; the backend stores the features asynchronously. |
| Neither | `none` | The call returns `status: "worker_unavailable"` and touches nothing. There is no `localhost` fallback. |

Request body:

- `limit`: stems per run, default 25. Up to 100 over HTTP, up to 50 per
  dispatched message.
- `types`: optional list of stem types to target, for example
  `["original"]` to fill full mixes first. Accepted values are `original`,
  `master`, `vocals`, `drums`, `bass`, `other`, `piano`, `guitar`. Unknown
  values are ignored; an empty or absent list targets every type.
- `refresh`: when `true`, also re-measure stems whose stored features come from
  an older `analysisRevision` than the current one. Without it, only stems
  with no features are selected. Results never overwrite features of the same
  or a newer revision, so redelivered or older results are no-ops.

Response: `transport`, `status` (`ok`, `dispatched` or `worker_unavailable`),
`scanned`, `updated`, `dispatched`, `skipped[]`, `remaining` (stems still
lacking features for the requested filter) and `remainingByType` (the count per
stem type across all types, so the operator sees the whole picture). Over HTTP,
re-run until `remaining` reaches 0. With the `pubsub` transport, `remaining`
still counts the stems in flight. Call the POST once per batch, then poll
`GET /admin/stems/backfill-audio-features?types=original` (add `&refresh=true`
to count outdated stems too; same admin guard;
returns `remaining` and `remainingByType` without analyzing anything) until it
stops falling, before dispatching the next batch. Re-dispatching a batch that
is still in flight is harmless but wasted work: results only fill stems that
still lack features. GCS stems are handed to the worker as their
canonical `https://storage.googleapis.com/…` URL, including those stored in the
historical bucket-relative `/{bucket}/{object}` form. A stem without a stored
URI, or with one the storage provider rejects, is reported as
`audio_unavailable` and is not dispatched. Per-stem analysis failures are
logged by the backend and the stem stays pending. Backfilled features carry
`camelot` too.

The staging backfill run is tracked in the private deployment repository; this
page holds no environment URLs or schedules.

## Tests

- Worker: `cd workers/demucs && python3 -m unittest test_main`
- Backend unit: `cd backend && npx jest src/tests/stem-audio-features.spec.ts src/tests/maintenance.controller.http.spec.ts`
- Backend integration (Docker):
  `npm run test:integration -- --testPathPattern='stem-feature-backfill|stem-result-original-features'`

## Where the measurements are used (#1960)

- Ranking and explanations: `AgentAudioFeatureService` overlays measured tempo,
  key, Camelot and energy from the current `original` stem on its
  metadata-inferred features, field by field. The AI DJ and Home ranking core
  score with them and print a BPM only when it was measured. Thresholds, the
  energy formula and the cache key are in
  [Agent Taste Intelligence](agent_taste_intelligence.md#measured-vs-inferred-audio-features-1960).
- Public catalog API: track responses carry a track-level `audioFeatures` field
  on `GET /catalog/tracks/:trackId`, `GET /catalog/releases/:releaseId` and
  `GET /catalog/published` (each track):

  ```json
  {
    "tempoBpm": 124.5,
    "tempoConfidence": 0.8,
    "key": { "tonic": "A", "mode": "minor", "confidence": 0.4 },
    "camelot": "8A",
    "energy": 0.5,
    "source": "measured_full_mix"
  }
  ```

  Only measured values appear. A tempo needs confidence of at least 0.5 and a
  key at least 0.1; anything not measured is `null`, and the whole field is
  `null` when nothing is measured (for example before ingestion or the backfill
  reached the track). The metadata-inferred tempo is never exposed, and the raw
  per-stem `audioFeatures` JSON, stem data and URIs are not added by this
  field. `energy` is the 0..1 composite of loudness and onset density, not the
  raw RMS.

## AI DJ card

The AI DJ next-pick card shows a BPM only when `featureSources.tempo` is
`measured`; an inferred tempo is never displayed as a number (#1960).
