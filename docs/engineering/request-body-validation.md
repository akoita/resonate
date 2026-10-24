# Request body validation (#1888, #1890, #2197)

## Decision

- The global `ValidationPipe` (`backend/src/config/validation.ts`) enforces
  class-validator decorators on **class** DTOs only. `whitelist` and `transform`
  stay off globally (#1890): a body that passes is handed to the handler as the
  original request object, with unknown fields kept and values not coerced.
- A body typed as an interface, type alias, inline type, intersection, `any` or
  `unknown` compiles to `Object` and is **not** validated by the pipe.
- Bodies move to class DTOs one module at a time where the service does not
  type-check every field. DTOs check **types only** (value rules, ownership and
  state checks stay in the services) and must reject nothing the service already
  accepts. The `@Body()` type must be the class itself.
- Where a handler or service already checks presence and answers with its own
  message, the DTO field is `@IsOptional()` plus a type check, so that answer is
  unchanged. Fields the service coerces on purpose (`BigInt()`, `Math.max()`,
  `typeof ... ? : ignore`) stay undecorated.
- A route that authenticates (or gates) inside the handler validates its body
  inline after that check, because a DTO would answer `400` before the caller is
  authenticated.

## Guard

`backend/src/tests/body_dto_guard.spec.ts` scans every `*.controller.ts` by
reflection and fails when a whole-body `@Body()` parameter is not a class and is
not listed in its allowlist with a category and a reason. The `deferred-admin` category is gone: no admin body is deferred any more. A stale allowlist
entry fails too. `@Body("field")` (a single value) is not a whole body and is not
flagged. HTTP cases for the converted routes are in
`backend/src/tests/request_body_validation.controller.http.spec.ts`; the admin
bodies converted in #2362 are covered in `maintenance.controller.http.spec.ts`,
`notice.controller.http.spec.ts` and `x402-refund-reconciliation.controller.http.spec.ts`.

## Inventory (#2197 audit)

Counts are `@Body()` parameters across `backend/src/modules/**` that were not
class-typed before this change. "Converted" routes now take a class DTO.

| Module | Routes | Decision |
| --- | --- | --- |
| library | save track, save tracks, delete tracks (3) | Converted (`library.dto.ts`) |
| playlist | save playlist, create/rename folder (were `@Body("name")`), create/update playlist (5) | Converted (`playlist.dto.ts`) |
| curation | stake, report (2) | Converted (`curation.dto.ts`) |
| auth | `nonce`, `verify` (2) | Converted (`auth.dto.ts`) |
| auth | `login` (1) | Inline: dev-only route gated by `AUTH_DEV_LOGIN_ENABLED`, body checked after the 403 |
| webauthn | register/login options and verify (4) | Converted (`webauthn.dto.ts`) |
| encryption | decrypt, download (2) | Converted; handler-checked presence kept (`encryption.dto.ts`) |
| privacy | account closure (1) | Converted (`privacy.dto.ts`) |
| ingestion | upload (1) | Converted (`ingestion.dto.ts`); `metadata` left to the service |
| ingestion | progress (1) | Inline: internal-key check first |
| ingestion | enqueue (1) | Already validated in service (deprecated route) |
| fingerprint | receive fingerprint (1) | Inline: internal-key check first |
| agent runtime worker | execute (1) | Inline: internal-key check first, then full normalization |
| stem pricing | upsert, batch, batch-upsert (3) | Converted (`stem-pricing.dto.ts`) |
| catalog | create release, update release (2) | Converted (`release.dto.ts`) |
| catalog | credit identity review, track metadata, withdraw (3) | Already validated in service |
| artist | create profile (1) | Converted (`artist.dto.ts`) |
| artist | settings, profile, enrichment suggestions, claim, review (5) | Already validated in service (`unknown` fields) |
| agents config | create, update, record signal, start session (4) | Converted (`agent_config.dto.ts`); sanitized fields left undecorated |
| agents | run, orchestrate, evaluate, runtime (4, admin role) | Converted (`agents.dto.ts`) |
| agents | reputation feedback (1) | Already validated in handler |
| recommendations | set preferences (1) | Converted (`preferences.dto.ts`) |
| recommendations | taste memory settings, signal control (2) | Already validated in service |
| remix | legacy create (1) | Converted (`remix-legacy.dto.ts`) |
| remix | generate draft (1) | Already validated (constraints validator, service) |
| generation | artwork prompt (1) | Converted (`generation.dto.ts`) |
| wallet | fund, budget, provider, refresh, paymaster, reset paymaster, session key, validate, guardians, recovery x2, agent enable/activate/disable/rotate/purchase (16) | Converted (`wallet.dto.ts`); `BigInt()` fields of agent purchase left undecorated |
| contracts (mint) | batch authorizations (1) | Converted (`mint-authorization.dto.ts`) |
| contracts (mint, voucher) | single authorization, attestation voucher (2) | Already validated in service (parsers accept strings or numbers) |
| contracts (metadata) | notification preferences, curator verification, dispute evidence, jury escalate/vote, trusted-source request/review/revoke, release-rights request/review, rights reassessment create/review (12) | Converted (`metadata.dto.ts`) |
| contracts (metadata) | file dispute, evidence bundle, resolve dispute, audit sample, indexer reset/reindex, notify listing (7) | Already validated in handler; chain ids and amounts are coerced |
| analytics | ingest, playback completed/event, product event, consent (5) | Already validated in controller/service normalizers |
| community | profile, benefit rule, Discord connect/role mapping, message, report, moderate, room status (8) | Already validated in service (`unknown` fields) |
| dmca | file report, file counter, resolve (3) | Already validated in service |
| management | grants, transfers, recoveries (5) | Already validated in service |
| punchline | update draft, add/update moment, set unlock, collect (5) | Already validated in service |
| sessions | playback capability, device, resolve, queue, play, control, confirm (7) | Already validated in controller (sanitizers) |
| shows | 21 lifecycle and pledge routes (`any`) | Already validated in service normalizers; per-route DTOs tracked as a follow-up |
| maintenance (`/admin/*`) | stem and embedding backfills, erasure run-due, warehouse load and backfill, cohort generation, moderation resolve (7) | Converted (`maintenance.dto.ts`, #2362); types only, so `limit: "25"` and similar strings now answer 400. `erasure/run-due` still takes a numeric string, as its service does |
| x402 refund reconciliation (`/admin/x402-refunds`) | mark refunded (1) | Converted (`x402-refund-reconciliation.dto.ts`, #2362); the service still owns the hash message |
| notices | broadcast, targeted (2) | Converted (`notice.dto.ts`, #2362); types and shape only, `notice_validation` still owns the value rules and its messages |

Every "already validated" and "inline" row is an entry in the guard's allowlist
with its reason. New routes should not need one: use a class DTO.
