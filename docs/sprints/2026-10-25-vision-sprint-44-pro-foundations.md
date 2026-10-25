# Vision Sprint 44: Pro foundations, in test mode

**Status:** owner-approved 2026-10-25, including the defaults; in progress. There
is no due date: the sprint closes when its exit checks pass on staging.
**Milestone:** [46](https://github.com/akoita/resonate/milestone/46).
**Goal:** On staging, in Stripe **test mode**, an artist can subscribe to Artist
Pro, receive the monthly allowance and buy credits from start to finish, with
access decided by one entitlement service. No real money is charged. The
nightly security scan is trustworthy again, and local validation matches CI.

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
