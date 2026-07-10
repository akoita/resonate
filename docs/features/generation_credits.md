---
title: "Generation Credits (Meter)"
status: partial
owner: "@akoita"
---

# Generation Credits (Meter)

## Status

`partial` — the meter (debit, zero-balance block, refund, analytics) is live on
staging. New accounts get a one-time free **starter allowance** so they can try
generation before the meter charges; beyond that, credits enter via the
operator/promo grant path (endpoint or `make grant-credits`). **Live fiat
top-up (Stripe) is the deferred production flip** and is intentionally out of
scope for this slice. Revenue line: **(2) Artist Pro + generation credits**;
phase per ADR-BM-6. Tracked by [#1334](https://github.com/akoita/resonate/issues/1334).

## Audience

- **Artists** — every AI generation (Lyria track generation and prompted Remix
  Studio drafts) now spends a prepaid credit balance; a new account is
  auto-seeded a free starter allowance on first use, and a zero balance blocks
  the generation with a clear message.
- **Operators / admins** — seed a user's meter via the grant endpoint or the
  `make grant-credits` one-command target (staging promo/allowance path), and
  set the per-signup starter allowance.
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
- Starter allowance: **`GENERATION_CREDITS_SIGNUP_STARTER_CENTS`** (default `0` =
  disabled; staging `100` = $1.00 ≈ 5 min of generation). A one-time free tier
  provisioned per account on first use — a customer-acquisition cost, **not** a
  subsidy of any fan→artist payout (ADR-BM-4 red lines untouched).
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
- **Starter is idempotent per account.** `ensureSignupStarter` runs on the first
  balance read (Create page load) and before the first-ever debit. It is
  at-most-once via the account row's primary key — the account is *created*
  already carrying the starter, so an account that already exists (starter
  given, operator-funded, or funded-then-spent) is never re-granted. It never
  throws into a balance read or a generation.
- **Debit points.**
  1. Lyria — `GenerationService.createGeneration` debits before enqueue and
     refunds if the enqueue throws. The `GenerationProcessor` refunds on the
     final (terminal) failed attempt only, so a transient retry keeps the charge.
  2. Remix — `RemixProjectService.processGenerationJob` debits before the AI
     render (prompted modes only; `stem_mix` is pure DSP and free) and refunds
     in the failure path.

## Onboarding starter allowance (staging)

New accounts are provisioned a one-time free starter the first time they touch
the meter (balance read or first generation), controlled by
`GENERATION_CREDITS_SIGNUP_STARTER_CENTS` (staging `100`). No operator action is
needed for a user to try generation — the wall only appears once the free tier
is spent. Set the var to `0` to disable and fall back to operator-grant-only.

## Operator Grant Path (staging)

Beyond the starter, credits enter through the operator/promo grant path — the
only way to add credits until live top-up ships. Two equivalent routes:

```http
POST /credits/grant            # @Roles('admin','operator')
{ "userId": "...", "amountCents": 500, "reason": "promo_grant" }
```

```bash
# One-command operator top-up against whatever DATABASE_URL is in the env.
# AMOUNT is USD cents (100 = $1.00). REASON is optional.
make grant-credits USER=<userId> AMOUNT=<cents> [REASON=<text>]
```

The `make grant-credits` path writes straight to the ledger (no operator JWT
needed) but, run standalone, does not emit a `generation.credits_granted`
analytics event — use the API endpoint when the grant must show in analytics.

## Request a Top-up (staging)

Rather than dead-ending a user at the 0-credit wall, the out-of-credits screen
offers **Request credits from an operator**. `POST /credits/request` (JWT)
publishes a `generation.credits_requested` domain event; `NotificationService`
fans it out to the configured operator/admin wallets (`OPERATOR_ADDRESSES` +
`ADMIN_ADDRESSES`) as in-app notifications (the same `NotificationBell`
operators already use), coalescing repeat requests from the same user within a
10-minute window. Each notification carries the requester and a ready-to-run
`make grant-credits USER=<id> AMOUNT=<cents>` hint. Delivery is in-app only for
now; email/Slack fan-out is a future enhancement.

## Surfaces

- API:
  - `GET /credits/balance` (JWT) — caller's `balanceCents`, `priceCentsPer30s`,
    and recent ledger entries.
  - `POST /credits/request` (JWT) — ask an operator for a top-up (fans out to
    operator notifications).
  - `POST /credits/grant` (JWT + `@Roles('admin','operator')`).
- UI: a **reusable `CreditBalanceMeter`**
  ([`web/src/components/credits/CreditBalanceMeter.tsx`](web/src/components/credits/CreditBalanceMeter.tsx),
  #1422) shows remaining capacity as time + 1-min tracks (e.g. "≈ 5 min · 5
  tracks") plus an empty/low "request a top-up" affordance. It is surfaced on
  the **Create** page (strip variant, replacing the old one-off cell) and in
  **Remix Studio** (panel variant) — closing the parity gap where remix debits
  credits but showed no balance. Capacity math is the shared
  [`formatCreditCapacity`](web/src/lib/credits.ts) util; the endpoint returns
  `priceCentsPer30s` so the client never hardcodes the price. Because the remix
  debit happens in a worker (no synchronous 402), the studio fetches the balance
  directly and gates Generate proactively when it can't fund one 30s block.
- Service: `backend/src/modules/credits/generation-credits.service.ts`
  (`GenerationCreditsService`: `costForDurationCents`, `getBalance`, `grant`,
  `debit`, `refund`, `ensureSignupStarter`; `InsufficientCreditsException`).
- Module: `backend/src/modules/credits/credits.module.ts` (imported by the
  generation and remix modules).
- Operator CLI: `backend/src/scripts/grant_credits.ts` (`npm run credits:grant`),
  wrapped by the `grant-credits` Makefile target.
- Env vars: `GENERATION_PRICE_CENTS_PER_30S` (default `10`),
  `GENERATION_CREDITS_SIGNUP_STARTER_CENTS` (default `0`; staging `100`).
- Data model: `GenerationCreditAccount`, `GenerationCreditTransaction`
  (migration `20260707120337_generation_credit_ledger`).
- Analytics events (personal tier): `generation.credits_debited`,
  `generation.credits_insufficient`, `generation.credits_granted`,
  `generation.credits_requested`.

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
- **Usage & Billing consolidation (#1422)** — shipped across two slices: (1) the
  reusable `CreditBalanceMeter` + Remix Studio parity; (2) a metered-action
  registry (`backend/src/modules/credits/metered-actions.ts`), a unified
  **`GET /usage/summary`** (`UsageModule`/`UsageService`) aggregating credits +
  per-kind usage-limits (the remix rate-limit is now queryable via a
  side-effect-free peek getter) + plan tier, and a read-only **Usage & Billing**
  settings section (`UsageBillingPanel`: plan, credits, limits with reset timers,
  ledger/history). Design of record: [`docs/rfc/usage-billing.md`](../rfc/usage-billing.md).
  Still deferred: live Stripe buy/auto-reload (blocked on #1421 pricing + #1193).

## Links

- Usage & Billing design: [`docs/rfc/usage-billing.md`](../rfc/usage-billing.md) (#1422)
- RFC / canonical price: `docs/rfc/business-model.md` (ADR-BM-3)
- Decisions: `docs/strategy/business-model-phase0-decisions.md` §ADR-BM-3
- Issue: [#1334](https://github.com/akoita/resonate/issues/1334)
- Related feature: [AI Music Generation](ai_music_generation.md),
  [Remix Studio](remix_studio.md)
