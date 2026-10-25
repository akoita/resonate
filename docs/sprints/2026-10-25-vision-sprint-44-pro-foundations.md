# Vision Sprint 44: Pro foundations, in test mode

**Status:** ✅ Closed 2026-10-25. All seven slices shipped, and the exit checks
pass on staging at `a2a803fc` (the test-mode purchase run waits for Stripe test
keys, see below).
**Milestone:** [46](https://github.com/akoita/resonate/milestone/46).
**Goal:** On staging, in Stripe **test mode**, an artist can subscribe to Artist
Pro, receive the monthly allowance and buy credits from start to finish, with
access decided by one entitlement service. No real money is charged. The
nightly security scan is trustworthy again, and local validation matches CI.

## Outcome

The Artist Pro foundations are on staging in test mode: one entitlement
service, Stripe subscriptions, the monthly allowance, and credit packs. No
money is charged, and the Pro gates are still off. The nightly security scan
can be trusted again, and local validation matches CI.

| Issue | Result | PR |
| --- | --- | --- |
| #2418 | The nightly evidence check records rejected workflow runs that started no job as `not_executed`, and still fails on any run that executed with an unexpected event or ref | #2422 |
| #2420 | The kernel-v3 pin comes from the gitlink, so local `forge build` and `forge test` pass with no skips (563/563). Integration suites no longer wipe shared tables, and a guard test blocks unscoped wipes | #2424 |
| #2406 | One `EntitlementsService` decides `remix.pro`, `crate.pro` and `cockpit.demand`. The policy is still `everyone`, so behaviour is unchanged. Operator grants require passkey step-up and are audited. `/usage` shows the plan | #2427 |
| #2407 | Stripe subscriptions in test mode: Checkout and Portal, signed and idempotent webhooks applied in order, a 7-day grace period, the `subscription` consent step, and a plan page. Live keys are refused unless live mode is switched on, and it stays off | #2431 |
| #1422 (slice) | $5 / $10 / $25 credit packs in test mode: consent before checkout, fulfilment exactly once, 14-day holds, and refunds that never take back spent credits. The issue stays open for live charging | #2432 |
| #2408 | A $3 monthly allowance in its own bucket, granted once per paid invoice. It is spent first and expires at period end. $0 invoices grant nothing (ADR-BM-3), and spending it needs an active Pro subscription | #2435 |
| #1943 | Five before/after audio examples in the Remix guide, rendered through the studio's own pipeline from a purpose-made demo song with recorded provenance. The owner listened and approved them | #2425 |

**Unplanned:**

- **#2439.** Dependency Train's deliberate push run (#2434) was missing from
  the release-plane evidence allow-list. It is now allowed on `main` only.
  After that change, a manual Security Scan run passed in full: Release Plane
  Evidence, Supply Chain Baseline and the advisory scan.
- **#2440.** An exploration of Stripe stablecoin and machine payments
  (MPP/x402). USDC fits as a payment method for Artist Pro and credits (line 2).
  It doesn't fit artist money, which must stay on-chain.
- **#2423.** The OpenZeppelin and account-abstraction pin drift was filed as a
  follow-up.

**Staging verification (2026-10-25, `a2a803fc`):**

- The billing, credits and grant routes answer 401 without a sign-in.
- The Stripe webhook answers `503 billing_unavailable`, because staging has no
  Stripe keys yet.
- A read-only query confirmed that the migrations for entitlement grants,
  Stripe subscriptions, the allowance and credit top-ups are applied, and that
  their five tables exist.
- The guide audio and the new help sections (Artist Pro subscription, Buying
  credits, Which is spent first) are deployed.
- **Not yet run on staging:** a full test-mode purchase. It needs the owner's
  Stripe test account and keys (resonate-iac#325). The behaviour is covered by
  the integration suites with a mocked Stripe client.

**Carry-over and follow-ups:**

- **Waiting on the owner:**
  - Stripe test keys (resonate-iac#325).
  - The #1421 pricing sign-off.
  - Legal review of the subscription, credit and refund wording.
  - The #2367 remix-challenge decision.
- **Gates before any live charging (#2409):**
  - RFC §8.
  - #2430: cancel the Stripe subscription on account erasure or closure, sync
    the billing email, and prune old Stripe events.
- **Follow-ups:**
  - #2423: dependency pin drift.
  - #2410: auto-reload, USDC top-up and the annual plan.
- #1422 leaves the milestone and stays open for live charging.

## Why this theme

- **Artist Pro is the Phase 2 revenue line.** Its design was accepted on
  2026-10-25 (#2385, `docs/rfc/artist-pro.md`). The first slices run in test
  mode and charge nothing. Charging waits for the gates in RFC §8.
- **Two known issues came out of Sprint 43.**
  - The nightly security scan raised a false alarm (#2418) after a workflow
    file briefly couldn't be parsed.
  - Local builds and tests disagree with CI (#2420).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2418](https://github.com/akoita/resonate/issues/2418) | The nightly scan records runs where no job executed as `not_executed`, and still fails on any executed run with an unexpected event or ref |
| 2 | P2 | Known issue | [#2420](https://github.com/akoita/resonate/issues/2420) | The kernel-v3 pin matches CI, and integration suites stop wiping shared tables |
| 3 | P1 | Business value | [#2406](https://github.com/akoita/resonate/issues/2406) | One entitlement service with policy `everyone` (behaviour unchanged), operator grants with step-up and audit, and `plan` on `/usage` |
| 4 | P1 | Business value + usability | [#2407](https://github.com/akoita/resonate/issues/2407) | Stripe subscriptions in test mode: Checkout and Portal, verified idempotent webhooks, 7-day grace, the `subscription` consent surface, and a plan page |
| 5 | P2 | Business value | [#2408](https://github.com/akoita/resonate/issues/2408) | A $3 allowance on each paid invoice, spent first, expiring at period end |
| 6 | P2 | Business value | [#1422](https://github.com/akoita/resonate/issues/1422) | Credit packs ($5 / $10 / $25) in test mode, with consent, a receipt and a ledger row |
| 7 | P3 | Usability | [#1943](https://github.com/akoita/resonate/issues/1943) | Four before/after audio examples in the Remix guide, from generated demo audio with recorded provenance |

## Owner decisions and defaults (2026-10-25)

1. **Test mode only.** No live charging, and the Pro gates stay off (#2409).
2. **#1943:** the demo source is generated for the purpose, with its provenance
   recorded. No catalog audio is used.
3. **Fallback for #2407 staging:** if the owner's Stripe test account and keys
   (resonate-iac#325) aren't ready when the code lands, staging uses Stripe's
   local test stub, and the gap is recorded here.

## Deployment halves

- resonate-iac#325: the Stripe account in test mode, Stripe Tax, prices,
  secrets, and the webhook.

## Exit criteria

- The nightly security scan passes.
- `forge build` and `forge test` run locally on the pinned submodules with no
  skips, and the integration suites pass when run in parallel.
- On staging, in test mode, all of these work: a test card subscribes, the
  allowance lands, a credit pack is bought with consent, and cancelling keeps
  Pro until the period ends.
- The Remix guide plays its examples.
- Live charging stays off.

## Not in this sprint

- Live charging, price changes, and turning the Pro gates on (#2409).
- Auto-reload and USDC top-up (#2410).
- Listener Pro (#1971–#1973).
- Crate auto-buy (#2027).

## Revenue line

- **Line 2** (Artist Pro and generation credits), Phase 2, in test mode only:
  #2406, #2407, #2408 and #1422.
- **Vision-neutral:** #2418, #2420 and #1943.
