---
title: "Usage & Billing surface + metered-action registry"
status: proposed
issues:
  - "https://github.com/akoita/resonate/issues/1422"
related:
  - "https://github.com/akoita/resonate/issues/1334"
  - "https://github.com/akoita/resonate/issues/1421"
  - docs/rfc/business-model.md
  - docs/features/generation_credits.md
date: 2026-07-10
---

# Usage & Billing surface + metered-action registry

Design for a unified, extensible way to show and manage AI-usage consumption,
so we stop bolting a per-page balance widget onto every credit-consuming
feature. Revenue line (2), ADR-BM-6. Implementation is staged (see #1422 plan);
this RFC is the design of record.

## Problem

The generation-credit meter (#1334) shipped a **per-page** balance cell on the
Create page only (#1420). Remix Studio (#891) also debits credits (`remix_draft`)
but **shows nothing** — a parity gap. Every new credit-consuming feature would
add a third one-off. Coding agents (Codex, Claude Code) solved the same shape
with a centralized Usage & Billing surface + reusable meters; we take
inspiration, not a copy.

## Principle: two concepts, kept adjacent but distinct

The app already has both, and today they're visually conflated in one strip:

1. **Credits** — a buyable **monetary** balance (USD cents) spent down per
   action. Backend: `GenerationCreditAccount`/`GenerationCreditTransaction`,
   `GET /credits/balance`. Analogous to a coding agent's "credits balance /
   usage credits".
2. **Usage limits** — time-window **rate quotas** that reset (fair-use / abuse
   throttle), independent of money. Ours: catalog 50/hr (queryable), remix
   10/hr (enforce-only). Analogous to "5h / weekly" session limits.

The surface presents these **side by side but clearly labelled** — never merged
into one number. Hitting a *limit* ("wait for reset") is a different remedy from
running out of *credits* ("top up").

## Metered-action registry (extensibility backbone)

A single typed config is the source of truth for every metered action, so
"add a feature tomorrow" = register a `kind`, not new bespoke plumbing.

```ts
type MeteredActionKind = "lyria" | "remix_draft"; // extend here
interface MeteredAction {
  kind: MeteredActionKind;
  label: string;                 // "Track generation", "AI remix draft"
  cost: { model: "per_seconds_block"; unitSeconds: 30 }; // → costForDurationCents
  rateLimit?: { limit: number; windowMs: number; env: string };
}
```

- **Shared account, scoped consumption.** One `balanceCents`; each debit records
  its `kind` (already true). New feature → new kind, same account, same ledger.
- The debit sites and rate-limit enforcers read the registry instead of
  hardcoding, so cost/rate live in one place (and reconcile with
  `docs/rfc/business-model.md` — the price number stays canonical there).

## API contract

**PR 1 (now):** reuse `GET /credits/balance` unchanged.

**PR 2:** a unified aggregation so one component reads one endpoint:

```
GET /usage/summary  → {
  credits: { balanceCents, priceCentsPer30s, recentTransactions[] },
  limits: [ { kind, label, remaining, limit, resetsAt } ],   // remix made queryable
  plan:   { tier: "free", monthlyAllowanceCents?: number }    // Free today; Artist Pro later (ADR-BM-3)
}
```

To populate `limits` for remix, add a `remaining/limit/resetsAt` getter mirroring
the catalog path (currently enforce-only).

## UI

- **Reusable `CreditBalanceMeter`** (PR 1) — pure presentational, reads a
  `GenerationCreditBalance`, renders capacity ("≈ X min · Y tracks"), empty/low
  state, and the operator-request affordance (#1418). Surfaced on Create
  (replacing the one-off cell) and **Remix Studio** (closing the parity gap).
- **Dedicated Usage & Billing page** (PR 2) — a `/usage` route (mirroring
  `/wallet`, kept **distinct** from the crypto vault, which is fan→artist money,
  an ADR-BM-4 boundary) or a Settings section. Shows: plan tier, credits balance
  + top-up path, usage limits (per-kind remaining/reset timers), and a
  **usage-history** table from the ledger (`recentTransactions`).

## Production layers (designed, deferred)

- **Buy credits + auto-reload (Stripe)** — the real-money flip. Blocked on
  #1421 (measured cost/price) and #1193 (Stability commercial registration).
  Payment-fee-aware minimum purchase. Until then the surface shows the
  operator-request path and an "auto-reload — coming soon" affordance.
- **Plan tier** — Free today; ties to future Artist Pro + bundled monthly
  allowance (ADR-BM-3).
- **Empty/limit states** — explicit "out of credits → request/top-up" vs "rate
  limit hit → resets in …", mirroring the coding agents.
- Accessibility, mobile, and the existing UI/UX bar.

## Non-goals

Implementing Stripe; changing staging billing behavior; merging the crypto
`/wallet` with generation credits.

## Rollout

1. **PR 1** — RFC + `CreditBalanceMeter` + Remix parity (reuse `GET /credits/balance`).
2. **PR 2** — metered-action registry + `GET /usage/summary` (remix queryable) +
   dedicated Usage & Billing page (read-only).
3. **Later** — Stripe buy/auto-reload once #1421 + #1193 land.
