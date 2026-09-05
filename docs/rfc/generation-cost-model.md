---
title: "Generation cost model + realized-cost instrumentation"
status: proposed
issues:
  - "https://github.com/akoita/resonate/issues/1421"
related:
  - docs/rfc/business-model.md
  - docs/strategy/business-model-phase0-decisions.md
  - "https://github.com/akoita/resonate/issues/1334"
  - "https://github.com/akoita/resonate/issues/1193"
date: 2026-07-10
---

# Generation cost model + realized-cost instrumentation

How we move AI-generation pricing from a **hardcoded guess** to a **measured,
per-path cost + margin** model. Revenue line (2), ADR-BM-3. This RFC is the
design of record; the **price number stays canonical in
`docs/rfc/business-model.md`** and is only set once real data is measured.

## Problem

Both generation paths bill against one flat, unmeasured COGS baseline —
`COST_PER_30_SECONDS = 0.06` (catalog, `generation.service.ts`) and
`REMIX_GENERATION_COST_PER_30_SECONDS_USD = 0.06` (remix). The sell price
(`GENERATION_PRICE_CENTS_PER_30S = 10`, ~40% notional margin) is defensible as a
placeholder but the **realized margin is unknown**: it is reconciled against no
invoice and blends two structurally different cost paths (a hosted API vs. a
self-hosted GPU with cold starts) into one rate.

## Two structurally different cost paths

| Path | Model keys | Cost shape |
| --- | --- | --- |
| **Lyria** (Google-hosted) | `lyria-002`, `lyria-3-pro-preview` | API charge ~linear in generated audio; no idle/cold-start cost to us |
| **Stable Audio 3** (self-hosted L4 GPU, scale-to-zero) | `stable-audio-3-medium`, … | GPU $/hr × wall-clock, **dominated at low volume by cold start** (~6 min model load billed with no output) + prewarm pings; NOT linear in output duration |

Duration-linear pricing systematically **under-charges** the GPU path's fixed
warm-up and **over/under-charges** depending on volume. This is why a single
blended rate is a guess.

## COGS inventory — parameters to MEASURE (placeholders until data)

Every rate below is a **placeholder flagged for measured data**; the code ships
with defaults equal to today's `$0.06/30s` (no behavior change) and the real
numbers are filled in from cloud billing.

| Parameter | Path | Unit | Default (placeholder) | Source when measured |
| --- | --- | --- | --- | --- |
| API rate | Lyria | $/sec generated | 0.06/30s equiv | Google billing / pricing page |
| GPU instance rate | Stable Audio | $/hr (L4 + vCPU + mem) | — → derive to 0.06/30s equiv | Cloud Run billing |
| Warm inference wall-clock | Stable Audio | sec/gen | measured | telemetry (this slice) |
| **Cold-start cost** | Stable Audio | $/cold call | 0 (placeholder) | telemetry (cold flag) × GPU rate |
| Prewarm ping cost | Stable Audio | $/hr amortized | 0 | prewarm frequency × GPU rate |
| Fixed per-request floor | both | $/request | 0 (placeholder) | cover warm-up/model-load once |
| GCS storage + egress | both | $/gen amortized | 0 | GCS billing |
| Failure/retry buffer | both | × multiplier | 1.0 | failure_rate × cost (telemetry) |
| Payment processing | fiat top-up | 2.9% + 30¢ | — | Stripe (deferred, #1193 gate) |

## Measurement approach (this slice — implementable now)

1. **Instrument realized cost per job.** Record on every generation: `path`
   (provider/model), `durationSeconds`, backend **`wallClockMs`**, whether it
   was a **cold start**, the model-estimated cost, and the sell price charged.
   Store a queryable `GenerationCostRecord` (keyed on `jobId`, beside the credit
   ledger) + emit `generation.cost_recorded`.
2. **Per-path cost-model config** (`generation-cost-model.ts`) — a typed,
   env-overridable per-path COGS map replacing the two flat `0.06` constants.
   Defaults reproduce today's number exactly (behavior-preserving); the
   structure lets real per-path rates + a fixed floor be filled in.
3. **Reconcile** the accumulated telemetry against real cloud billing (operator
   task, once data exists) → derive true per-path COGS + realized margin.
4. **Set the price** (per-path or a justified blended rate) to an explicit
   all-in margin target incl. failure buffer + payment fees → reconcile into
   `business-model.md` + ADR-BM-3. **Not in this slice.**

## Open pricing-policy questions (decide with data)

- **Per-path vs blended** sell price (justify any cross-subsidy).
- **Fixed per-request floor** so a 30s and a 3-min job both pay warm-up once.
- **Rounding** (`ceil` per 30s today) — fairness vs profitability.
- **Real margin** — does 30–50% survive all-in overhead + failure buffer +
  payment fees? Likely thinner than the notional 40%.
- **Price stability** — fixed vs cost-indexed; change cadence; grandfathering
  already-purchased prepaid credits.

## Guardrails

- **No staging price change** in this slice — the sell price stays the
  env-tunable placeholder; instrumentation only observes.
- Credits remain a pure prepaid **tool cost**, never a yield product (ADR-BM-4).
- Stability commercial registration (#1193) is a hard prerequisite **before**
  charging real money for SA3 outputs — independent of this measurement work.

## Deliverables

1. This RFC (cost-model structure + parameter table).
2. **Cost instrumentation** — `GenerationCostRecord` + per-job telemetry +
   `generation.cost_recorded` event (this slice).
3. **Per-path cost-model config** superseding the flat `0.06` guess
   (behavior-preserving defaults).
4. *(Later, needs data)* reconciled per-path COGS + a sell price hitting an
   explicit all-in margin, reconciled into `business-model.md` + ADR-BM-3.
