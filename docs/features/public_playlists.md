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
- Owner-device-only files (no catalog reference) are returned but marked
  `playable: false` — other listeners can see them but cannot stream them.

**Add to library** is a **live reference** (`SavedPlaylist`), not a copy. Saved
playlists are re-resolved through the public endpoint on every read, so owner
edits propagate and a source that goes private or is deleted surfaces as
**unavailable** instead of stale data.

### Discovery in the global catalog

Public playlists are a first-class content type in the catalog, alongside
releases, artists, and stems. The catalog page (`/catalog`) and the home "Global
catalog snapshot" each have a **Playlists** tab that lists public playlists as
cards (a 2×2 cover mosaic, the curator's name, and a track count) linking to the
public viewer.

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
| UI (owner share control) | `web/src/components/library/PlaylistShareControl.tsx` |
| UI (saved playlists + badges) | `web/src/components/library/PlaylistTab.tsx` |
| API client | `getPublicPlaylistAPI`, `listPublicPlaylists`, `setPlaylistVisibilityAPI`, `savePlaylistAPI`, `listSavedPlaylistsAPI`, `removeSavedPlaylistAPI` (`web/src/lib/api.ts`) |
| Backend service | `PlaylistService.getPublicPlaylist` / `listPublicPlaylists` / `savePlaylist` / `listSavedPlaylists` / `removeSavedPlaylist` (`backend/src/modules/playlist/playlist.service.ts`) |
| Public controllers | `PublicPlaylistController` + `OptionalJwtAuthGuard`; `PublicPlaylistDiscoveryController` (`GET /catalog/playlists`). Both live in `PlaylistModule` — the discovery controller is mounted under the `catalog/playlists` path but kept in `PlaylistModule` so `CatalogModule` does not import `PlaylistModule` (which would close a NestJS module cycle via `SharedModule`). |
| Data model | `Playlist.visibility`, `SavedPlaylist` (`backend/prisma/schema.prisma`) |
| Domain events | `playlist.visibility_changed`, `playlist.saved_to_library`, `playlist.removed_from_library` |
| Product analytics | `playlist.visibility_changed`, `playlist.shared`, `playlist.saved`, `playlist.removed_from_library`; `search.result_clicked` (`resultType: "playlist"`) from home catalog |
| Tests | `backend/src/tests/playlist-public.integration.spec.ts`, `backend/src/tests/playlist-discovery.integration.spec.ts`, `web/src/components/catalog/CatalogPlaylistCard.test.tsx`, `web/src/lib/publicPlaylists.test.ts` |

## Remaining / deferred

- **Moderation/report** of public playlists (UGC reachable by others) is not yet
  implemented — tracked on [#1216](https://github.com/akoita/resonate/issues/1216).
- **Ranking / personalization** of the discovery feed. The catalog Playlists tab
  ships with recency ordering only; relevance/personalized ranking is a follow-up.
- **Collaborative (multi-owner)** playlists.

> Discovery (browsing public playlists in the global catalog) shipped — see
> "Discovery in the global catalog" above.
