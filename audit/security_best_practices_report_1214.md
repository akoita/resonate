# Security Best Practices Report: Issue #1214

## Executive Summary

Issue #1214 adds a server-side **decrypt-for-render boundary** so encrypted
source stems can be decrypted in memory for remix rendering (deterministic
`stem_mix`, `stem_plus_ai` layered, and audio-conditioned provider input). The
scoped review found **no Critical, High, or Medium findings** newly introduced
by this branch. The boundary is fail-closed and the authorization/crypto data
flow holds up under review.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

### SBPR-1214-L1: Pre-render audit event fidelity

**File:** `backend/src/modules/remix/remix-project.service.ts` (~L760)
**Impact:** `remix.encrypted_render_authorized` is emitted before the render
completes, so a later decrypt/ffmpeg failure leaves an "authorized" event with
no successful decryption. No data exposure or authorization impact — audit
fidelity only.
**Recommendation:** Treat the event as "decryption authorized" (its current
semantics) and/or pair it with the existing failure path for reconciliation.
Optional; see the deferred follow-up noted on the PR.

### SBPR-1214-L2: Best-effort temp cleanup

**File:** `backend/src/modules/remix/stem-audio-mixer.ts` (~L280)
**Impact:** Decrypted plaintext lives only in a per-render `mkdtemp` dir removed
in a `finally` block; an `rm` failure would leave plaintext on the instance's
ephemeral local disk. Resolved in this branch by logging cleanup failures so the
condition is observable.
**Recommendation:** Already addressed (cleanup failures are now logged instead
of silently swallowed).

## Scope Reviewed

- `backend/src/modules/encryption/encryption.service.ts`
  (`decryptForRender`, `RenderDecryptionError`)
- `backend/src/modules/encryption/providers/aes_encryption_provider.ts`
  (`remix-render-authorized` internal purpose)
- `backend/src/modules/remix/stem-audio-mixer.ts`
  (decrypt boundary, `loadStemAudio`, error mapping, temp cleanup)
- `backend/src/modules/remix/remix-project.service.ts`
  (worker-time eligibility re-check, render authorization, audit events,
  error normalization)
- `backend/src/modules/remix/{remix-stem-mix.renderer,remix-layered-renderer,`
  `audio-conditioned-remix-generation.provider,lyria-remix-generation.provider,`
  `remix-generation.provider,remix.module}.ts`
- `backend/src/events/event_types.ts`

## Checks

- **Hardcoded secret scan** over changed files — only comments and env-var reads
  (`ENCRYPTION_SECRET`/`JWT_SECRET`/`INTERNAL_SERVICE_KEY`); no hardcoded secrets.
- **Raw SQL scan** — the only `$executeRaw` matches are the pre-existing,
  parameterized tagged-template claim logic; no new raw SQL and no string
  interpolation of untrusted input.
- **Unsafe deserialization scan** — new `JSON.parse` calls operate on
  DB-sourced `encryptionMetadata` (not request input) and are guarded by
  try/catch that fails closed to `invalid_metadata`. No `eval`.
- **Command-execution scan** — ffmpeg is invoked via `execFile` with an args
  array (no shell); temp paths derive from internal indices, not stem-controlled
  strings. No command injection or path traversal.
- **Authorization review** — worker re-derives ownership (`loadOwnedProject`)
  and re-runs `checkEligibility` (explicit selection → all stems must be
  licensed/remixable) before any decrypt; `authorizedStemIds` gate in the mixer;
  the AES `remix-render-authorized` bypass strictly requires
  `INTERNAL_SERVICE_KEY` with no non-production fallback (fails closed).
- **Data-exposure review** — plaintext never written to the on-disk decrypted
  cache, never uploaded, never logged; error reasons are opaque; audit events
  carry only IDs/counts/coarse reason.

No Critical/High/Medium issues are newly introduced by this branch. Pre-existing
patterns surfaced by the scans (dev-only JWT fallback, parameterized Prisma raw
SQL) are outside this change.
