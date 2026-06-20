# Security Best Practices Report — Public Playlists (#1216)

Scope: changes on `feat/1216-public-playlists` (commits `60cfecf..HEAD`), i.e. the
public-playlists slice only. Stack: NestJS + Prisma (backend), Next.js + React (frontend).

## Executive Summary

No Critical, High, or Medium findings. The slice adds one intentionally public,
optional-auth read endpoint and three owner-scoped saved-playlist endpoints. All
identifiers are UUIDs, authorization is enforced server-side, inputs are
whitelist-validated or parameterized through Prisma, and no secrets, raw SQL,
`eval`, `dangerouslySetInnerHTML`, or hardcoded URLs were introduced.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low / Informational Findings

### SBPR-001 (Informational): Public view returns the owner's user id

**File:** `backend/src/modules/playlist/playlist.service.ts` (`getPublicPlaylist` → `ownerUserId`)
**Impact:** The public playlist payload includes the owner's `User.id` (an opaque
UUID). It is not PII and not enumerable, and the frontend relies on the
server-computed `isOwner`/`ownerDisplayName` rather than this field.
**Recommendation:** Acceptable as-is. Could be dropped from the public response in
a later pass to minimize surface; no action required now.

### SBPR-002 (Low): `listSavedPlaylists` re-resolves each entry sequentially

**File:** `backend/src/modules/playlist/playlist.service.ts` (`listSavedPlaylists`)
**Impact:** One resolve (2 queries) per saved playlist. Bounded by how many
playlists a single user saves; not attacker-amplifiable beyond the caller's own
account. Efficiency, not a security issue.
**Recommendation:** Fine for the current slice; batch-resolve if saved lists grow large.

## Checks performed (all clean on this slice)

- **AuthZ / IDOR:** `getPublicPlaylist` returns `404` unless `visibility==="public"`
  or the caller is the owner (private existence is not leaked, folder organization
  is never returned). `removeSavedPlaylist` verifies `entry.userId === userId`.
  `savePlaylist` rejects saving a private playlist or one you already own.
- **Identifiers:** playlists/saved records use UUID primary keys (non-enumerable).
- **Optional auth:** `OptionalJwtAuthGuard` swallows only the *absence* of a token;
  a present token is still signature-validated by the JWT strategy, so a forged/
  invalid token yields no `user` and cannot escalate to owner state.
- **Input validation:** `visibility` is whitelist-validated (`normalizeVisibility`);
  all ids flow through Prisma (parameterized) — no string-built SQL.
- **No raw SQL / `eval` / unsafe deserialization** in the added code.
- **Frontend:** no `dangerouslySetInnerHTML`/`innerHTML`; share links use
  `window.location`; stream/artwork URLs are built from env-driven `API_BASE`
  (no hardcoded hosts/ports); no `NEXT_PUBLIC_*` secret introduced.
- **Secrets:** none committed (`.env`, keys, tokens) — verified via diff scan.
