---
title: "Release Withdrawal"
status: implemented
owner: "@akoita"
issue: 1793
---

# Release Withdrawal

## Status

`implemented`

An artist takes a release out of streaming and puts it back. People who bought
something keep it. Listeners who saved it keep the entry, marked unavailable,
instead of watching it vanish.

## The rule

**Withdrawal removes a licence to stream. It does not reach a purchase.**

That distinction is the whole feature. A withdrawn release leaves discovery,
search and new playback, but a `StemPurchase`, a `PunchlineCollectible`, a
`PunchlineUnlockGrant` or a `License` is unaffected — the buyer keeps what they
paid for. Withdrawal cannot be used to reclaim it.

## Why it barely needed new storage

Three properties of the existing schema did most of the work, and it is worth
knowing them before changing anything here.

- **`Release.status` was already the availability gate.** Thirteen call sites
  filter on `status: { in: ["ready", "published"] }`. A new `withdrawn` value is
  excluded by all of them without a line of change.
- **Nothing points into the catalogue with a foreign key.** `Playlist.trackIds`
  is a plain `String[]` and `LibraryTrack` carries its own `title`, `artist` and
  `album`. So a saved reference survives a withdrawal on its own, and the
  metadata needed to render a greyed-out row is already local.
- **`Track.contentStatus` already had `dmca_removed`**, so "this row exists and
  is not servable" was an established idea rather than a new one.

Together those mean **withdrawal is a status, never a deletion**, and restoring
is the same status flipped back. Every library and playlist entry lights up
again because none of them ever moved. There is no fingerprint matching and no
migration of anyone's saved music, and there must not be: the moment withdrawal
starts deleting rows, restore stops being exact.

`statusBeforeWithdrawal` exists for one reason — a release can be withdrawn from
`ready` or from `published`, and restoring to the wrong one either hides it from
listeners or publishes something that was never published.

## Deleting instead of withdrawing

`DELETE /catalog/releases/:releaseId` (catalog owner only) removes the release
permanently. `CatalogService.deleteRelease` clears the rows derived from the
release inside one transaction: stems, pricing, listings with their mirrored
on-chain purchases, library entries, playlist references, licences,
fingerprints, DMCA reports, AI DJ listening signals and rights-route
reassessments. It refuses with `409` before touching anything when other
people's work or an off-chain sale depends on the release:

| Code | Blocker |
| --- | --- |
| `release_has_remixes` | a remix project uses one of its tracks or stems as source |
| `release_has_punchline_drops` | a Punchline drop exists on one of its tracks |
| `release_has_sales` | an x402 settlement (the only record of that sale) references one of its stems |
| `release_has_dependents` | any other foreign key raised during the delete |

The release page shows the `409` message; withdrawal remains the reversible
alternative.

## What actually had to be built

The storage was nearly free. The behaviour was not, and in two places the
existing behaviour was the opposite of what was wanted.

**Streaming did not stop.** `getTrackStream` checked rights routes and never
release status, so a withdrawal would not have withdrawn anything.

**Playlists rejected the whole edit.** `playlist.service.ts` threw
`BadRequestException` — *"Some tracks are no longer available… no playlist was
saved"* — if any track was unavailable. One withdrawn track made an entire
playlist unsaveable until the listener deleted it by hand: worse than the silent
hole this feature exists to prevent. Writes now accept withdrawn tracks. They
still refuse ids that resolve to nothing, and still refuse rights-restricted and
quarantined tracks, because relaxing those is a different decision.

**The public side door.** `GET /catalog/stems/:stemId/blob` is unauthenticated
and serves the whole stem, and gating only `getTrackStream` would have left a
withdrawal anyone could step around with a URL. It is now gated behind
`includeRestricted`, the same escape hatch the rights check uses — which is
precisely why every internal caller still works, since ingestion, stem-quality
analysis and the artist's own playback all pass that flag and only the public
route does not.

## What a listener sees

Reads return availability per entry rather than filtering entries away:

```ts
type TrackAvailability =
  | { state: "available" }
  | { state: "withdrawn"; reason: string | null; withdrawnAt: Date | null }
  | { state: "unavailable"; reason: "removed" | "rights_removed" | "under_review"
                                  | "restricted" | "not_published" | "local_file" }
```

The entry stays in the list, de-emphasised, with words — not colour alone — and
is excluded from the playback queue. `playable` remains the queue's filter; what
changed is that the rendered list no longer mirrors it.

**The reason is a machine code, and the client must never show one raw.** The
frontend maps each code to a sentence and falls back to a generic one for any
code it does not recognise. The mapping matters beyond tidiness: a rights
removal is not the artist's choice, and wording it as one — "the artist withdrew
this" — would be a small lie told at scale.

### Ownership outranks a withdrawal, but not a takedown

`trackAvailability.ts` resolves a purchase as playable through a withdrawal, an
unpublish and a geo-restriction. It does **not** resolve it as playable through
`rights_removed` or `under_review`.

A withdrawal is the artist's choice and a purchase survives it. A rights removal
is nobody's choice: it obliges us to stop serving the material, and "they bought
it" is not an answer to that. The copy already on someone's disk is beyond our
reach; what we still stream is not. The ordering of those two checks is the
entire difference, it is invisible at a glance, and a test asserts it in both
directions.

## Surfaces

| Surface | Where |
| --- | --- |
| Withdraw / restore | `POST /catalog/me/releases/:releaseId/{withdraw,restore}` |
| Availability read model | `backend/src/modules/catalog/track-availability.ts` |
| Listener resolution and copy | `web/src/components/library/trackAvailability.tsx` |
| Artist control and confirmation copy | `web/src/app/artist/catalog/releaseAvailability.tsx` |
| User Guide | `withdraw-a-release`, and the `unavailable-tracks` section of `library-playlists` |

## Verification

```bash
cd backend && npm run test:integration -- release_withdrawal
cd backend && npm run test -- playlist catalog library
cd web && npx vitest run src/components/library/trackAvailability.test.tsx \
  src/app/artist/catalog/releaseAvailability.test.tsx \
  src/components/library/PublicPlaylistView.test.tsx
```

## Known gaps

- **No field collects the artist's note.** The API accepts a `reason`, the
  catalogue displays it, and the listener-facing copy quotes it — but the
  confirmation dialog takes a string only, so nothing gathers one yet.
- **A withdrawn release stays remixable.** Remix eligibility reads
  `Artist.remixConsent` and rights routes, never release status. Defensible
  (remix consent is a separate, explicit grant) but worth an explicit decision
  rather than an accident.
- **Marketplace listings are not delisted** by a withdrawal, so a stem from a
  withdrawn release can still be sold. Withdrawal covers streaming; whether it
  should cover selling is a product question.
- **A withdrawn release's detail page still loads publicly**, returning
  `status: "withdrawn"` so the page can say so rather than 404. Deliberate, and
  worth confirming.
