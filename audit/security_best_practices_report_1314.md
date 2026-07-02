# Security Best Practices Report — Remix section-grid arrangement (#1314)

_Scope: the diff on `feat/1314-remix-section-grid` vs `origin/main` — the
arrangement module, mixer gating, PATCH validation, `sectionGrid` on reads, and
the studio grid/preview frontend._

## Executive Summary

No Critical, High, or Medium findings. The slice adds no endpoints and no auth
changes. The security-relevant surface is user-influenced data reaching an
ffmpeg command; it is constrained to booleans and derived numerics.

## Checks performed

| Check | Result |
| --- | --- |
| Command injection via the gate expression | Not possible: masks are validated `boolean[]` only; intervals derive from server-measured numeric features clamped/rounded in `remix-arrangement.ts`; the generated expression contains digits, operators, `t`, `min`/`max`, parens, and escaped commas — never user strings. Args pass via `execFile` array (no shell), matching the existing mixer posture |
| Input validation | `PATCH` arrangements validated against the server-derived grid (schema version, boolean array, exact section count); wrong shapes/lengths → 400; `null` resets via `Prisma.DbNull` (no raw JS null into a Json column) |
| AuthZ | Unchanged — owner-scoped PATCH/read; published projects stay locked; the render worker's eligibility re-check and encrypted-stem authorization boundary (#1214) are untouched (gating applies after `loadStemAudio`) |
| Data exposure | `sectionGrid` derives from already-served `audioFeatures`; no new data classes |
| Fail-open semantics | Stale masks (features re-measured) fail open to fully-active — a rights-neutral outcome; all-off masks are treated as muted and can never force a render of nothing |
| Hardcoded secrets / raw SQL / eval | None added |

## Findings

None. Informational: the render path for untouched arrangements is
byte-identical to pre-#1314 (no gate filter is inserted), keeping old drafts
reproducible under the same `remix-render-policy/v1`.
