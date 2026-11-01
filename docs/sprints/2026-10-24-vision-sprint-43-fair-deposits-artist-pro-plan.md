# Vision Sprint 43: Fair deposits, and the Artist Pro plan

**Status:** ✅ Closed 2026-11-01. Five of six items closed (#2384, #1759,
#2385, #2380, #1846). #2379 shipped its partial-package, test and screenshot
slice (#2393) and package withdrawal (#2512); only threshold tuning on real
uploads stays open, and it is data-gated, so it moves to the backlog with no
sprint.
**Milestone:** [45](https://github.com/akoita/resonate/milestone/45).
**Goal:** Artists see their Content Protection stake in its real unit and can
take their own deposit back without an operator. Artist Pro, the current-quarter
revenue line, gets a design the owner can approve. The last admin money-release
gaps and the official-stems gaps are closed.

## Why this theme

- **A deposit should read as what it is, and come back without asking.**
  - The stake is normally $5 in USDC, but every stake view reads it as 18-decimal
    ETH and shows "5e-12 ETH" (#2384, first reported in #1752).
  - Only an operator can return a stake (`refundStake` is `onlyOwner`), so the
    wallet has no working Withdraw button (#1759).
- **Artist Pro is Phase 2 (Oct–Dec 2026)** in
  `docs/strategy/business-model-review-2026-07.md`.
  - The pieces exist: the generation meter, Usage & Billing, the cockpit, and
    the gates for Remix Pro and Crate Pro.
  - The product, its single entitlement service and the billing rail are not
    designed. Buying credits (#1422) waits on that and on the pricing sign-off
    (#1421).
- **Follow-ups from Sprint 42.**
  - Releasing money as an operator should need the same passkey confirmation
    as the other destructive admin actions (#2380).
  - Official stems should accept partial packages (#2379).
  - The User Guide screenshots predate the current UI (#1846).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2384](https://github.com/akoita/resonate/issues/2384) | Every stake view shows the stake in its real unit (for example "5 USDC"), and aggregates never add amounts in different assets together |
| 2 | P1 | Business value | [#1759](https://github.com/akoita/resonate/issues/1759) | An artist claims an eligible stake with no operator action. A disputed stake is locked by the dispute flow. Deadlines are per token, with existing stakes migrated. One-click upgrade actions and a runbook are in place, and the wallet's Withdraw button works again |
| 3 | P1 | New needs | [#2385](https://github.com/akoita/resonate/issues/2385) | The Artist Pro design (bundle, one entitlement service, billing rail, buy-credits flow, sequencing) is merged, and the owner's decision list is posted. No charging |
| 4 | P1 | Known issue | [#2380](https://github.com/akoita/resonate/issues/2380) | Shows money-release actions and x402 mark-refunded need passkey step-up. Admin branches inside user routes are audited |
| 5 | P2 | Business value | [#2379](https://github.com/akoita/resonate/issues/2379) (part) | Partial official packages are accepted and checked part by part. The test gaps are closed and the screenshots captured. Threshold tuning stays open |
| 6 | P3 | Usability | [#1846](https://github.com/akoita/resonate/issues/1846) | The Shows, campaign and Marketplace User Guide screenshots are recaptured from seeded, representative data |

## Owner decisions (2026-10-24)

1. **#1759 fail-safe:** once escrow plus 180 days have passed, the attester can
   claim even if the stake is locked by a dispute. Before that, the dispute
   lock wins.
2. **#2379 partial packages:** allowed. Each part is checked on its own
   (length, and envelope alignment with the mix). The summed-level check
   applies only to a full set.
3. **#2380:** all four money-release operator actions need a fresh passkey
   step-up.
4. **#1846:** recapture from a seeded local instance (option B), not from
   hosted data.

## Deployment halves

- resonate-iac#324: the staging upgrade of `ContentProtection` (and
  `DisputeResolution` if needed), the escrow backfill and the lock
  authorization, for #1759.

## Exit criteria

- On staging, the release card, My Stakes, the badge, the staking overview and
  the dispute views show stakes in their real unit.
- An artist can claim an eligible stake from the wallet. Invariant and fuzz
  tests show that a stake under an open dispute cannot be drained before
  resolution or the fail-safe. The storage layout is verified before the
  upgrade.
- The Artist Pro design is merged, its decision list is posted on #2385, and
  follow-up issues are filed or explicitly deferred.
- The #2380 routes are step-up gated, and the route-set and audit-coverage
  tests are updated.
- A partial official package passes its checks, and the new tests pass.
- The three User Guide screenshots show no QA records or expired campaigns.
- The new code is deployed to staging.

## Not in this sprint

- Charging money:
  - buying credits (#1422) waits on #1421 and the #2385 decisions;
  - a Stripe integration;
  - fee or price changes.
- Crate auto-buy (#2027), which now also carries #2378's standing delivery
  choice.
- Listener Pro, Session DJ and the taste passport (#1971–#1973), which are gated
  on weekly listeners.
- Remix challenges (#2367, waiting on the owner), the Shows go-live (#1583) and
  the #1774 regulatory question.
- **Not counted:** the owner checks in #2154 and #2121.

## Revenue line

- #2384 and #1759: vision-neutral quality and infrastructure. A deposit
  returning to its owner is not a yield product (ADR-BM-4).
- #2385: line 2 (Artist Pro and generation credits), Phase 2, design only.
- #2379: line 3 (marketplace). No fee or split change.
- #2380 and #1846: vision-neutral.
