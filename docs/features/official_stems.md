---
title: "Official stems"
status: implemented
owner: "@akoita"
issue: 1976
---

# Official stems

## Status

`implemented` (Vision Sprint 42, [#1976](https://github.com/akoita/resonate/issues/1976),
decision ADR-TE-7 in [taste-engine-decisions.md](../strategy/taste-engine-decisions.md),
accepted 2026-10-24). Revenue line: ADR-BM-6 Line 3, marketplace take-rate 10%,
phase 2. No fee, split or price changes; the artist still keeps at least 85%
(ADR-BM-4). The stem source is catalog metadata, not an on-chain field: no
contract changes.

## What it is for

A stem purchase sells a **license**; the audio file is how it is delivered.
Until now every stem was separated by Demucs (`htdemucs_6s`) from the uploaded
mix and delivered as MP3 320 kbps. DJ software separates any track on the DJ's
machine, so separated audio alone gives a professional little reason to pay.
Artists can now upload their own lossless parts, and every stem says where it
comes from wherever it is sold.

| Source | Label | Audio | Delivered as |
| --- | --- | --- | --- |
| `official` | **Official** | The artist's own parts, aligned with the published mix | The uploaded WAV or FLAC, unchanged |
| `separated` | **Separated (AI)** | Split from the mix by the ingestion worker; the model is recorded (`demucs-htdemucs-6s`) | MP3 320 kbps |

The full-mix rows (`original`, remix `master`) are not stems a buyer licenses and
have no source.

## Who uses it

Artists (upload and price), DJs, producers and video creators (buy, filter),
agents (quote and receipt shapes), backend and frontend developers.

## Data model

`Stem.source` (`StemSource`: `separated` | `official`, nullable) and
`Stem.separationModel` (text). Migration
`20261025150000_stem_source_official` backfills every existing stem whose type is
not `original` or `master` to `separated` with `demucs-htdemucs-6s`; those two
types keep a NULL source. New separated stems get `source = separated` and the
`modelVersion` of the `stems.processed` event; the stale-stem cleanup of a re-run
never deletes an official stem.

Official and separated stems of the same type coexist as separate rows with their
own `StemPricing`, listing and NFT, which is how the artist prices them
separately. There is no platform price floor.

## Upload

`POST /ingestion/releases/:releaseId/tracks/:trackId/official-stems` (JWT,
multipart, 5 requests a minute). One optional file field per stem type:
`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`. A field outside that list is
refused (400), so the type is never guessed from a file name.

Who may upload (ADR-BM-5, same verification as the release):

- the account must manage the release's audio (`track_audio`: the owner or an
  accepted management grant), else **403** `official_stems_forbidden`;
- the release's rights route (strictest of release and track) must allow stem
  generation, else **403** `official_stems_rights_route` (a blocked or
  quarantined release takes no new stems; marketplace and payout gates are the
  release's, exactly as for separated stems);
- the release must be `ready` or `published` and not have an audio replacement
  pending (409).

Checks (`official-stems.validation.ts`, measurements in `official-stems.audio.ts`),
each refusal is a 400 `official_stems_rejected` with `issues[]` of readable
reasons, all reported at once:

| Check | Rule |
| --- | --- |
| Stem types | one of the six types, once each |
| Format | WAV (PCM or float) or FLAC, read from the file header; lossy codecs inside WAV are refused |
| Sample rate | 44.1, 48, 88.2, 96, 176.4 or 192 kHz, the same for every file |
| Channels | mono or stereo |
| Duration | within `max(0.5 s, 0.5% of the mix)` of the published mix |
| Silence | no stem below -70 dBFS RMS |
| Summed level | the stems added sample for sample must be within 6 dB RMS of the mix |
| Alignment | the 100 ms loudness envelope of the sum must correlate at least 0.8 with the mix's |

The mix and the stems are decoded with `ffmpeg` (already in the backend image for
remix rendering) to 8 kHz mono; no ffprobe or Demucs-worker change is needed. The
summed-level check expects a full set of parts: a package missing most of the
track is quieter than the mix and is refused with that reason. The tolerances are
constants in `official-stems.validation.ts`; they are first-version values to tune
against real packages.

An accepted package is encrypted like every stem (a stem that cannot be
encrypted is never stored in the clear), stored lossless under
`<stemId>.wav|flac`, and recorded with `mimeType` `audio/wav` or `audio/flac`. A
new package replaces the track's current official stems (the old rows become
historical and a price already set for that part is carried over), unless one of
them has been minted (409). A track audio replacement makes every current stem,
official ones included, historical, because the parts no longer match the mix.

## Delivery

- `POST /encryption/download` and `POST /encryption/decrypt` use `Stem.mimeType`
  for `Content-Type` and the download file name (`.wav`, `.flac`, `.mp3`).
- x402 and MCP downloads name the file from the stored MIME type.
- Crate export names each file with the extension of its stored format and writes
  the rekordbox `Kind` (`WAV File`, `FLAC File`, `MP3 File`), so `Location` and
  the Serato path match the file the DJ downloaded. Byte-exact fixtures:
  `backend/src/tests/fixtures/crate-export/entries-lossless.json` and
  `rekordbox-lossless.xml`.
- The public side doors never serve the lossless file: `GET /catalog/stems/:id/blob`
  returns nothing for an official stem, and `GET /catalog/stems/:id/preview`
  serves a 128 kbps MP3 transcode. Token metadata points `animation_url` at that
  preview. The route is public, so the transcode is bounded
  (`shared/stem-preview.ts`): concurrent requests for one stem share one
  transcode, repeats come from a small per-instance cache, and at most two
  transcodes run at once per instance; beyond that the route answers 503
  `stem_preview_busy` instead of queueing work.

## Where the source shows

Every surface shows "Official" or "Separated (AI)" next to the license tier, with
what the tier allows in plain words (`STEM_LICENSE_PLAIN_TERMS`):

- Marketplace listing cards, the stem page hero and the buy modal (`source`,
  `sourceLabel`, `separationModel`, `lossless`, `mimeType` on
  `GET /api/metadata/listings`, token metadata `properties.stem_source` and the
  `Source` attribute).
- The x402 quote and storefront (`source`, and `licenseOptions[].terms`), the MCP
  `stem.quote` output (`stem.source`, `rights.terms`), the x402 receipt
  (`resource.source`, `license.terms`).
- The crate page (stem chips), the crate quote (`items[].source`, `sourceLabel`,
  `mimeType`) and the export manifest (`mimeType`, `source`).
- The pricing panel and the artist's release page (Official stems panel).

## Filters

- Marketplace: `GET /api/metadata/listings?source=official|separated` and the
  source menu in Browse stems (`/crates?tab=stems`); the storefront accepts the
  same `source` query.
- Crate Digger: the `stemSource` filter (chip "Official stems"). The text parser
  reads "official stems", "lossless stems", "WAV stems" and "stems from the
  artist". Required stem types are then looked up among stems of that source.
  The AI DJ session parser ignores it (it only listens).

## Pricing

`GET /api/stem-pricing/:stemId` and `batch-get` report the stem's `source`. The
batch route `POST /api/stem-pricing/batch` takes an optional `source` to price
only the official or only the separated stems of a release; per-stem routes
price one stem. Pricing rows stay per stem, so the two sources never share a
price.

## Configuration

No new environment variables. The backend needs `ffmpeg` on its `PATH`, which the
backend image already installs.

## Known limits

- No way yet to delete an official package without replacing it.
- The summed-level thresholds are a first version; a mix with heavy master-bus
  processing may need a wider tolerance.
- Sync, sample and broadcast tiers stay reserved; there are no standard terms for
  them.

## Testing

- Unit: `official_stems_validation.spec.ts`, `stem_source_media.spec.ts`,
  `crate_export.spec.ts`, `crate_selection.spec.ts`, `x402.quote.spec.ts`,
  `x402.receipt.spec.ts`, `official-stems.controller.http.spec.ts`.
- Integration (Postgres, ffmpeg, AES encryption, local storage):
  `official_stems.integration.spec.ts`, `crate_export.integration.spec.ts`,
  `metadata.controller.integration.spec.ts`, `mcp.stem.integration.spec.ts`.
- Web: `stemSource.test.ts`, `StemSourceBadge.test.tsx`,
  `OfficialStemsPanel.test.tsx`, `api.test.ts`, `crates.test.ts`.

## References

- [ADR-TE-7](../strategy/taste-engine-decisions.md)
- [Artist upload flow](artist_upload_flow_mvp.md)
- [Marketplace listing lifecycle](marketplace_listing_lifecycle.md)
- [Crate Digger](crate_digger.md)
