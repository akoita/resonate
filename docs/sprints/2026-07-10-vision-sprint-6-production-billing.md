# Sprint Plan: Vision Sprint 6 — Production Billing

**Dates:** 2026-07-10 → 2026-07-25 (indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 6: production billing](https://github.com/akoita/resonate/milestone/8)
**Tracker filter:** [`label:sprint:vision-6`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-6)
**Working mode:** flexible priority-set sprint — see [README.md](README.md)
**Revenue line:** (2) Artist Pro + generation credits — the ADR-BM-6 line whose *meter* shipped in Sprint 5 (#1334); this sprint builds the production **billing** foundation on top of it.

> **Sprint Goal:** turn the shipped generation-credit meter from a demo-grade,
> per-page balance cell into a **production billing foundation**: a *measured*,
> per-path cost+margin **pricing model** (#1421) and a *coherent, extensible*
> **Usage & Billing surface** with reusable meters (#1422). At demo, a user
> sees one honest place to understand their usage and remaining balance across
> every credit-consuming feature (generation **and** remix), the price is
> defensible against real measured COGS rather than a hardcoded guess, and the
> path to charging real money is designed — even if the live-fiat switch stays
> gated. The artist's 85%+ on fan money is never touched (credits are a
> cost+margin tool charge, ADR-BM-4).

## Vision alignment (why this sprint)

Sprint 5 made AI generation a metered capability that feeds sellable ownership
products, but billing is demo-grade: a flat `10¢/30s` price over a **hardcoded**
`6¢` cost guess, and a balance cell that exists **only on the Create page** even
though Remix Studio also debits credits and shows nothing. The next
credit-consuming feature would be a third one-off widget. Before we charge real
money (revenue line 2), the pricing must be **measured and honest** and the
usage surface must be **unified and reusable** — the same shape coding agents
(Codex, Claude Code) converged on. This sprint pays down that debt so "charge
real money" becomes a config flip on a sound foundation, not a scramble.

## Priorities

1. **#1421 — Generation-credit pricing: true cost+margin model.** Instrument
   real per-path COGS capture (Path A Lyria billing unit; Path B Stable Audio 3
   L4 GPU incl. cold-start + prewarm; shared GCS/overhead), replace the
   hardcoded `COST_PER_30_SECONDS` guess with a measured basis, and derive a
   defensible per-path cost+margin price reconciled in `docs/rfc/business-model.md`.
   Ship the model + instrumentation on staging; the realized-margin question is
   answered with data, not a placeholder.
2. **#1422 — Coherent, extensible Usage & Billing surface.** A unified usage/
   billing page + a **reusable balance/meter component** consumed by both the
   Create page and Remix Studio (closing the **remix balance parity** gap where
   remix debits but shows no balance), backed by a kind-scoped consumption model
   and a metered-action registry so the *next* credit feature is a registration,
   not a new widget. Keep usage-limits vs credits conceptually distinct.
3. **(Stretch) Artist Pro (Stripe v1) groundwork.** Design + staging-only
   scaffolding for the Artist Pro subscription that will bundle credits + tools —
   **design and gated groundwork only, no live fiat charging** (file a dedicated
   issue if pulled in).

## Operator inputs required (only @akoita can provide)

- Real billing data to measure COGS (#1421): Google Lyria invoices / pricing
  confirmation, and Cloud Run L4 GPU billing for the Stable Audio worker.
- Credit-price sign-off once the measured model lands (supersedes the ~$0.10/30s
  placeholder from ADR-BM-3).
- Go/no-go on any Stripe/Artist-Pro groundwork (kept design-only until then).

## Explicitly NOT in this sprint

- **No live fiat charging / no real Stripe charges.** Credits still enter via the
  operator grant path on staging; the fiat top-up switch stays gated.
- The deep on-chain contract work (#1300 upgradeability, per-tier on-chain fee)
  and the first-real-revenue Shows go-live (#1271) are other themes.
- Usage-based *rate-limiting* enforcement beyond what the meter already does.

## Exit criteria

- Generation price is derived from a **measured** per-path cost basis (not a
  hardcoded guess), documented and reconciled in `docs/rfc/business-model.md`;
  cost-capture instrumentation runs on staging.
- A **single** usage/billing surface shows honest remaining balance + recent
  consumption across **all** credit-consuming features; Remix Studio shows a
  balance (parity with Create); a new credit feature can register into it
  without a bespoke widget.
- Feature catalog + User Guide updated; live-fiat remains gated and clearly
  labeled as such.

## Business-model conformance

Revenue line (2), ADR-BM-6. Credits are a cost+margin **tool charge**, separate
from the fan→artist split — the **85%+ artist share (ADR-BM-4) is untouched**.
Any price/margin number is reconciled in the single canonical fee table
(`docs/rfc/business-model.md`), never introduced ad hoc in code (ADR-BM red
lines). No royalty-yield/income-share products; no platform-subsidized payouts.
