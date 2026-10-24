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
accepted 2026-10-24). Vision Sprint 43 ([#2379](https://github.com/akoita/resonate/issues/2379),
owner-approved 2026-10-24) allows partial packages and closes the test and guide
gaps; tuning the thresholds on real packages and removing a package stay open in
#2379 (see [Known limits](#known-limits)). Revenue line: ADR-BM-6 Line 3, marketplace take-rate 10%,
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

A package is **any non-empty subset** of the six stem types (#2379): an artist who
has only the vocals and the bass uploads those two. Each part is judged on its
own, so one weak part never hides behind the others. Checks
(`official-stems.validation.ts`, measurements in `official-stems.audio.ts`); each
refusal is a 400 `official_stems_rejected` with `issues[]` of readable reasons,
one per problem and each naming its part (`stemType`), all reported at once:

| Check | Applies to | Rule |
| --- | --- | --- |
| Stem types | package | one of the six types, once each |
| Format | each part | WAV (PCM or float) or FLAC, read from the file header; lossy codecs inside WAV are refused |
| Sample rate | each part, package | 44.1, 48, 88.2, 96, 176.4 or 192 kHz, the same for every file |
| Channels | each part | mono or stereo |
| Duration | each part | within `max(0.5 s, 0.5% of the mix)` of the published mix |
| Silence | each part | not below -70 dBFS RMS |
| Level | each part | not more than 6 dB louder than the whole mix (`part_louder_than_mix`) |
| Alignment | each part | its loudness over time follows the mix's without a shift (`misaligned`), see below |
| Summed level | complete package only | the parts added sample for sample are within 6 dB RMS of the mix, and their 100 ms loudness envelope correlates at least 0.8 with the mix's |

The mix and the parts are decoded with `ffmpeg` (already in the backend image for
remix rendering) to 8 kHz mono; no ffprobe or Demucs-worker change is needed.

**Per-part alignment.** With the other parts absent, a part cannot be compared with
a sum, and a plain envelope correlation fails for a quiet part (a bass under loud
drums correlates with nothing, even when aligned). So the 100 ms loudness
envelope of the part is compared with the mix's **band by band** (0-200, 200-800,
800-2000 and 2000-4000 Hz), where the part is audible: only frames where the part
is active (within 20 dB of its own peak in that band) count, and bands are weighted
by the part's energy in them. The correlation is taken at every offset up to
+-1 s. An aligned part peaks within 100 ms of no offset; a part exported late or
early peaks at its real offset, which the message states ("matches the mix about
0.7 s later than where it sits"). A part is refused when:

- some other offset correlates better than the tolerated ones by more than
  `OFFICIAL_STEM_PART_OFFSET_MARGIN` (0.35), or
- its best tolerated correlation is below `OFFICIAL_STEM_PART_MIN_CORRELATION`
  (0.05): it follows nothing in the mix.

A part with fewer than 3 s of audio, or too few active frames in every band, is
not judged on alignment (it still gets every other check). The constants are in
`official-stems.validation.ts` with their calibration: on six synthetic parts
with rhythms of their own (`fullSong` in `official_stems_fixtures.ts`, eight
seeds, 20 s), aligned parts and parts half a frame off never exceed a 0.29 gap,
while parts 0.3 s or more late exceed 0.35 for every part with a rhythm of its
own. `official_stems_validation.spec.ts` pins these numbers.

**Complete packages.** The summed-level check runs only when the package supplies
every part the track is sold with: the types of the track's current separated
stems (`expectedPartTypes`; official stems do not count, so a partial package
cannot define its own completeness). A track with no separated stems has no
expectation, so nothing is compared with the sum. Catalog tracks are separated
into all six types, so in practice the sum check runs when all six parts are
uploaded; a four-part package is judged part by part. The response says which case
applied (`complete`, and `summedLevel` only when it ran).

An accepted package is encrypted like every stem (a stem that cannot be
encrypted is never stored in the clear), stored lossless under
`<stemId>.wav|flac`, and recorded with `mimeType` `audio/wav` or `audio/flac`. A
package **retires only the official stems of the types it supplies** (the old
rows become historical and a price already set for that part is carried over);
official parts of other types stay on sale (`kept` in the response). A part that
has been minted cannot be replaced (409 `official_stems_already_minted`), but a
minted part does not block replacing another part: leave it out of the package.
A track audio replacement makes every current stem, official ones included,
historical, because the parts no longer match the mix.

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

- No way yet to delete an official package or part without replacing it
  (open in #2379).
- Every threshold is a first version tuned on synthetic fixtures, not on real
  artist packages (data-gated, open in #2379): the 6 dB summed-level tolerance (a
  mix with heavy master-bus processing may need more), the per-part offset margin
  and the correlation floor.
- A single part cannot be proved to belong to the track. A part with an almost
  steady level (a held pad, a quiet bass line) has no timing for the envelope to
  hold on to and can slip through when shifted; a part of another song with the
  same beat grid and instruments can correlate as well as a real one; and the
  mix itself uploaded as one part at a normal level passes the per-part checks
  (a complete package's sum catches it). Only a complete package's sum is held to
  the mix.
- The expected set is the track's separated stem types, which is all six for a
  catalog track, so the sum check rarely runs. An explicit "this is every part"
  signal from the artist would make it reachable for four-part packages; that is
  a product decision, not made here.
- Sync, sample and broadcast tiers stay reserved; there are no standard terms for
  them.

## Testing

- Unit: `official_stems_validation.spec.ts` (rules, per-part alignment on the
  six-part fixture song, and a real FLAC decode through ffmpeg that skips with a
  stated reason when ffmpeg is not on `PATH`), `stem_source_media.spec.ts`,
  `crate_export.spec.ts`, `crate_selection.spec.ts`, `x402.quote.spec.ts`,
  `x402.receipt.spec.ts`, `official-stems.controller.http.spec.ts`.
- Integration (Postgres, ffmpeg, AES encryption, local storage):
  `official_stems.integration.spec.ts` (partial packages, retire-only-supplied,
  minted part, complete package, real FLAC part), `crate_quote.integration.spec.ts`
  (the same stem type sold as Official and as Separated (AI): the quote follows
  the crate's `stemSource` filter and never counts both),
  `crate_export.integration.spec.ts`, `metadata.controller.integration.spec.ts`,
  `mcp.stem.integration.spec.ts`.
- Web: `stemSource.test.ts`, `marketplaceListingsQuery.test.ts` (the Browse stems
  `?source=` query), the listings proxy `route.test.ts`, `officialStems.test.ts`,
  `StemSourceBadge.test.tsx`, `OfficialStemsPanel.test.tsx`, `api.test.ts`,
  `crates.test.ts`.
- User Guide figures `official-stems-panel.png` and `stem-source-badges.png`:
  `CAPTURE_OFFICIAL_STEMS=true` pass of `web/scripts/capture-help-screenshots.mjs`
  against the mocked data in `web/tests/fixtures/official-stems-mock.mjs`.

## References

- [ADR-TE-7](../strategy/taste-engine-decisions.md)
- [Artist upload flow](artist_upload_flow_mvp.md)
- [Marketplace listing lifecycle](marketplace_listing_lifecycle.md)
- [Crate Digger](crate_digger.md)
