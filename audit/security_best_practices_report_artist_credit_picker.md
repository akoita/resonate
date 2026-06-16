# Security Best Practices Report — Artist Credit Picker (Duplicate Guard)

Scope: the artist search/typeahead slice on branch `claude/gifted-neumann-2467fe`.
Reviewed changed files only.

Changed surface:

- `backend/src/modules/artist/artist.controller.ts` (`GET /artists/search`)
- `backend/src/modules/artist/artist.service.ts` (`searchByName`)
- `web/src/lib/api.ts` (`searchArtists`)
- `web/src/components/ui/ArtistAutocomplete.tsx`
- `web/src/app/artist/upload/page.tsx`, `web/src/app/globals.css` (wiring + styles)

## Executive Summary

No Critical, High, Medium, or Low findings. The new endpoint is JWT-guarded,
uses parameterized Prisma queries (no raw SQL), returns only public-facing
fields, and bounds result size. The frontend adds no XSS sinks and exposes no
secrets.

## Findings

None.

## Checks Performed

| Check | Result |
| --- | --- |
| AuthZ on new route | `GET /artists/search` carries `@UseGuards(AuthGuard("jwt"))`; route declared before `@Get(":id")` so it is matched literally, not as an id (covered by HTTP contract test). |
| SQL/NoSQL injection | Query uses `prisma.artist.findMany({ where: { displayName: { contains, mode: "insensitive" } } })` — parameterized; no `$queryRaw`/`$executeRaw`/string-built SQL. |
| Sensitive data exposure | `select` is an explicit allowlist: `id, displayName, imageUrl, profileType, claimStatus`. No `userId`, `payoutAddress`, `email`, `socialLinks`, or other private fields. All returned fields are already public via the catalog. |
| Enumeration / DoS | Requires auth; `limit` clamped to `[1, 25]`; DB `take` bounded to `limit * 4`; empty/whitespace query returns `[]` (no full-table scan/dump). |
| Input validation | `q`/`limit` parsed defensively (`Number.parseInt` + `Number.isFinite`, trimmed query); no unvalidated passthrough to dynamic execution. |
| ReDoS | No regex applied to user input on the backend. |
| Deserialization / eval | No `JSON.parse`/`eval`/dynamic exec in changed backend files. |
| Frontend XSS | No `dangerouslySetInnerHTML`/`innerHTML`; artist names rendered as text; `imageUrl` used only as `<img src>`. |
| Secret hygiene | No hardcoded secrets; no `NEXT_PUBLIC_*SECRET/KEY/PASSWORD`; API base from existing `API_BASE` helper. |
| Fail-safe client | `searchArtists` swallows errors and returns `[]`, so a failed/unauthorized lookup degrades to a plain text input rather than leaking error detail.

## Notes

- Pre-existing `GET /artists/:id` (public profile read) remains unguarded by
  design and is out of scope for this change.
