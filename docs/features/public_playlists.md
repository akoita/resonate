# Public Playlists

**Status:** `implemented` (slice 1) — [#1216](https://github.com/akoita/resonate/issues/1216)

Playlists are **private by default**. An owner can make a playlist **public** to
share a curated selection of tracks by link — to show their taste, for
curation, or for professional reasons. Anyone with the link can listen and add
the playlist to their own library.

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

## How to use it

### End user

1. Open **Library → Playlists** and open a playlist you own.
2. Click **Share** → toggle **Public playlist** on. Copy the link.
3. Anyone opening `/(playlist)/<id>` can press **Play** and **Add to library**.
4. Toggle it back to **Private** at any time; saved copies then show as unavailable.

Note: a playlist that only exists on your device must be synced to your account
before it can be shared (the Share toggle is disabled until then).

### Developer / Agent / API

- `GET /playlists/public/:id` — public read (auth optional). With a token the
  response also reports `isOwner` and `isSaved`. Returns `404` for private
  playlists viewed by non-owners (no existence leak).
- `PUT /playlists/:id` with `{ "visibility": "public" | "private" }` — owner-only.
- `POST /playlists/saved` `{ "sourcePlaylistId" }` — save a public playlist.
- `GET /playlists/saved` — list saved playlists (re-resolved live, with `available`).
- `DELETE /playlists/saved/:id` — remove a saved playlist.

## Surfaces

| Kind | Reference |
| --- | --- |
| UI route (public viewer) | `web/src/app/playlist/[id]/page.tsx` → `PublicPlaylistView` |
| UI (owner share control) | `web/src/components/library/PlaylistShareControl.tsx` |
| UI (saved playlists + badges) | `web/src/components/library/PlaylistTab.tsx` |
| API client | `getPublicPlaylistAPI`, `setPlaylistVisibilityAPI`, `savePlaylistAPI`, `listSavedPlaylistsAPI`, `removeSavedPlaylistAPI` (`web/src/lib/api.ts`) |
| Backend service | `PlaylistService.getPublicPlaylist` / `savePlaylist` / `listSavedPlaylists` / `removeSavedPlaylist` (`backend/src/modules/playlist/playlist.service.ts`) |
| Public controller | `PublicPlaylistController` + `OptionalJwtAuthGuard` |
| Data model | `Playlist.visibility`, `SavedPlaylist` (`backend/prisma/schema.prisma`) |
| Domain events | `playlist.visibility_changed`, `playlist.saved_to_library`, `playlist.removed_from_library` |
| Product analytics | `playlist.visibility_changed`, `playlist.shared`, `playlist.saved`, `playlist.removed_from_library` |
| Tests | `backend/src/tests/playlist-public.integration.spec.ts` |

## Remaining / deferred

- **Moderation/report** of public playlists (UGC reachable by others) is not yet
  implemented — tracked on [#1216](https://github.com/akoita/resonate/issues/1216).
- **Discovery feed** (browsing/ranking public playlists) beyond direct links.
- **Collaborative (multi-owner)** playlists.
