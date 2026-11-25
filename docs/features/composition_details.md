# Composition details

Status: `done` ([#2669](https://github.com/akoita/resonate/issues/2669),
Vision Sprint 60 "Ready to show").

Revenue line: ingestion trust and rights data (ADR-BM-6). Nothing is charged or
paid; no fee, split, price or payout change. ADR-BM-4 is unaffected. Writer
shares are a record of what the artist declared, not a payout split.

## What it is

A recording and the composition it performs are separate rights. Each track can
now carry optional composition details:

- **Writers**: name and role (composer, lyricist, arranger), with an optional
  share, collecting society (from a fixed list, or "none" / "other") and IPI
  name number. Shares are all or nothing: once one writer has a share, every
  writer needs one and they must total exactly 100 (two decimals).
- **Publisher**, or **self-published**.
- **Work code** (ISWC), validated with its check digit and stored compact
  (`T0345246801`, shown as `T-034.524.680-1`).
- **Cover or samples** declaration with a free-text note.

Existing tracks are unaffected; the details are empty until filled.

## Where

| Surface | Who | What |
| --- | --- | --- |
| Upload page, per track, "Composition details (optional)" | artist | Entered with the upload and sent as `metadata.tracks[i].composition`; checked before any audio is stored. "Copy to all tracks" copies everything except the work code. |
| Release page, "Composition" section | release owner, track-metadata managers | Edit per track; "Copy to all tracks" (confirmation) replaces the other tracks' details, without work codes. |
| Release page, "Composition" section (read-only) | admins, operators | Full details. |
| Release page, "Songwriting" | everyone, public releases only | Writer names and roles only. |
| `/admin/usage-report` | admins, operators | CSV download of plays per track in a period. |

## Backend

Module `backend/src/modules/composition/`. Rules in `composition.ts` (no Nest,
no Prisma), shared by the upload path and the editor.

| Route | Access | Notes |
| --- | --- | --- |
| `GET /catalog/releases/:releaseId/composition` | public (`OptionalJwtAuthGuard`) | `access: "full"` for managers (`track_metadata`), admins and operators; otherwise `access: "public"` with names and roles, and only for a `ready`/`published` release on a public rights route (404 otherwise). |
| `PUT /catalog/releases/:releaseId/tracks/:trackId/composition` | JWT, `track_metadata` access | `SaveCompositionDto` for the outer shape, then `normalizeCompositionInput`; empty input removes the record. |
| `POST /catalog/releases/:releaseId/tracks/:trackId/composition/copy` | JWT, `track_metadata` access | Copies to the other tracks of the release; work codes are not copied. |
| `GET /admin/composition/usage-export?from=&to=` | admin, operator | `@AdminAudit("composition.usage_exported")` with the row count only. At most 366 days and 20,000 tracks. |

Data: `TrackComposition` (one row per track, `onDelete: Cascade` from
`Track`), with `artistId` copied from the release so export and erasure reach
it. Writers are a JSON array, re-validated on read.

Usage export: one CSV line per track with `playback.started` or
`playback.completed` facts in the window (`AnalyticsEvent`, which exists only
for listeners who allowed product analytics), with ISRC, ISWC, writers
(`name | role | share | society | ipi`, `;`-separated), publisher, the
cover/samples flag and both counts. Cells that a spreadsheet would read as a
formula are prefixed with `'`.

## Privacy

- Data download: `TrackComposition` by `artistId`.
- Account erasure: deleted (the artist's releases are withdrawn on erasure, so
  nothing is reported for them afterwards).

## Tests

`composition.spec.ts` (rules, CSV cells), `composition.controller.http.spec.ts`,
`composition.integration.spec.ts` (access, copy, export),
`ingestion.service.spec.ts` (upload path), web `composition.test.ts` and
`CompositionEditor.test.tsx`. User Guide article `composition-details`.

## Not in this slice

- Payouts or splits between writers based on the shares.
- Sending reports to a society automatically; the CSV is for an operator.
