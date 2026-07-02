# Security Best Practices Report — Remix full-session hydration (#1312)

_Scope: the diff on `feat/1312-remix-full-session-hydration` vs `origin/main` —
creation hydration, `availableStems` on draft reads, and `PATCH addStemIds` in
the remix module, plus the studio panel frontend._

## Executive Summary

No Critical, High, or Medium findings. The change adds owner-scoped read data
and one owner-scoped mutation, both gated by the existing explainable
eligibility policy. No new endpoints, no auth changes, no secrets, no raw SQL
introduced (the module's pre-existing `$executeRaw` job-claim from #1167 is
tagged-template parameterized and untouched by this diff).

## Checks performed

| Check | Result |
| --- | --- |
| Hardcoded secrets | None |
| Raw/unparameterized SQL in the diff | None added; all new access via Prisma query builder |
| Unsafe deserialization (`eval`/`JSON.parse`) | None added |
| AuthZ | Unchanged: all project routes JWT-guarded; `loadOwnedProject` enforces ownership on read and PATCH; published projects stay locked (409) |
| Rights policy | Hydrated stems must satisfy the strict per-stem rule (licensed + not minted non-remixable), so worker-time and publish-time re-checks still pass; `addStemIds` re-runs `checkEligibility` with explicit-selection semantics and returns 403 with the eligibility payload on denial |
| Data exposure | `availableStems` returns catalog stem `type`/`title`, minted `tokenId` (already public via marketplace/metadata surfaces), per-mint `remixable`, and the **caller's own** license state — owner-scoped, no other user's data |
| Injection surface | `addStemIds` values are validated (non-empty strings), deduped, membership-checked, and only used inside Prisma parameterized queries |
| Analytics contract | `remix.project_created` payload unchanged (explicit selection only) — no new fields into the governed bridge |

## Findings

### Informational

- **SBPR-I1 — Hydration is fail-closed for rights, fail-open for UX.** The
  track-default eligibility used for hydration/availability is wrapped in
  try/catch returning `[]`: a lookup failure degrades to the pre-#1312 behavior
  (no auto-added stems, no panel) and can never widen access, because additions
  and generation always re-run their own strict checks.
- **SBPR-I2 — No new rate-limit surface.** `PATCH /remix/projects/:id` was not
  rate-limited before and gains only an eligibility-checked insert; creation
  hydration rides the existing `REMIX_PROJECT_RATE_LIMIT`. Generation limits
  unchanged.
- **SBPR-I3 — BigInt serialization.** `StemNftMint.tokenId` is stringified
  before JSON serialization (`tokenId.toString()`), avoiding BigInt JSON
  errors.

## Conclusion

No fixes required. The slice strictly narrows what hydration may add (subset of
what the caller could already select explicitly) and exposes only
already-public catalog/mint data plus the caller's own license state.
