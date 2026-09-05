# Issue #1421 — Generation cost instrumentation (this slice)

Sprint 6. Design of record: `docs/rfc/generation-cost-model.md`. Revenue line (2), ADR-BM-3. **No staging price change; no Stripe.** This slice only *observes* cost and *structures* the COGS config — the price sign-off waits for measured data + #1193.

## Guardrails (must hold)
- The **sell price is unchanged** (`GENERATION_PRICE_CENTS_PER_30S`, `costForDurationCents`) — do NOT touch it.
- The **cost estimate is behavior-preserving**: the new per-path config defaults to today's flat `$0.06/30s`, so `calculateGenerationCost` / `estimateRemixGenerationCostUsd` return **identical values** until real rates are configured.
- Telemetry must **never fail a generation** — all cost-record writes/event emits wrapped in try/catch, logged not thrown.

## WI-B — Backend cost instrumentation  *(Opus-4.8-high)*
Files: new `backend/src/modules/generation/generation-cost-model.ts`; `generation.service.ts`; `backend/src/modules/remix/remix-generation.provider.ts`; `remix-project.service.ts`; `backend/prisma/schema.prisma` (+ migration); `backend/src/events/event_types.ts`; `backend/src/modules/analytics/analytics_event.ts`; `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`; tests.

1. **Per-path cost-model config** `generation-cost-model.ts`:
   - A typed map keyed by path/provider — `lyria-002`, `lyria-3-pro-preview`, `stable-audio-3-medium` (+ a default) → `{ costPer30sUsd: number; fixedFloorUsd: number }`. Defaults: `costPer30sUsd: 0.06`, `fixedFloorUsd: 0` (⇒ identical to today). Env-overridable via `ConfigService` (mirror the `GENERATION_PRICE_CENTS_PER_30S` env pattern at `generation-credits.service.ts:102-110`), e.g. `GENERATION_COST_<PATH>_PER_30S_USD`. Export `estimateGenerationCostUsd(path, durationSeconds)` = `ceil(sec/30)·rate + floor` (matching the current `ceil` block behavior — verify against `calculateGenerationCost` `generation.service.ts:761` and `estimateRemixGenerationCostUsd` `remix-generation.provider.ts:456`).
2. **Route both estimators through the config** (behavior-preserving): `calculateGenerationCost` and `estimateRemixGenerationCostUsd` call `estimateGenerationCostUsd(path, sec)` with the right path key. Delete the two flat `0.06` constants (`generation.service.ts:16`, `remix-generation.provider.ts:16`) in favor of the config default. Existing generation/remix cost tests MUST still pass unchanged.
3. **`GenerationCostRecord` model** (schema.prisma, beside `GenerationCreditTransaction` `:62`) + migration:
   `{ id, jobId @unique?, userId, path (String, the provider/model key), durationSeconds Int, wallClockMs Int, estimatedCostUsd Float, sellPriceCents Int, coldStart Boolean?, createdAt }`, indexed `[userId, createdAt]` and `[path, createdAt]`. Run `npx prisma generate` + a migration (hand-write the SQL matching repo convention if `migrate dev` is non-interactive; apply via `migrate deploy` to verify).
4. **Instrument wall-clock + write the record**:
   - Catalog (`generation.service.ts` `processGenerationJob` ~253): capture `t0` before the `lyriaClient.generate` call (~287), `t1` after; on completion (~398) AND on failure-after-provider-call, write a `GenerationCostRecord` (path = `generationMetadata.provider`, duration = the requested/returned durationSeconds, wallClockMs = t1−t0, estimatedCostUsd = the computed cost, sellPriceCents = what was debited) and emit `generation.cost_recorded`.
   - Remix (`remix-project.service.ts` `processGenerationJob` ~1084): reuse existing `processingStartedAt` (~1107) → `completedAt` (~1250) for wallClockMs; write the record + emit on settle (completed + failed-after-provider). Path = `generationProvider`.
   - `coldStart`: best-effort — set true when the Stable Audio provider call took anomalously long (e.g. the prewarm service reports a cold worker, or wallClockMs exceeds a threshold), else false/null. Do NOT over-engineer; null when unknown.
   - All writes/emits in try/catch (a telemetry failure must not fail or refund the generation).
5. **Register `generation.cost_recorded`** in all three registries (copy the `generation.credits_debited` pattern): `event_types.ts` (interface ~:1250 + `ResonateEvent` union ~:1324), `analytics_event.ts` (declaration ~:223-237, `privacyTier:"personal"`, payloadFields: userId, jobId, path, durationSeconds, wallClockMs, estimatedCostUsd, sellPriceCents, coldStart), and the domain→analytics bridge (~:895).
6. **Tests** (`*.integration.spec.ts` on Testcontainer Postgres, real prisma, unique TEST_PREFIX): (a) `estimateGenerationCostUsd` with default config == the pre-refactor cost for representative durations (30/60/180s) on both paths; (b) a completed generation writes a `GenerationCostRecord` with the expected path/duration/wallClockMs>=0/estimatedCostUsd/sellPriceCents; (c) the new event is registered (analytics taxonomy test stays green). Don't mock Prisma.

## Verification (maestro runs)
- `npm run lint`; `npx prisma generate`; the new integration spec; existing generation/remix/credits cost tests still green (behavior-preserving); analytics taxonomy test green.

## Docs
Feature doc `docs/features/generation_credits.md` — note the realized-cost telemetry + per-path cost-model config + the deferred price reconciliation (needs measured data). Keep the price canonical in business-model.md unchanged.
