# Security Best Practices Report — Public Playlists in the Global Catalog

_Scope: the diff on `feat/public-playlists-in-catalog` vs `origin/main` — the new
public playlist discovery endpoint and its frontend surfaces._

## Executive Summary

No Critical, High, or Medium findings. The change adds one **public,
read-only** discovery endpoint (`GET /catalog/playlists`) and two frontend tabs.
It introduces no authentication/authorization changes, no secrets, no raw SQL,
and no new personal-data exposure beyond what the existing public-playlist viewer
already returns. Posture is consistent with the surrounding public catalog
endpoints.

## Scope reviewed

Backend:
- `backend/src/modules/playlist/playlist.controller.ts` — new
  `PublicPlaylistDiscoveryController` serving `GET /catalog/playlists` (public).
  Mounted in `PlaylistModule` so `CatalogModule` does not import `PlaylistModule`
  (avoids a NestJS module cycle via `SharedModule`).
- `backend/src/modules/playlist/playlist.service.ts` — `listPublicPlaylists`

Frontend:
- `web/src/lib/api.ts`, `web/src/lib/catalogDisplay.ts`,
  `web/src/components/catalog/CatalogPlaylistCard.tsx`,
  `web/src/app/catalog/page.tsx`, `web/src/app/page.tsx`

## Checks performed

| Check | Result |
| --- | --- |
| Hardcoded secrets (`password\|secret\|api_key\|private_key`) | None |
| Raw/unparameterized SQL (`$queryRaw`/`$executeRaw`/`rawQuery`) | None — all access via Prisma query builder |
| Unsafe deserialization (`eval`/`JSON.parse`) | None |
| Auth on the new route | Intentionally public (read-only discovery), matching `GET /catalog/published`; no owner-only or mutating capability added |
| Input validation | `limit` coerced to a number in the controller and clamped to `[1, 100]` in `clampLimit`; candidate scan capped at `PUBLIC_PLAYLIST_DISCOVERY_MAX = 100` |
| XSS vectors (`dangerouslySetInnerHTML`/`innerHTML`) | None added; covers rendered via CSS `background-image` and React text nodes |
| Client-exposed secrets (`NEXT_PUBLIC_*SECRET/KEY/PASSWORD`) | None |

## Findings

### Informational

- **SBPR-I1 — Public discovery returns `ownerUserId` and `ownerDisplayName`.**
  `listPublicPlaylists` returns the owner's UUID and public display name for each
  public playlist. **Not a regression:** the existing public viewer
  (`GET /playlists/public/:id`) already returns both for any public playlist, and
  `ownerUserId` is a non-enumerable UUID, not PII. No email, wallet address, or
  private data is included.
- **SBPR-I2 — Visibility gate.** Only `visibility: "public"` playlists are
  queried; private playlists are never read or counted. Empty / all-local
  playlists are additionally filtered out (playable-track gate), so the feed
  cannot leak the existence of a private or device-only playlist.
- **SBPR-I3 — Cross-owner track lookup.** Cover/count resolution batches
  `libraryTrack.findMany({ where: { id: { in: allTrackIds } } })` across owners.
  Track ids originate from the public playlists themselves and `LibraryTrack.id`
  is a globally-unique UUID, so each id resolves only to its own owner's row.
  The summary derives only public catalog artwork paths and counts from these
  rows — no track titles or owner fields are returned.

## Conclusion

No fixes required. The endpoint follows the established public-catalog pattern,
validates and bounds its only input, and exposes no data beyond the existing
public-playlist contract.
