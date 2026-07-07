# Issue #1334 — Generation-credit meter (implementation plan)

**P0 of Vision Sprint 5.** Turn AI generation into a metered capability: every
generation debits a prepaid credit balance; zero balance blocks with a clear
message. **Staging scope = the meter only** — credits enter via an operator/promo
grant path; **no live fiat / Stripe** (that's the deferred production flip). This
is license-safe to build because no money changes hands (the #1193 SA3-license
blocker gates *charging money*, not the internal meter).

Decision record: ADR-BM-3. Cost basis already in code:
`generation.service.ts COST_PER_30_SECONDS = 0.06`. Sell ~$0.10/30s (cost +
margin).

## Economic model

- **Credits are denominated in USD cents** (integer money — never float).
- **Price:** `GENERATION_PRICE_CENTS_PER_30S` (env/config, default **10** =
  $0.10/30s sell; cost is 6¢, so ~40% margin). Cost of a generation =
  `ceil((durationSeconds / 30) * priceCents)` cents.
- Credits are owned **per user** (`userId` — the generating artist), matching
  `createGeneration(dto, userId)`.
- Reconcile the sell price into `docs/rfc/business-model.md` (the single
  canonical fee/price source) with the cost+margin note and the ADR-BM-3 ref.

## Schema (backend/prisma/schema.prisma) — 2 models + migration

```prisma
model GenerationCreditAccount {
  userId       String   @id
  balanceCents Int      @default(0)
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model GenerationCreditTransaction {
  id               String   @id @default(uuid())
  userId           String
  type             String   // "grant" | "debit" | "refund"
  amountCents      Int      // positive magnitude; type gives direction
  reason           String   // e.g. "lyria_generation", "remix_draft", "promo_grant", "job_failed_refund"
  jobId            String?
  balanceAfterCents Int
  createdAt        DateTime @default(now())
  @@index([userId, createdAt])
}
```

Append-only ledger + a cached balance account (auditable, matches the
fee/settlement doctrine). Add the `User` back-relation. Run
`prisma migrate dev --name generation_credit_ledger` and commit the migration.

## Service: `GenerationCreditsService` (backend/src/modules/credits/)

- `costForDurationCents(durationSeconds): number` — `ceil((d/30) * priceCents)`.
- `getBalance(userId)` → `{ balanceCents, recentTransactions }` (last ~20).
- `grant(userId, amountCents, reason)` — upsert account, increment, append a
  `grant` txn. The ONLY way credits enter on staging (promo/test/allowance);
  live fiat top-up is deferred. amountCents must be > 0.
- `debit(userId, amountCents, reason, jobId?)` — in a `prisma.$transaction`:
  upsert-read the account, if `balanceCents < amountCents` throw
  `InsufficientCreditsException` (maps to HTTP 402 Payment Required, or 400 if
  402 isn't wired — check the app's exception filter), else decrement + append a
  `debit` txn with `balanceAfterCents`. Must be race-safe (the transaction +
  conditional update; use an atomic `updateMany` with a `balanceCents: { gte:
  amount }` where-guard and assert `count === 1`, else insufficient — avoids
  read-modify-write oversell). Returns `balanceAfterCents`.
- `refund(userId, amountCents, reason, jobId?)` — increment + append `refund`
  (used when a debited job terminally fails). Idempotent-ish: guard against
  double-refund of the same jobId (check no existing refund txn for that jobId).

## Debit hooks (gate the two generation paths)

1. **Lyria generation** — `generation.service.ts createGeneration(dto, userId)`
   (~line 167): compute `cost = costForDurationCents(dto.durationSeconds ?? 30)`;
   `await credits.debit(userId, cost, 'lyria_generation', jobId)` BEFORE
   `generationQueue.add(...)`. If the enqueue throws after the debit, `refund`.
   Also add a refund on **terminal job failure** in the generation processor's
   failure path (so a crashed generation returns the credits) — locate the
   BullMQ failure/`moveToFailed` handler for the `generate` queue; if a clean
   hook isn't obvious, note it as a follow-up rather than forcing it.
2. **Remix draft** — `remix-project.service.ts` around the
   `this.generationProvider.createRemixDraft(...)` call (~line 1181): debit
   `costForDurationCents(durationSeconds)` with reason `'remix_draft'` and the
   project/job id BEFORE the provider call; `refund` in the catch if the
   provider throws (so a failed draft isn't charged). Use the same duration the
   provider computes.

Wire `GenerationCreditsService` into the generation and remix modules (provider
in a new `CreditsModule` exported and imported by both).

## Endpoints: `credits.controller.ts`

- `GET /credits/balance` (AuthGuard jwt) → the caller's balance + recent txns.
- `POST /credits/grant` (AuthGuard jwt + RolesGuard `@Roles('admin','operator')`)
  → `{ userId, amountCents, reason }` → `grant(...)`. Operator/promo seed path
  (staging). Mirror the operator-only pattern used by the shows lifecycle routes.

## Analytics events (register or the taxonomy test fails)

Add to `backend/src/modules/analytics/analytics_event.ts` AND
`test-fixtures/analytics_expected_events.json` (and any taxonomy spec exact
list — grep for how `shows.campaign_settled` was registered, #1340):
- `generation.credits_debited` — `{ userId, amountCents, jobId, kind }`
  (kind = lyria | remix_draft)
- `generation.credits_insufficient` — `{ userId, requiredCents, balanceCents, kind }`
- `generation.credits_granted` — `{ userId, amountCents, reason }`
Publish them from the service at debit/block/grant.

## Config

`GENERATION_PRICE_CENTS_PER_30S` (default 10) read via ConfigService/env, so
price is tunable and reconciles to the RFC. Keep `COST_PER_30_SECONDS = 0.06`
as the cost baseline (do not change).

## Tests (backend/src/tests, Testcontainers; never mock prisma)

- `credits.integration.spec.ts`: grant → balance reflects it; debit reduces
  balance + appends a `debit` txn with correct `balanceAfterCents`; **insufficient
  balance blocks** (throws, NO debit, balance unchanged); refund restores +
  appends; **concurrent debits do not oversell** (fire two debits that together
  exceed balance; exactly one succeeds — proves the atomic where-guard); a second
  refund for the same jobId is a no-op.
- Extend a generation/remix integration or controller spec to prove a
  zero-balance user is **blocked** from `createGeneration` / remix draft, and a
  granted user is **debited**.
- `credits.controller.http.spec.ts`: `GET /credits/balance` requires auth;
  `POST /credits/grant` rejects non-operator (403).
- Analytics taxonomy test stays green (new events registered).

## Docs

- `docs/rfc/business-model.md`: reconcile the ~$0.10/30s sell price (cost 6¢ +
  margin) under the generation-credits line, ADR-BM-3.
- Feature catalog + a short `docs/features/generation_credits.md` (status
  `partial` — meter live on staging, live fiat top-up deferred): who it's for,
  how the meter works, the operator grant path, env var, events, the
  staging-only-no-fiat note.
- User Guide: if a generation/Remix Studio article exists in
  `web/src/lib/help/content.ts`, add a plain-language line that AI generation
  uses credits and what happens at zero balance.

## Gates

- backend: `npx tsc --noEmit`; `npx prisma generate`; `jest` credits controller
  spec; integration `credits.integration` (Docker) + the generation/remix
  block test; analytics taxonomy spec green.
- `git diff --check` clean.

## Scope guard (staging-only, per #1271 posture)

NO Stripe, NO live fiat, NO real charges. Credits enter only via the operator
`grant` path. The meter (debit/block/refund + analytics) is fully built and
proven; **live top-up is the production flip, explicitly out of scope.** State
this in the feature doc and the PR. Frame in code comments: credits are a
cost+margin tool meter, separate from the fan→artist transaction split — the
85%+ is untouched (ADR-BM-4).
