---
title: "Generation Credits (Meter)"
status: partial
owner: "@akoita"
---

# Generation Credits (Meter)

## Status

`partial` — the meter (debit, zero-balance block, refund, analytics) is live on
staging. Credits enter only via the operator/promo grant path; **live fiat
top-up (Stripe) is the deferred production flip** and is intentionally out of
scope for this slice. Revenue line: **(2) Artist Pro + generation credits**;
phase per ADR-BM-6. Tracked by [#1334](https://github.com/akoita/resonate/issues/1334).

## Audience

- **Artists** — every AI generation (Lyria track generation and prompted Remix
  Studio drafts) now spends a prepaid credit balance; a zero balance blocks the
  generation with a clear message.
- **Operators / admins** — seed a user's meter via the grant endpoint (staging
  promo/allowance path).
- **Backend developers / agents** — `GenerationCreditsService` is the single
  place that prices, debits, and refunds AI generation.

## Value

Turns AI generation into a metered capability so GPU-expensive paths gate on a
prepaid balance instead of being unmetered. Credits are a **cost+margin tool
charge**, entirely separate from the fan→artist transaction split — the 85%+
artist share (ADR-BM-4) is untouched. Building the meter now is license-safe:
the #1193 SA3 commercial-use license blocker gates *charging money*, not the
internal meter.

## Economic Model

- Credits are denominated in **USD cents** (integer money — never float), owned
  **per user** (the generating artist).
- Price: **`GENERATION_PRICE_CENTS_PER_30S`** (default `10` = $0.10/30s). Internal
  cost baseline is ~6¢/30s (`generation.service.ts COST_PER_30_SECONDS = 0.06`,
  left unchanged) → ~40% margin.
- Cost of a generation = `ceil((durationSeconds / 30) × priceCents)` cents.
- Canonical price source: `docs/rfc/business-model.md` (ADR-BM-3).

## How It Works

- **Ledger.** `GenerationCreditAccount` (`userId`, `balanceCents`) caches the
  balance; the append-only `GenerationCreditTransaction` ledger
  (`type` grant|debit|refund, `amountCents`, `reason`, `jobId?`,
  `balanceAfterCents`) is the audit source of truth.
- **Debit is race-safe.** A single atomic conditional `updateMany` guarded by
  `balanceCents >= amount` decrements and asserts exactly one row changed;
  concurrent debits that together exceed the balance cannot oversell (the loser
  throws `InsufficientCreditsException` → HTTP 402 Payment Required).
- **Refunds are idempotent per `jobId`.** A second refund for the same job is a
  no-op, so a retry or re-delivery can never inflate the balance.
- **Debit points.**
  1. Lyria — `GenerationService.createGeneration` debits before enqueue and
     refunds if the enqueue throws. The `GenerationProcessor` refunds on the
     final (terminal) failed attempt only, so a transient retry keeps the charge.
  2. Remix — `RemixProjectService.processGenerationJob` debits before the AI
     render (prompted modes only; `stem_mix` is pure DSP and free) and refunds
     in the failure path.

## Operator Grant Path (staging)

Credits enter only through the operator/promo grant endpoint. This is the only
way to add credits until live top-up ships.

```http
POST /credits/grant            # @Roles('admin','operator')
{ "userId": "...", "amountCents": 500, "reason": "promo_grant" }
```

## Surfaces

- API:
  - `GET /credits/balance` (JWT) — caller's balance + recent ledger entries.
  - `POST /credits/grant` (JWT + `@Roles('admin','operator')`).
- Service: `backend/src/modules/credits/generation-credits.service.ts`
  (`GenerationCreditsService`: `costForDurationCents`, `getBalance`, `grant`,
  `debit`, `refund`; `InsufficientCreditsException`).
- Module: `backend/src/modules/credits/credits.module.ts` (imported by the
  generation and remix modules).
- Env var: `GENERATION_PRICE_CENTS_PER_30S` (default `10`).
- Data model: `GenerationCreditAccount`, `GenerationCreditTransaction`
  (migration `20260707120337_generation_credit_ledger`).
- Analytics events (personal tier): `generation.credits_debited`,
  `generation.credits_insufficient`, `generation.credits_granted`.

## Verification

- Controller (unit): `cd backend && npx jest --config jest.config.js --testPathPattern='credits.controller'`
- Analytics taxonomy: `cd backend && npx jest --config jest.config.js --testPathPattern='analytics'`
- Meter (integration): `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='credits.integration'`
- Generation/remix gating (integration): `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='credits-generation-block|credits-remix-block'`

## Remaining / Deferred

- **Live fiat top-up (Stripe)** — the production flip; gated on the SA3
  commercial-use license review (#1193). No live money changes hands in this
  slice.
- Artist Pro monthly credit allowance bundling (ADR-BM-3) is future work.
- A listener/artist-facing balance UI is not part of this slice.

## Links

- RFC / canonical price: `docs/rfc/business-model.md` (ADR-BM-3)
- Decisions: `docs/strategy/business-model-phase0-decisions.md` §ADR-BM-3
- Issue: [#1334](https://github.com/akoita/resonate/issues/1334)
- Related feature: [AI Music Generation](ai_music_generation.md),
  [Remix Studio](remix_studio.md)
