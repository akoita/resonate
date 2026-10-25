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
operator/promo grant path (endpoint or `make grant-credits`) and, since #1422
(Artist Pro slice 4), **credit packs bought through Stripe Checkout in test
mode** ($5, $10 default, $25; see [Buying credit packs](#buying-credit-packs-1422)).
**Live charging stays off** until the Artist Pro RFC §8 gates clear. Revenue line: **(2) Artist Pro + generation credits**;
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
  (`type` grant|debit|refund|reversal, `amountCents`, `reason`, `jobId?`,
  `paymentRef?`, `balanceAfterCents`) is the audit source of truth. `reversal`
  (#1422) takes back refunded bought credits; `paymentRef` names the Stripe
  payment intent of a `top_up` grant or its reversal.
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
     The terminal check counts the attempt that is currently failing
     (`attemptsMade + 1`): BullMQ v5 increments `attemptsMade` only *after* a
     job completes or fails, so comparing it directly against the limit is
     never true inside the processor. That was live from #1334 until #1778 —
     no terminally failed Lyria generation refunded during that window, and
     `backend/scripts/find-unrefunded-generation-debits.sql` finds the debits
     it left behind. The reconciliation command defaults to dry-run, separates
     database-proven successful generations, and requires each remaining job
     ID to be independently confirmed as a terminal failure before `--apply`.
     It refuses ambiguous or successful jobs and refunds through the idempotent
     service method rather than a generic grant or direct SQL mutation.
     A refund that itself fails stays best-effort (it must not mask the job
     error) but now emits `generation.credit_refund_failed` through
     `writeStructuredLog`, so it is alertable rather than lost in a log line.
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

Beyond the starter, credits enter through the operator/promo grant path or a
bought credit pack (#1422, Stripe test mode). Two equivalent operator routes:

```http
POST /credits/grant            # @Roles('admin','operator'), @RequireStepUp()
{ "userId": "...", "amountCents": 500, "reason": "promo_grant" }
```

Both HTTP grants (this one and `POST /credits/requests/:id/grant`) need a fresh
admin step-up proof in `X-Admin-Step-Up` and are recorded in the admin audit log
(`credits.granted`, `credit_request.granted`; amount and recipient only, never the
reason text) — see [admin step-up and audit](admin_step_up_audit.md) (#2362).
`make grant-credits` writes through the service directly and is not a route.

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
records a **credit request** (#1885) in `GenerationCreditRequest`. Each user
has at most one pending request; a repeat request refreshes that one's
timestamp and note instead of adding a new row. The endpoint then publishes a
`generation.credits_requested` domain event. `NotificationService` fans it out
to the configured operator/admin wallets (`OPERATOR_ADDRESSES` +
`ADMIN_ADDRESSES`) as in-app notifications, coalescing repeats from the same
user within a 10-minute window. The notification links to the operator queue.

**Operator queue** (`/admin/credit-requests`, admin/operator roles, linked from
the sidebar and from the notification):
- The Pending tab lists each request with its note, when it was sent, and the
  requester's current balance. Operators can grant a quick amount ($1 / $5 /
  $10) or a custom one, with an optional reason, or dismiss the request with
  an optional note.
- A grant is atomic. The request is claimed (only a pending request can be
  resolved, once) and the ledger `grant` row is written in one transaction, so
  two operators can never both grant the same request; the second gets
  `409 request_not_pending`.
- The Resolved tab shows granted and dismissed requests with who resolved them
  and when.
- Every grant, whether from the queue, the API or the CLI, sends the requester
  an in-app "Generation credits added" notification.

Delivery is in-app only for now; email/Slack fan-out is a future enhancement.

## Usage & Billing surface (#1422, Sprint 40)

**Revenue line:** ADR-BM-6 Line 2 (creator tools / metered generation), Phase 2
groundwork. **Nothing is charged**: no prices change, and there is no buy,
auto-reload or Stripe flow (those wait for the pricing decision in #1421 and the
license review in #1193).

One read, `GET /usage/summary` (JWT, always scoped to the caller), returns three
deliberately separate sections plus the plan tier:

- `credits` -- the prepaid balance, price per 30 s and recent ledger rows
  (same shape as `GET /credits/balance`).
- `limits` -- fair-use rate-quota windows per kind: `remaining`, `limit`,
  `percentLeft`, `windowSeconds`, `resetsAt`. Hitting one means waiting for the
  reset; it is never solved by topping up.
- `breakdown` -- credit spend per metered kind over the last 30 days: unit size
  and live unit cost, number of charges, spent, refunded and net cents. A kind
  can be split into registry `lines` by ledger reason (#1933): `remix_draft`
  shows "AI remix draft" and "AI part takes" (reason `remix_part`) as separate
  rows (`kind` + `lineId`). It is presentation only: the lines sum to the
  kind's former total, refunds follow the debit they return, and the price is
  unchanged.

**Metered-action registry**
([`backend/src/modules/credits/metered-actions.ts`](../../backend/src/modules/credits/metered-actions.ts))
is the single source of truth: kind, label, debit-ledger reasons, unit size and
default duration, and an optional usage-limit window (`limit`, `windowMs`, env
key). It is read by the enforcers, not mirrored from them: the catalog and remix
rate limiters take their default, window and env override from it
(`STRIKE_RATE_LIMIT` 50/hr, `REMIX_GENERATION_RATE_LIMIT` 10/hr), the debit
sites take their ledger `reason` from it, and the usage breakdown attributes
ledger rows to kinds with it. The credit **price** is not duplicated: a unit
cost is always `unitCostCents(kind, livePrice)`, the same formula as
`costForDurationCents`, and `metered-actions.spec.ts` pins that parity (and the
50/10 defaults and the enforcing services' use of the registry). Adding a metered
feature means adding a registry entry.

**UI.** Settings -> Usage & Billing (`UsageBillingPanel`) shows plan, credits
(with a short "how credits are granted today" note and no purchase or
auto-reload control), usage limits, spend by action and the recent ledger.
`CreditBalanceMeter` (credits) and `UsageLimitMeter` (one limit window: % left,
count, reset time) are the reusable meters; Remix Studio shows both next to
Generate, and Create shows the credit meter plus its rate-limit cell.

**How credits are added:** the one-time starter allowance, operator grants
(including the in-app request queue), automatic refunds for failed
generations, and (#1422) credit packs bought in Usage & Billing where the
server has Stripe set up. The panel's note says so; the Buy credits block sits
under the balance.

## Buying credit packs (#1422)

**Revenue line:** ADR-BM-6 line 2 (creator tools, metered generation), Phase 2,
in Stripe **test mode** only. Credits are a cost-plus-margin tool balance; no
fan→artist payout is touched (ADR-BM-4).

- **Packs:** $5 (the minimum), $10 (the default) and $25, from the server
  catalogue (`billing/credit_packs.ts`); a pack buys credits equal to its price
  before tax. The client sends a pack id, never an amount.
- **Consent first:** the `credit_topup` delivery choice (#1776) is recorded
  before the Stripe Checkout Session exists. "Deliver now" credits the balance
  as soon as the payment is confirmed and gives up withdrawal for the credits
  used; "Wait 14 days" holds them.
- **Ledger:** a `grant` row with reason `top_up` and the payment intent id in
  `paymentRef`, written exactly once per Checkout Session (`CreditTopUp`,
  unique session and payment intent ids).
- **Held credits** are released lazily: `getBalance` and `debit` (and
  `GET /billing/credits`) credit every purchase whose 14 days have passed
  (`credits/top_up_ledger.ts`, a conditional claim, so concurrent reads credit
  it once), or immediately when the buyer asks for delivery now.
- **Refunds** (`charge.refunded`) withdraw the refunded share with a
  `reversal` row (reason `top_up_refund`), never below a zero balance; spent
  credits stay spent. A refunded held purchase releases less, or nothing.
- **Expiry:** none. The RFC promises at least 24 months; the balance has no
  per-purchase lots, so no expiry date is recorded.

Details (routes, webhook, configuration, data):
[`artist_pro_billing.md`](artist_pro_billing.md#credit-packs-1422).

## Surfaces

- API:
  - `GET /credits/balance` (JWT) — caller's `balanceCents`, `priceCentsPer30s`,
    and recent ledger entries.
  - `GET /usage/summary` (JWT) — credits + usage limits + 30-day spend
    breakdown + plan tier, caller-scoped (#1422).
  - `POST /credits/request` (JWT) — ask an operator for a top-up (fans out to
    operator notifications).
  - `POST /credits/grant` (JWT + `@Roles('admin','operator')`).
  - `GET /credits/requests?status=pending|resolved|all`,
    `POST /credits/requests/:id/grant` (`{ amountCents, reason? }`) and
    `POST /credits/requests/:id/dismiss` (`{ note? }`), all JWT +
    `@Roles('admin','operator')` (#1885). Resolving a request that is no longer
    pending returns `409 request_not_pending`.
  - Bodies are validated by the backend-wide `ValidationPipe` (#1888):
    `amountCents` must be a JSON integer in `1..10000000` and `reason` a
    non-empty string of at most 120 characters for a direct grant (a
    queued-request grant takes the same `amountCents` bounds with an optional
    `reason`); request and dismiss `note`s are optional and at most 280
    characters. Violations return `400`.
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
- UI (usage limits): reusable
  [`UsageLimitMeter`](web/src/components/credits/UsageLimitMeter.tsx) (#1422)
  renders one usage-limit window (% left, count, reset time) and is used on the
  Usage & Billing page and in Remix Studio.
- Service: `backend/src/modules/credits/generation-credits.service.ts`
  (`GenerationCreditsService`: `costForDurationCents`, `getBalance`, `grant`,
  `debit`, `refund`, `ensureSignupStarter`; `InsufficientCreditsException`).
- Module: `backend/src/modules/credits/credits.module.ts` (imported by the
  generation and remix modules).
- Operator CLI: `backend/src/scripts/grant_credits.ts` (`npm run credits:grant`),
  wrapped by the `grant-credits` Makefile target. Historical catalog-failure
  correction uses `backend/src/scripts/reconcile_generation_refunds.ts`
  (`npm run credits:reconcile-generation-refunds`); dry-run is the default and
  `--apply` refunds only rows whose durable Postgres outcome is
  `terminal_failed`. Operator assertions, Redis state, and logs are not accepted
  as refund authority.
- Env vars: `GENERATION_PRICE_CENTS_PER_30S` (default `10`),
  `GENERATION_CREDITS_SIGNUP_STARTER_CENTS` (default `0`; staging `100`).
- Data model: `GenerationCreditAccount`, `GenerationCreditTransaction`
  (migration `20260707120337_generation_credit_ledger`) and
  `GenerationJobOutcome` (migration
  `20260920120000_generation_job_outcomes`). The outcome is created atomically
  with every catalog-generation debit, moves through `queued`/`in_flight`, and
  reaches `completed`, `terminal_failed`, or `enqueue_failed`. Completion is
  committed with its release and track IDs; terminal failure is written only
  after all worker attempts are exhausted. Failure detail is a bounded category
  and never contains prompts or provider payloads.
- Analytics events (personal tier): `generation.credits_debited`,
  `generation.credits_insufficient`, `generation.credits_granted`,
  `generation.credits_requested`.

## Verification

- Controller (unit): `cd backend && npx jest --config jest.config.js --testPathPattern='credits.controller'`
- Analytics taxonomy: `cd backend && npx jest --config jest.config.js --testPathPattern='analytics'`
- Registry + usage aggregation (pure): `cd backend && npx jest --config jest.config.js --testPathPattern='metered-actions|usage-aggregation|usage.controller'`
- Usage endpoint (integration): `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='usage-summary.integration'`
- Meter (integration): `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='credits.integration'`
- Generation/remix gating (integration): `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='credits-generation-block|credits-remix-block'`
- Credit packs: `credit_packs.spec.ts`, `credit_topup.controller.http.spec.ts`, and `cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='credit_topup.integration'`

## Remaining / Deferred

- **Live fiat top-up (Stripe)** — credit packs are built in test mode (#1422);
  live charging is gated on the Artist Pro RFC §8 gates (#1421 price
  sign-off, legal review of the wording and refund policy, #1193). Auto-reload
  and USDC top-up: #2410.
- Artist Pro monthly credit allowance bundling (ADR-BM-3) is future work.
- **Cost instrumentation (#1421)** — the flat `$0.06/30s` COGS guess is now a
  typed, env-overridable **per-path cost-model config**
  (`backend/src/modules/generation/generation-cost-model.ts`; defaults reproduce
  the old number, so the estimate is unchanged), and every generation records
  **realized cost telemetry** (`GenerationCostRecord`: path, `wallClockMs`,
  duration, estimated cost, sell price, `coldStart`) + a `generation.cost_recorded`
  event — so real cost can be reconciled against cloud billing. The **price
  itself is unchanged**; deriving a measured, reconciled per-path sell price
  needs real Lyria/GPU billing data and lands later (reconciled into
  `business-model.md` + ADR-BM-3). Design: [`docs/rfc/generation-cost-model.md`](../rfc/generation-cost-model.md).
- **Usage & Billing consolidation (#1422)** — shipped: the reusable
  `CreditBalanceMeter` and Remix Studio parity, the metered-action registry,
  `GET /usage/summary`, the Settings -> Usage & Billing page, and (Sprint 40)
  the registry as the enforcers' single source of truth, the per-kind spend
  breakdown, `percentLeft` on every limit and the `UsageLimitMeter` in Remix
  Studio. Buying credit packs shipped in Stripe test mode (#1422, Artist Pro
  slice 4); auto-reload is #2410. Design of record: [`docs/rfc/usage-billing.md`](../rfc/usage-billing.md).

## Links

- Usage & Billing design: [`docs/rfc/usage-billing.md`](../rfc/usage-billing.md) (#1422)
- RFC / canonical price: `docs/rfc/business-model.md` (ADR-BM-3)
- Decisions: `docs/strategy/business-model-phase0-decisions.md` §ADR-BM-3
- Issue: [#1334](https://github.com/akoita/resonate/issues/1334)
- Related feature: [AI Music Generation](ai_music_generation.md),
  [Remix Studio](remix_studio.md)
