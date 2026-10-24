---
title: "Artist Pro: product, entitlements and billing"
status: proposed
issues:
  - "https://github.com/akoita/resonate/issues/2385"
related:
  - docs/rfc/business-model.md
  - docs/strategy/business-model-phase0-decisions.md
  - docs/strategy/business-model-review-2026-07.md
  - docs/rfc/generation-cost-model.md
  - docs/rfc/usage-billing.md
  - "https://github.com/akoita/resonate/issues/1422"
  - "https://github.com/akoita/resonate/issues/1421"
date: 2026-10-24
---

# Artist Pro: product, entitlements and billing

**Status: proposed, waiting on the owner's decisions (§9).** This document
charges no money and changes no price. Prices stay in
`docs/rfc/business-model.md`; nothing here becomes canonical until it is
reconciled there.

**Revenue line (ADR-BM-6):** line 2, Artist Pro and generation credits,
Phase 2 (Oct–Dec 2026). ADR-BM-4 is unaffected: Pro sells tools, never a share
of fans' money, and artists keep at least 85% of every transaction.

## 1. Where things stand

**What exists, and is free today:**

- **Generation credits** (#1334): a USD-cent ledger with debit, refund and
  zero-balance block. The ledger is live on staging. Credits enter only through
  the operator or promo grant path and the optional sign-up starter.
- **Usage & Billing** (#1422, `docs/rfc/usage-billing.md`):
  - the metered-action registry (`backend/src/modules/credits/metered-actions.ts`);
  - one usage endpoint;
  - the meter component;
  - the Settings page.

  Its `plan` field already reserves `{ tier: "free", monthlyAllowanceCents? }`.
- **Two entitlement seams, both "free for everyone":**
  - `remix.pro`: Remix Studio Pro mode (`remix-entitlements.ts`);
  - `crate.pro`: Crate Digger saved crates beyond 3, export and watch
    (`crate-entitlements.ts`).

  Each has a versioned policy and answers 403 `pro_required` once a policy can
  deny.
- **The artist cockpit and Scene Scout** (#1121): deterministic action cards
  (`propose_show_city`, pricing and relisting, and others). The docs already
  place them on line 2.
- **Rights verification** with a `TRUSTED_FAST_PATH` route for linked
  distributors and labels (`docs/features/rights_verification_workflow.md`).
- **Immediate-delivery consent** (#1776). Its `credit_topup` surface is
  already reserved for a top-up checkout.

**What is decided:**

- **ADR-BM-3:** generation is billed with prepaid credits at cost + 30–50%. A
  small monthly allowance is bundled into Artist Pro. Overage is pay-as-you-go.
  There is never unmetered access.
- **ADR-BM-6:**
  - activation order is Shows → **Artist Pro + credits** → the marketplace
    take-rate in the same release;
  - **subscription billing v1 is Stripe (fiat)**;
  - on-chain subscriptions are deferred.
- **ADR-BM-2:** the marketplace take-rate (10%, 15% micro) is already in
  force on-chain (#1333). There is nothing left to raise "in the same release".
  The x402 personal-tier difference (#1580) stays deferred.

**What is not decided** is the rest of this document: what Pro contains, how it
is enforced, how credits are bought, and what must be true before the first
charge.

## 2. Principles

1. **Pro sells tools, never access to income.** Uploading, listing, selling,
   official stems, payouts, refunds, Shows campaigns and Content Protection
   stay free for every artist. A denied entitlement never blocks money that a
   fan wants to send to an artist.
2. **Exposure cannot be bought.** Pro gives no ranking, discovery or
   recommendation boost (ADR-TE-2; Scene Scout: "Exposure cannot be
   purchased").
3. **A downgrade never takes anything away.** Both seams already promise that
   nothing is deleted or hidden: saved Pro settings still render, crates stay
   readable, and exports already made stay downloadable. A lapsed plan stops
   new Pro actions only.
4. **One entitlement service, one plan model.** No new per-feature seam.
   Agents, MCP and x402 read the same decision as the web app.
5. **Credits are money.** They are USD cents. Bought credits keep their value
   (the pricing proposal: no expiry for at least 24 months). Allowance credits
   are a separate bucket with their own expiry, so a subscription never
   devalues credits someone bought.

## 3. The plan: what Pro contains

One creator plan, **Artist Pro**, for artists and for producers and DJs (the
same person is often all three). A separate listener plan (Listener Pro, line 4)
is out of scope and gated on weekly active listeners.

| Area | Free | Artist Pro |
| --- | --- | --- |
| Upload, stem separation of your own releases, listing, selling, official stems, payouts | ✅ | ✅ |
| Remix Studio: everything except Pro mode | ✅ | ✅ |
| Remix Studio Pro mode (per-stem EQ and pan; later dynamics, automation, beat grid, DJ export, #1903) | — | ✅ (`remix.pro`) |
| Crate Digger: up to 3 saved crates, quotes, buying | ✅ | ✅ |
| Crate Digger: unlimited crates, rekordbox/Serato export, watched crates | — | ✅ (`crate.pro`) |
| Cockpit: core action cards (pricing, relisting, rights) | ✅ | ✅ |
| Cockpit: demand cards (Scene Scout city demand, first-week reception, show proposals) | — | ✅ (`cockpit.demand`) |
| Generation credits | Pay as you go (+ starter, if enabled) | A monthly allowance (§5), then pay as you go |
| Rights review | The standard queue | A **priority** human review. It never skips a check: the fast path stays reserved for linked distributors and labels |

**Stem separation of an artist's own releases stays free,** although the
strategy listed it in the bundle. Separation is what makes stems sellable, and
gating it would gate earning (principle 1). What Pro can add is re-running
separation with a newer model on request. That is a later, metered action, not
part of v1.

## 4. One entitlement service

**What replaces the two seams.** `RemixEntitlementsService` and
`CrateEntitlementsService` become thin adapters over one
`EntitlementsService`:

```ts
type Feature = "remix.pro" | "crate.pro" | "cockpit.demand" | "credits.allowance";
type Decision = {
  allowed: boolean;
  reason: "free_for_everyone" | "plan" | "grant" | "pro_required";
  plan: "free" | "pro";
  source?: "stripe_subscription" | "operator_grant" | "promo";
  validUntil?: string;        // period end, for the client
  policyVersion: string;      // "entitlements/v1"
};
decide(userId: string, feature: Feature): Promise<Decision>;
```

**Data model (no migration until implementation):**

- `Subscription`: user, provider (`stripe`), provider customer and
  subscription ids, plan, status (`trialing | active | past_due | canceled`),
  current period start and end, `cancelAtPeriodEnd`.
- `EntitlementGrant`: user, plan or feature, source (`operator_grant`,
  `promo`), valid from and until, reason. Used for founders, partners and
  support, and audited (`AdminAuditEvent`, step-up for grants).

**How the decision is made:**

- **Plan wins:** an active or trialing subscription, or a valid grant, gives
  `pro`.
- **Past due:** `past_due` keeps Pro for a short grace period (7 days, see §9),
  then drops to `free`.
- **Caching:** the decision is cached per request and invalidated by webhook
  events. It is never cached across a plan change.

**Who reads it:**

- The web reads it on `GET /usage` (`plan`) and on each feature's DTO.
- MCP and agents read it through the same service. An agent acting for a user
  gets that user's decision, never its own.

**Rollout:**

- The first slice ships the service with policy `everyone` (identical to
  today).
- The switch to plan-based decisions is one policy version bump. It is
  reconciled in `docs/rfc/business-model.md` first, as both seams already
  require.

## 5. The generation allowance

**Sizing.** The allowance is sized at **cost prices**
(`docs/rfc/generation-cost-model.md`), not sell prices.

**Recommended default:** an allowance worth **$3.00 at sell prices** each
month.

- That is 30 Lyria 2 clips, or about 23 Lyria 3 Pro songs at the proposed
  13¢, or about 33 warm 30-second GPU renders at 9¢.
- Its cost is about $1.90–$2.05, at the cost prices of 6.5¢, 8.9¢ and about
  5.7¢ (1.5¢ warm, plus the cold start at a 40% share).

**Bucket rules:**

- Allowance credits land in their own ledger bucket on each paid invoice.
- They expire at period end.
- They are spent **before** bought credits.
- They are never refunded in cash.

**Worked unit economics** (assumptions labelled; the inputs are refined by the
private billing reconciliation):

| Line | Per month |
| --- | --- |
| Price (example, see §9) | $14.99 |
| Card processing (2.9% + 30¢) | −$0.73 |
| Allowance at cost, if fully used | −$2.05 |
| Pro-only compute (exports, demand cards, priority review time) | small, unmeasured |
| **Gross margin before VAT and support** | **≈ $12.21 (≈ 81%)** |

VAT is collected on top or included, depending on §9. With prices including
VAT, an EU price of €14.99 nets about €12.29 before card fees at 22% VAT.

**Strategy target:** 50 paying artists (≈ $750 MRR at $14.99). The strategy's
$1–1.5k MRR target implies about 70–100 subscribers, or a higher price.

## 6. Billing: Stripe subscriptions (ADR-BM-6)

**Flow:**

- **Checkout:** Stripe Checkout (subscription mode) and the Stripe Customer
  Portal for card updates, cancellation and invoices. Resonate never handles
  card data.
- **Webhooks:**
  - signatures are verified;
  - delivery is idempotent on the Stripe event id;
  - events are applied in order of the subscription's `current_period_end`,
    and an older event never overwrites a newer state.
- **Events handled:** `checkout.session.completed`,
  `customer.subscription.created|updated|deleted`, `invoice.paid` (grants the
  allowance) and `invoice.payment_failed` (past due).
- **Mapping:** one Stripe customer per Resonate user, with the user id in
  Stripe metadata and the customer id stored here. The billing email is the
  confirmed contact address (#2169); a confirmed email is required **only** to
  subscribe.

**Tax:**

- **Stripe Tax** handles VAT and sales tax.
- Registration (EU OSS) and the operator's tax settings are deployment
  configuration (resonate-iac), not code.

**Withdrawal (EU):**

- A subscription is a digital service. The checkout records an
  immediate-start consent, using a new `subscription` surface in the #1776
  consent model, with no hold.
- Withdrawing within 14 days refunds pro rata for unused time, and the
  allowance already spent is deducted.

**Accounting:**

- Subscription revenue is recognised over the period.
- Bought credits are a liability until spent, so their revenue is deferred.
- Both are operator processes. The application records what they need
  (ledger and invoice ids).

**Configuration:** Stripe keys and the webhook secret come from the secret
manager. Price ids and URLs are central configuration, never in source.

## 7. Buying credits (#1422)

**Purchase:**

- **Top-up:** Stripe Checkout in one-time payment mode, for fixed packs. The
  defaults are **$5 minimum, $10 default** (from the pricing proposal).
- **Consent:** the existing `credit_topup` consent step comes before payment.
  - "Deliver now", the normal choice, credits at once and gives up withdrawal
    for the credits used.
  - "Wait" holds the credits for 14 days.
- **Receipts:** the Stripe receipt plus a ledger row (`reason: top_up`, with
  the payment intent id). A credit purchase appears in Usage & Billing and in
  notices.
- **Auto-reload:** off by default, and only with an explicit cap per month.
  It needs a saved payment method, so it ships after the first slice.

**USDC top-up** from the smart account (x402-style) is the natural second
rail: lower fees, and the wallet already exists. The recommendation is a fast
follow on the same ledger, not v1 (§9).

## 8. Before the first charge

Each of these must be true. None of them is code in this repository.

1. **#1421:** per-path prices signed off and reconciled into
   `docs/rfc/business-model.md`.
2. **Legal review:**
   - the consent wording (`2026-10-24.draft-1`) and its open questions;
   - subscription terms in the Terms of Service;
   - the refund policy for subscriptions and credits.
3. **Tax and accounting:**
   - VAT registration (OSS) and Stripe Tax configured;
   - deferred-revenue treatment agreed.
4. **Licences:** a commercial-use registration for any billed model that needs
   one, such as Stable Audio 3 (ADR-BM-3).
5. **Stripe:** the account, products and prices, the webhook endpoint and
   secret (a resonate-iac half).
6. **Rollout:** to staging in Stripe test mode first. Production waits for a
   real-user decision, because a feature is not production-ready because it is
   built.

## 9. Owner decisions (each with a recommended default)

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | The plan's scope | One creator plan, Artist Pro, covering artists, producers and DJs (§3) |
| 2 | Price | **$14.99/month** (the "creator" price already listed in `business-model.md` Layer 2), with an annual option at 2 months free. Subject to #1421 |
| 3 | VAT presentation | Prices include VAT in the EU and exclude it elsewhere (Stripe Tax) |
| 4 | Contents | The §3 table; stem separation of your own releases stays free |
| 5 | Allowance | **$3.00 a month** at sell prices, expiring at period end and spent first; never cash-refunded |
| 6 | Grace on failed payment | 7 days of Pro, then free (nothing is deleted) |
| 7 | Trial | None at launch. Founders and partners get operator grants instead |
| 8 | Credit top-up rail | **Stripe for v1** (ADR-BM-6). USDC top-up as a fast follow on the same ledger |
| 9 | Top-up packs | $5 minimum, $10 default, $25; auto-reload later, with a monthly cap |
| 10 | Bought-credit expiry | None for at least 24 months (pricing proposal) |
| 11 | Priority rights review | Part of Pro, as priority only; never skipping a check |
| 12 | Marketplace take-rate | No change: 10% and 15% micro are already in force (ADR-BM-2); #1580 stays deferred |

## 10. Implementation, once decided

The work splits into these slices. Each is filed when this design is accepted
and states its revenue line.

1. **The entitlement service** (policy `everyone`, so nothing changes):
   - fold `remix.pro` and `crate.pro` into it;
   - add `cockpit.demand`;
   - add operator grants, with step-up and audit;
   - expose `plan` on `/usage`.
2. **Stripe subscriptions:**
   - Checkout, Portal and webhooks;
   - the `Subscription` model;
   - the `subscription` consent surface;
   - a plan page in Usage & Billing.

   It has a resonate-iac half (Stripe configuration, Stripe Tax, the webhook
   endpoint).
3. **The allowance:** a ledger bucket, the grant on `invoice.paid`, expiry, and
   spend order.
4. **Buying credits (#1422):** the top-up checkout, consent, receipts and
   notices.
5. **Pro gates on:** a policy bump to plan-based decisions, with upgrade
   prompts at each gate (no dead buttons). It needs the §8 gates.
6. **Later:**
   - auto-reload;
   - the USDC top-up;
   - an annual plan;
   - re-running separation on demand.

## 11. Success and kill criteria

From the strategy review (§4, Phase 2):

- **Success:** 50 paying artists and marketplace GMV above $5k a quarter.
- **Kill or rethink:** fewer than 10 paying artists 60 days after a real-user
  launch. In that case, reconsider the price, the contents, or whether
  creators value the tools at all before adding more.
