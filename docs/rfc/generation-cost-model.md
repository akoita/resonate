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
updated: 2026-10-24
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

## Pricing proposal for owner sign-off (Sprint 41, #1421)

**Status: proposed — not in force.** The canonical sell price stays
`GENERATION_PRICE_CENTS_PER_30S = 10` in `docs/rfc/business-model.md` until the
owner signs this off. The measured billing reconciliation lives in the
deployment repository and may revise the inputs below; the numbers here are
public list prices, measured wall-clock, and labelled assumptions.

### Inputs

| Input | Value | Source |
| --- | --- | --- |
| Lyria 2 (`lyria-002`) | $0.06 per ~30 s clip | public list price (third-party listings; confirm on Google's Vertex AI pricing page) |
| Lyria 3 Clip (`lyria-3-clip-preview`) | $0.04 per song (≤30 s) | public preview list price (same caveat) |
| Lyria 3 Pro (`lyria-3-pro-preview`) | $0.08 per song (≤184 s) | public preview list price (same caveat) |
| Cloud Run L4 GPU | $0.0001867/s (no zonal redundancy) | Cloud Run pricing |
| Cloud Run instance CPU / memory | ~$0.000018/vCPU-s, ~$0.000002/GiB-s | Cloud Run pricing |
| GPU instance shape | 4 vCPU + 16 GiB (the Cloud Run L4 minimum) | platform constraint |
| → GPU instance all-in | **≈ $0.00029/s ≈ $1.05/h** | derived |
| Warm GPU render wall-clock | p50 ≈ 51 s, p90 ≈ 56 s per 30 s render | `GenerationCostRecord` (small sample) |
| Cold start | ≈ 360 s of billed time with no output | this RFC's existing estimate — **not yet measured** (no cold record in the sample) |
| Storage + egress | ≈ 0.2¢ per generation | ~6 MB WAV, GCS egress list price |
| Failure buffer | × 1.05 | assumption (no refunds recorded yet) |
| Card processing | 2.9% + 30¢ per top-up | Stripe standard (EU cards are cheaper) |

### Unit cost by path

| Path | Cost per unit | Today's price | Today's markup |
| --- | --- | --- | --- |
| Lyria 2, per 30 s | 6¢ × 1.05 + 0.2¢ ≈ **6.5¢** | 10¢ | +54% |
| Lyria 3 Pro, per song (≤184 s) | 8¢ × 1.05 + 0.5¢ ≈ **8.9¢** | `ceil(s/30) × 10¢` → **40¢** for a 105 s song | +350% (over-charged) |
| Lyria 3 Clip, per song (≤30 s) | 4¢ × 1.05 + 0.2¢ ≈ **4.4¢** | 10¢ | +127% |
| Self-hosted GPU, warm, per 30 s | 51 s × $0.00029 ≈ **1.5¢** | 10¢ | +570% |
| Self-hosted GPU, **cold**, per request | + 360 s × $0.00029 ≈ **+10.5¢** | — | a cold 30 s render costs ≈ 12¢ → **under water** |

The flat rate is wrong in both directions: it over-charges hosted per-song
models roughly 4–5×, and under-charges a cold GPU render.

### Proposed price table

ADR-BM-3 sets the margin at cost + 30–50%. Every proposal below lands inside
it, or explains why it doesn't.

| Path | Proposed price | Cost | Markup |
| --- | --- | --- | --- |
| Lyria 2 | **10¢ per 30 s** (unchanged) | 6.5¢ | +54% (slightly above band; keeps today's familiar unit) |
| Lyria 3 Pro | **13¢ per song** (≤184 s) | 8.9¢ | +46% |
| Lyria 3 Clip | **6¢ per song** (≤30 s) | 4.4¢ | +36% |
| Self-hosted GPU (remix drafts, AI part takes, stem-plus-AI renders) | **5¢ per request + 4¢ per 30 s** | 1.5¢ warm per 30 s, + 10.5¢ × cold share per request | +45% at a 40% cold share; the floor pays the warm-up once instead of per 30 s |

A 30 s GPU render costs the listener 9¢, and a 60 s one 13¢. If the measured
cold share turns out well below 40% (the prewarm service exists for this), the
floor should drop, not the per-30 s rate.

### Policies proposed alongside

- **Rounding:** `ceil` per 30 s for duration-priced paths; flat per song for
  per-song models (Lyria 3).
- **Minimum top-up:** **$5.** Card fees are 8.9% of a $5 top-up and 5.9% of
  $10, which still leaves every path above +20% after fees. $10 is suggested as
  the default pack.
- **Credits keep their value:** credits are USD cents, so a price change never
  devalues credits already bought. Changes are published with 30 days' notice,
  reviewed at most quarterly, and indexed to the measured costs, never to
  demand.
- **Expiry and refunds:** no expiry for at least 24 months. Refunds of unused
  credits depend on the withdrawal-right and immediate-delivery questions
  (#1776), which are a **legal gate** before the first charge, as are VAT
  treatment and the deferred-revenue accounting.
- **Artist Pro:** the bundled allowance is costed at these per-path cost
  prices, not at sell prices. Sizing the allowance and pricing Pro itself are
  separate owner decisions.

### Sign-off checklist (owner)

- [ ] The measured reconciliation (deployment repository) confirms or corrects
  the cold share, the failure rate and the Lyria list prices.
- [ ] Approve the per-path table, or keep a blended rate with an explicit
  cross-subsidy note.
- [ ] Approve the minimum top-up and the expiry policy, after the legal gate.
- [ ] Then reconcile into `docs/rfc/business-model.md` (ADR-BM-3) and set the
  per-path configuration (`generation-cost-model.ts` costs; per-path sell
  prices behind the Usage & Billing registry, #1422).

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
4. **Pricing proposal for owner sign-off** (Sprint 41, above): per-path unit
   costs from list prices and measured wall-clock, a proposed per-path price
   table, and the policies around it. The canonical price changes only after
   sign-off and the measured reconciliation.
