# Artist Identity — Credited Artist vs Manager Account

- **Status:** `partial` (Phase A shipped; Phase B tracked in
  [#1492](https://github.com/akoita/resonate/issues/1492))
- **Audience:** listeners, artists, backend/frontend developers, data/analytics
  developers
- **Vision label:** `vision:keep` — trust/quality, no fee/split/payout impact
  (ADR-BM-4 untouched).

## Two distinct concepts

Resonate deliberately separates two things that surfaces kept conflating:

1. **The artist-manager account** — the `Artist` row that uploaded/owns a
   release. Its `displayName` (e.g. "Bouba", "proof") is an *account label*:
   often a manager, label, or uploader handle. It is the right identity for
   ownership, authority, and managed-catalog views.

2. **The credited artist** — the real artist a track/release is *by*. It lives
   in main-role `ReleaseArtistCredit` rows, then the free-text
   `Release.primaryArtist`, and (as a per-track scalar override) `Track.artist`.
   It is the right identity for **public discovery display and ranking**.

Discovery and public surfaces must show and rank concept #2, never falling back
to concept #1's account label unless nothing better exists. Multiple surfaces
regressed into showing the uploader account's `Artist.displayName` where the
credited release artist belongs (see [#1419](https://github.com/akoita/resonate/issues/1419),
[#1492](https://github.com/akoita/resonate/issues/1492)).

## The canonical rule

One resolution rule, resolved first-non-empty-wins:

```
trackArtist → joined main-role credits → primaryArtist → accountDisplayName → null
```

- **Backend:** `resolveCreditedArtistName(...)`,
  `normalizeCreditName(...)`, and `MAIN_ARTIST_CREDIT_ROLES` in
  [`backend/src/modules/shared/artist_attribution.ts`](../../backend/src/modules/shared/artist_attribution.ts).
  Every discovery/serializer surface routes through it instead of re-inlining an
  `a || b || c` chain. Callers that need a visible fallback apply their own
  `"Unknown Artist"` on `null`.
- **Frontend:** `getArtistName` in
  [`web/src/lib/catalogDisplay.ts`](../../web/src/lib/catalogDisplay.ts) is the
  counterpart rule for release objects; keep the two in step. Displayed-name →
  profile linking uses `artistCreditHref` / `catalogArtistHref` in
  [`web/src/lib/artistRoutes.ts`](../../web/src/lib/artistRoutes.ts) so a
  free-text credit never mis-links to the uploader's profile. The same helper
  sends unresolved credits to `/catalog/artists/<credited-name>` rather than
  fabricating an `/artist/<slug>` profile.

### Surfaces routed through the helper (Phase A)

`catalog.service.ts` (`publicArtistCreditName`), `discovery-popularity.service.ts`
(Trending + Top Artists), `recommendations.service.ts`, `home-feed.service.ts`
(`new_from_artists` + `exploration` rails), `punchline-drop.service.ts`
(featured drops), `punchline-collect.service.ts` + `punchline-unlock.service.ts`
(collector/unlock inventory), and `agent_selector.service.ts` (AI DJ ranking
context).

Intentionally **not** routed (account-anchored on purpose): community
rooms/cohorts, playlist owner display name, and remix-project creation defaults.

## Interim Home "Top Artists" keying (Phase A)

`GET /catalog/top-artists` (the Home "Top Artists" rail) previously rolled
engagement up by the uploader **account id**, so it ranked and displayed manager
accounts. As an interim fix with **no schema change**:

- `refresh()` rolls per-track engagement up by the **credited artist name** and
  writes it into `ArtistEngagement.artistId` — that column is now the interim
  identity key (a credited display name), not an account id.
- `getTopArtists()` returns items `{ rank, name, artistId, imageUrl, score,
  plays, uniqueListeners, saves }` where `name` is the credited artist and
  `artistId` is set only when published release-credit evidence resolves that
  name to one unique profile. Display-name equality alone is not trusted, so a
  stale same-name profile cannot capture the link (else `artistId` is `null`).
- The Home rail links to the artist profile when `artistId` is set, otherwise to
  the catalog artist route (`/catalog/artists/<name>`).

## Public profiles, catalog credits, and the local library

The three destinations communicate different identity guarantees:

- `/artist/<profile-id>` is a managed Resonate profile backed by a stable id.
- `/catalog/artists/<credited-name>` groups public releases by an unresolved or
  unclaimed credit without implying profile ownership.
- `/library/artists/<artist-name>` and Library album query links are private
  groupings from the listener's saved or device-local metadata.

`web/src/lib/artistRoutes.ts` owns these builders, including public release and
local album destinations. A missing `/artist/<id>` no longer renders an empty
profile: a resolvable legacy name redirects using public catalog evidence, and
an unresolved value renders an explicit not-found state. The compact Player
also preserves source scope: catalog-backed tracks open the public catalog
credit, while device-local tracks open the local Library grouping.

**Phase B (#1492):** replace the credited-name string key with a stable
credited-artist id. [#1450](https://github.com/akoita/resonate/issues/1450)'s
warehouse marts MUST adopt the same key so the serving contract stays
consistent.

## Creation-time laundering (and the fix)

Resolution rules can't help when the DATA is poisoned at creation time. Two
paths used to write the manager account's name into `Release.primaryArtist`:

- **Old upload-form behavior:** `/artist/upload` prefilled the Primary-artist
  field with the account's `displayName`, and the file-metadata autofill ranked
  that account name ABOVE the audio file's embedded artist tag. Artists tabbing
  past the field shipped releases credited to "Bouba"/"proof".
- **Backend default:** `createRelease` still defaults `primaryArtist` to
  `artist.displayName` when the caller omits it (`catalog.service.ts`). The
  upload form requires the field, so this only affects direct API callers; the
  default is retained for now and noted here so Phase B can revisit it.

**New upload behavior (#1492):** the form prefills the credited artist only
when the fetched profile is self-managed (`profileType` present and not
`"manager"`); manager accounts get an empty field with the placeholder
"Credited artist — e.g. The Game" and help text explaining the credit is the
artist on the music, not the account name. The audio file's embedded artist tag
now outranks any account label in the metadata autofill. The existing required
validation is unchanged.

**Owner correction flow:** already-poisoned releases can be fixed post-hoc.
`PATCH /catalog/releases/:id` now accepts `primaryArtist` (trimmed, non-empty,
max 200 chars) and is owner-scoped — the service verifies
`release.artist.userId` matches the caller (403 otherwise; previously this
endpoint had NO ownership check). On the release page, owners see a pencil
affordance next to the displayed artist name (hidden for non-owners) that opens
an inline input with save/cancel, wired to `updateRelease(token, releaseId,
{ primaryArtist })` in `web/src/lib/api.ts`.

## Regression guard

This bug class regressed repeatedly, so a fast unit test defends it:
[`backend/src/tests/artist_attribution.spec.ts`](../../backend/src/tests/artist_attribution.spec.ts)
covers the resolution order **and** source-scans the routed serializer files —
asserting they import `resolveCreditedArtistName` and no longer inline the raw
`|| …artist?.displayName` account fallback.

## How to test

- Backend unit: `cd backend && npx jest --testPathPattern='artist_attribution'`
- Discovery integration:
  `cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='discovery-popularity'`
- Owner correction (ownership + validation):
  `cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='catalog.integration'`
- Frontend rail: `cd web && npx vitest run PopularityRails`
- Frontend destinations: `cd web && npx vitest run src/lib/artistRoutes.test.ts`

## References

- Issue: [#1492](https://github.com/akoita/resonate/issues/1492) (Phase A here,
  Phase B stable ids)
- Related: [#1419](https://github.com/akoita/resonate/issues/1419) (artist links),
  [#1451](https://github.com/akoita/resonate/issues/1451) (True Trending & Top
  Artists), [#1450](https://github.com/akoita/resonate/issues/1450) (warehouse
  marts), [#1820](https://github.com/akoita/resonate/issues/1820) (destination
  consistency)
- Code: `backend/src/modules/shared/artist_attribution.ts`,
  `web/src/lib/catalogDisplay.ts`, `web/src/lib/artistRoutes.ts`
