---
title: "Artist Credit Picker (Duplicate Guard)"
status: implemented
owner: "@akoita"
---

# Artist Credit Picker (Duplicate Guard)

## Status

`implemented`

## Who It Is For

Artists and managers using the upload/publish studio (`/artist/upload`) to credit
themselves and collaborators on a release and its individual tracks.

## What Value It Provides

Artist credit fields used to be plain free-text inputs. Catalog credit resolution
links a credit name to an existing artist profile only by an **exact
(case-insensitive) `displayName` match** — otherwise it silently mints a new
unclaimed `public_artist` profile (see `findOrCreatePublicArtistProfile` in
`backend/src/modules/catalog/catalog.service.ts`). A typo, casing difference, or
trailing space (`"Bouba"` vs `"bouba"` vs `"Bouba "`) therefore created a
*different* artist by mistake and fragmented a single artist's catalog across
duplicate profiles.

The credit picker turns these fields into a typeahead that surfaces existing
artists as you type, so the canonical spelling is reused. Creating a genuinely
new artist is still possible but becomes an explicit, deliberate action.

## How To Use It

### As an end user (artist)

- **Primary artist** (Release Settings) and **Track artist** (Track Details):
  start typing; matching existing artists appear in a dropdown with avatar and a
  `Unclaimed` badge where relevant. Pick one to reuse it — an inline
  `✓ Linked to existing artist` confirmation appears. To create a new artist,
  keep typing the full name and choose the explicit **“Add new artist …”** row
  (or press Enter when no exact match exists).
- **Featured artists** (Track Details): a chip field. Search and pick existing
  artists, or type a new name and press Enter / comma to add it. Each name
  becomes a removable chip. Backspace on the empty field removes the last chip.
  Pasting `A, B, C` adds three chips at once.

The fields remain free-solo: an artist that does not exist yet can always be
typed and added. If the search request fails (offline, mock auth), the fields
degrade to ordinary text inputs.

### As a developer / API consumer

- **Search endpoint:** `GET /artists/search?q=<query>&limit=<n>` (JWT). Returns
  up to `limit` (default 8, max 25) existing profiles whose `displayName`
  contains `q` (case-insensitive), deduped by normalized name and ranked
  exact > prefix > claimed > has-image. Each item is
  `{ id, displayName, imageUrl, profileType, claimStatus }` — public-facing
  fields only; no user, payout, or contact data.
- **Frontend client:** `searchArtists(token, query, limit)` in `web/src/lib/api.ts`.
- **Components:** `ArtistAutocomplete` (single value) and `ArtistTagInput`
  (comma-separated multi-value, payload-compatible) in
  `web/src/components/ui/ArtistAutocomplete.tsx`.

## Surfaces

| Kind | Surface |
| --- | --- |
| UI route | `/artist/upload` (Release Settings → Primary artist; Track Details → Track artist, Featured artists) |
| API | `GET /artists/search?q=&limit=` (JWT) |
| Backend | `ArtistService.searchByName`, `ArtistController.search` |
| Frontend | `searchArtists`, `ArtistAutocomplete`, `ArtistTagInput` |
| Tests | `backend/src/tests/artist-search.integration.spec.ts`, `web/src/components/ui/ArtistAutocomplete.test.tsx` |

## Notes / Deferred

- The publish payload is unchanged: credits are still submitted as display-name
  strings, and the backend resolves them to existing profiles by exact name. The
  picker's job is to make sure that name is the canonical existing one.
- **Deferred:** passing the selected hard `artistId` through `artistCredits` for
  100% precise linking (independent of name matching). This would also require
  schema support for per-track artist ids, which today only exist at release
  level. Tracked as follow-up; not needed to fix the duplication this feature
  targets.

## Related

- [Artist Upload Flow MVP](artist_upload_flow_mvp.md)
- [Catalog Indexing MVP](catalog_indexing_mvp.md)
- [Rights Verification Workflow](rights_verification_workflow.md)
