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

The credit picker surfaces existing artist IDs while a manager enters credits.
Selecting a primary artist carries that exact ID into the release upload. A
typed name without an ID is linked only when there is one case-insensitive
public artist profile match and no other profile with that name. A manager
match or several same-name profiles produces an unresolved credit for review.
This prevents the picker from silently choosing one artist by name.

## How To Use It

### As an end user (artist)

- **Primary artist** (Release Settings) and **Track artist** (Track Details):
  start typing; matching existing artists appear in a dropdown with avatar and a
  `Unclaimed` badge where relevant. Pick one to reuse it — an inline
  `✓ Linked to existing artist` confirmation appears. To create a new artist,
  keep typing the full name and choose the explicit **“Add new artist …”** row
  (or press Enter when no unique exact match exists). Same-name matches show
  separate rows with profile type and an ID fragment.
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
  contains `q` (case-insensitive) and are public artist profiles, kept distinct by ID and ranked
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

- The selected **primary** artist ID is submitted in `artistCredits` during
  upload. Selecting a Track artist or Featured artist still records a text
  credit; per-track artist IDs need a separate catalog model change.
- Credit selection does not grant profile ownership, rights, or payouts.

## Related

- [Artist Upload Flow MVP](artist_upload_flow_mvp.md)
- [Catalog Indexing MVP](catalog_indexing_mvp.md)
- [Rights Verification Workflow](rights_verification_workflow.md)
