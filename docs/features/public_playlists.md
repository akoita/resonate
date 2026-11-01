# Public Playlists

**Status:** `implemented` (slice 1) — [#1216](https://github.com/akoita/resonate/issues/1216)

Playlists are **private by default**. An owner can make a playlist **public** to
share a curated selection of tracks — to show their taste, for curation, or for
professional reasons. Anyone can listen and add the playlist to their own
library, whether they followed a direct link or **discovered it in the global
catalog**.

## Who it's for

- **Listeners / curators** — share a selection of tracks with others.
- **Frontend/backend developers** — visibility model and public read contract.
- **Agent/API consumers** — read public playlists without authentication.

## What value it provides

- Turns the previously private-only playlist into a shareable artifact.
- Lets listeners follow other people's public playlists (live reference, not a copy).
- Keeps private playlists fully private — existence and folder organization are never leaked.

## How it works

Playlist `trackIds` reference the **owner's** `LibraryTrack` records, so a
non-owner cannot resolve them directly. When a playlist is public, the backend
resolves those ids into a **denormalized, streamable track list**:

- Catalog/remote tracks become public catalog stream/artwork paths and are
  playable by anyone.
- Owner-device-only files (`source: "local"`) are **left out for every viewer
  but the owner** and only counted in `privateTrackCount` ([#2506](https://github.com/akoita/resonate/issues/2506)).
  Their titles, tags and ids are the owner's private data and nobody else can
  play them. The owner still sees them, marked `playable: false`. Discovery
  cards do not count them either.

Resolution matches the owner's rows by **`LibraryTrack.id`, `clientKey` _or_ `catalogTrackId`**,
scoped to the owner. Catalog tracks are added to playlists by their catalog track
id (not the per-user library uuid), so matching on `catalogTrackId` is what makes
them resolve — and the owner scope guarantees one user's library can never satisfy
another user's playlist. This is enforced identically in the single public view
(`resolvePublicTracks`) and the discovery feed (`listPublicPlaylists`). The
library save path stores catalog tracks **per user** (deduped by
`(userId, catalogTrackId)`, not by the shared catalog id) so a second listener
saving the same track cannot reassign the first owner's row
([#1267](https://github.com/akoita/resonate/issues/1267)).

**Add to library** is a **live reference** (`SavedPlaylist`), not a copy. Saved
playlists are re-resolved through the public endpoint on every read, so owner
edits propagate and a source that goes private or is deleted surfaces as
**unavailable** instead of stale data.

### Discovery in the global catalog

Public playlists are a first-class content type in the catalog, alongside
releases, artists, and stems. The catalog page (`/catalog`) and the home "Global
catalog snapshot" each have a **Playlists** tab that lists public playlists as
artwork-first cards (a large 2×2 cover mosaic, the curator's name, and a track
count) linking to the public viewer.

Discovery deliberately surfaces **only playable public playlists** — a playlist
must be `public` *and* contain at least one catalog-backed (streamable) track to
appear. Empty playlists and playlists made entirely of owner-device files are
never shown, so a discovery surface never leads to a dead end. The feed is
ordered **most-recently-updated first** (recency only — no personalized ranking
yet), and cover/track resolution for the whole page is a single batched query.

## How to use it

### End user

1. Open **Library → Playlists** and open a playlist you own.
2. Click **Share** → toggle **Public playlist** on. Copy the link.
3. Anyone opening `/(playlist)/<id>` can press **Play** and **Add to library**.
   Once it has a playable track, it also appears in the **Playlists** tab of the
   global catalog for anyone to find.
4. Toggle it back to **Private** at any time; saved copies then show as
   unavailable and it drops out of the catalog.

Adding tracks: any track, release, album, or artist (including artist pages
inside My Library) offers **Add to playlist**; in My Library, select several
tracks and use **Add N to playlist**, or drag them onto a playlist in the side
panel — onto a collapsed playlist, an expanded playlist's track list, or
between its tracks. A saved catalog track has two ids (its library id and its
catalog id); adding it to a playlist that already holds it under either id is
reported as "already in playlist" instead of creating a duplicate. Dragging a track row from one playlist onto another
playlist copies it (the source keeps it); dropping it on its own playlist
reorders. Playlist tracks do not need to be saved in the library:
catalog tracks resolve through the catalog with a playable stream URL, so they
play either way. Library playlist cards — your own and the public playlists
you saved — show the same 2×2 cover mosaic as catalog playlist cards (a saved
playlist's covers come from its playable tracks, as in the catalog).

Note: a playlist that only exists on your device must be synced to your account
before it can be shared (the Share toggle is disabled until then).

### Developer / Agent / API

- `GET /playlists/public/:id` — public read (auth optional). With a token the
  response also reports `isOwner` and `isSaved`. Returns `404` for private
  playlists viewed by non-owners (no existence leak).
- `GET /catalog/playlists?limit=` — public discovery feed. Returns lightweight
  summaries (id, name, owner display name, track/playable counts, up to 4 cover
  artwork paths, timestamps) for public playlists that have at least one playable
  track, ordered most-recently-updated first. Lives on the catalog surface to sit
  beside releases/artists/stems and to avoid colliding with `/playlists/:id`.
- `PUT /playlists/:id` with `{ "visibility": "public" | "private" }` — owner-only.
- `POST /playlists/saved` `{ "sourcePlaylistId" }` — save a public playlist.
- `GET /playlists/saved` — list saved playlists (re-resolved live, with `available`).
- `DELETE /playlists/saved/:id` — remove a saved playlist.

## Surfaces

| Kind | Reference |
| --- | --- |
| UI route (public viewer) | `web/src/app/playlist/[id]/page.tsx` → `PublicPlaylistView` |
| UI (catalog discovery) | `web/src/app/catalog/page.tsx` + home `web/src/app/page.tsx` "Playlists" tab → `web/src/components/catalog/CatalogPlaylistCard.tsx` |
| UI (shared playlist layout) | `web/src/components/library/PlaylistLayout.tsx`: `PlaylistHero`, `PlaylistTrackRow` and the row's "⋯" `RowMenuButton`, drawn by both the owner page (`PlaylistDetail`) and the public viewer, so the two pages look the same. The owner page adds only owner actions: drag to reorder (the row number turns into a grip), multi-select, a click-to-rename title and Add to playlist / Remove from playlist in the row menu (confirmed with `ConfirmDialog`). The menu opens from the "⋯" button, a right-click, or Shift+F10 / the Menu key on the keyboard row. |
| UI (owner share control) | `web/src/components/library/PlaylistShareControl.tsx` |
| UI (saved playlists + badges) | `web/src/components/library/PlaylistTab.tsx`; a saved playlist opens inside the Library (`/library?tab=playlists&saved=<id>`), rendering `PublicPlaylistView` with `onBack` so it fills the Library pane with the tabs and a Back button. The standalone `/playlist/<id>` page is full width too. |
| API client | `getPublicPlaylistAPI`, `listPublicPlaylists`, `setPlaylistVisibilityAPI`, `savePlaylistAPI`, `listSavedPlaylistsAPI`, `removeSavedPlaylistAPI` (`web/src/lib/api.ts`) |
| Backend service | `PlaylistService.getPublicPlaylist` / `listPublicPlaylists` / `savePlaylist` / `listSavedPlaylists` / `removeSavedPlaylist` (`backend/src/modules/playlist/playlist.service.ts`) |
| Public controllers | `PublicPlaylistController` + `OptionalJwtAuthGuard`; `PublicPlaylistDiscoveryController` (`GET /catalog/playlists`). Both live in `PlaylistModule` — the discovery controller is mounted under the `catalog/playlists` path but kept in `PlaylistModule` so `CatalogModule` does not import `PlaylistModule` (which would close a NestJS module cycle via `SharedModule`). |
| Data model | `Playlist.visibility`, `SavedPlaylist` (`backend/prisma/schema.prisma`) |
| Domain events | `playlist.visibility_changed`, `playlist.saved_to_library`, `playlist.removed_from_library` |
| Product analytics | `playlist.visibility_changed`, `playlist.shared`, `playlist.saved`, `playlist.removed_from_library`; `search.result_clicked` (`resultType: "playlist"`) from home catalog. The backend accepts `playlist.shared` (strict `{ playlistId, channel: "copy_link" }` payload); `playlist.visibility_changed`, `playlist.saved`, and `playlist.removed_from_library` are emitted by the web client but not yet on the backend product-event allowlist, so they are rejected with 400 |
| Tests | `backend/src/tests/playlist-public.integration.spec.ts`, `backend/src/tests/playlist-discovery.integration.spec.ts`, `web/src/components/catalog/CatalogPlaylistCard.test.tsx`, `web/src/lib/publicPlaylists.test.ts`, `web/src/components/library/PlaylistLayout.test.tsx`, `web/src/components/library/PublicPlaylistView.test.tsx` |

## Owner and public pages share one layout

The owner's page in the library and the public link used to be two separate
designs (big Remove buttons and no track numbers on one, a card header and a
narrow track column on the other). Both now render the same header card and
track rows: number, artwork, title with artist and album, length, and a "⋯"
menu revealed on hover or focus. The owner's page fills in a missing track
length from the track's stems or the catalog (`withKnownDuration` in
`web/src/lib/localLibrary.ts`), so it shows the same lengths as the public page.

## Remaining / deferred

- **Moderation/report** of public playlists (UGC reachable by others) is not yet
  implemented — tracked on [#1216](https://github.com/akoita/resonate/issues/1216).
- **Ranking / personalization** of the discovery feed. The catalog Playlists tab
  ships with recency ordering only; relevance/personalized ranking is a follow-up.
- **Collaborative (multi-owner)** playlists.

> Discovery (browsing public playlists in the global catalog) shipped — see
> "Discovery in the global catalog" above.
