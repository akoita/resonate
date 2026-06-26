# Security Best Practices Report — LibraryTrack ownership fix (#1267)

_Scope: the diff on `fix/1267-library-track-ownership` vs `origin/main` —
`LibraryService.saveTrack` and the public-playlist track resolution in
`PlaylistService`._

## Executive Summary

No Critical, High, or Medium findings. This change is itself a **security/privacy
hardening**: it closes a cross-user data-integrity bug (one user's catalog-track
save reassigning another user's `LibraryTrack.userId`) and makes public-playlist
resolution strictly **owner-scoped**, so one listener's library can never satisfy
another listener's playlist.

## Checks performed

| Check | Result |
| --- | --- |
| Hardcoded secrets | None |
| Raw/unparameterized SQL | None — all access via Prisma query builder; `in` / `OR` use parameterized arrays |
| Unsafe deserialization (`eval`/`JSON.parse`) | None |
| AuthZ / tenant isolation | Strengthened — see findings |
| Source hygiene | A stray NUL byte introduced during editing was found and removed (`playlist.service.ts`); the owner-scoping lookup now uses a nested `Map` keyed by `userId` |

## Findings

### Informational / hardening

- **SBPR-I1 — Cross-user ownership hijack fixed.** `saveTrack` previously
  upserted `LibraryTrack` by a client-supplied `id` that, for catalog tracks, is
  the **shared catalog track id**. A second user saving the same track
  overwrote the first user's row and reassigned its `userId`. Remote catalog
  tracks now dedup per-user by `(userId, catalogTrackId)` with a per-user id, so
  rows are isolated per tenant. No schema change (the unique constraint already
  existed).
- **SBPR-I2 — Owner-scoped public resolution.** `resolvePublicTracks` and
  `listPublicPlaylists` now resolve a playlist's tracks only against the
  **playlist owner's** rows, matching by `id` or `catalogTrackId`. A playlist can
  never resolve another user's library row, and the discovery feed cannot
  advertise a track the owner-scoped public view won't render.
- **SBPR-I3 — No new exposure.** The discovery summary still returns only
  `ownerDisplayName` and the already-public `ownerUserId`; no track titles, PII,
  or another user's data are surfaced.

## Caveat

Already-corrupted rows (hijacked before this fix) are not retroactively repaired;
an affected user re-saving the track creates their own per-user row. A one-off
data backfill is a separate ops task.

## Conclusion

No fixes required. The change removes a tenant-isolation defect and tightens
public-playlist resolution.
