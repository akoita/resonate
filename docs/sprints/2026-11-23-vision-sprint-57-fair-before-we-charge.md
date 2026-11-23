# Vision Sprint 57: Fair before we charge

**Status:** 🟡 Proposed on 2026-11-23.
**Milestone:** [Vision Sprint 57: Fair before we charge](https://github.com/akoita/resonate/milestone/55).
Issues also carry the `sprint:vision-57` label.
**Goal:** Every promise the refund policy makes about Artist Pro and credit
packs is something the app actually does. A person can withdraw in the app,
is refunded fairly when we close their account, is warned before erasure ends
their plan, is told how renewal works, and a card dispute changes what the
disputed payment bought.

## Why this theme

- **The last code gates before live charging.** The 2026-11-09 wording review
  (PR #2598) changed `docs/legal/refund-policy.md` and the consent text, and
  split the code halves into #2594–#2597. Until they ship, the policy
  describes several things as "planned". Artist Pro slice 5 (#2409) cannot
  turn the Pro gates on while that is true.
- **Rules already in force.** The EU online withdrawal function has applied
  since 2026-06-19 (Directive 2023/2673). The automatic-renewal notices are
  expected wherever US subscribers can sign up. Both are cheaper to build in
  test mode than to retrofit after the first real charge.
- **Small and checkable.** Each item is one or two PRs with tests, on the
  billing module and webhook that Sprint 44 built. The wording was decided by
  the owner on 2026-11-09, and the one placement question was settled on
  2026-11-23.

## Scope and order

| Order | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| 1 | Loss prevention | [#2596](https://github.com/akoita/resonate/issues/2596) Card disputes, Artist Pro half | The credit-pack half is PR #2619. This adds the Artist Pro half: while a dispute on an invoice is open, that paid period grants no Pro; a lost dispute ends it, a won dispute restores it. Billing reconciliation lists disputes and fees per month. The policy's chargeback paragraph switches from "planned" to built |
| 2 | Compliance | [#2594](https://github.com/akoita/resonate/issues/2594) Withdrawal button | A "Withdraw from contract" entry in Usage & Billing and on each held purchase, shown only while the right exists. Statement form, then a bare confirm button. Acknowledgement notice with the statement and UTC time. The refund starts by itself. Labels live in one place so an operator can localise them |
| 3 | Trust | [#2595](https://github.com/akoita/resonate/issues/2595) Closure refund and erasure warning | Operator closure records whether it is for a serious or repeated breach (audited). When it is not, a pro-rata Stripe refund for the unused days and a refund of unspent bought credits, idempotent and retried by the retention job. The delete-account confirmation shows the period-end warning when a subscription is active |
| 4 | Compliance | [#2597](https://github.com/akoita/resonate/issues/2597) Renewal notices | Subscription-start notice with price, interval and how to cancel; a yearly reminder; an extra reminder 15–45 days before an annual renewal; a price-change notice 7–30 days ahead; the Checkout Session links the terms and the refund policy |
| 5 | Stretch | Refund policy and `/help` pass | One closing PR that removes every remaining "planned" marker for the items above, after checking each against what shipped |

Order: #2596 first because #2619 is about to land and the Artist Pro half
reuses its dispute model. #2594 next because it is the rule already in force.
#2595 and #2597 are independent of each other.

**Deployment half:** none expected. The dispute events are already on the
Stripe webhook endpoint (resonate-iac#336), notices reuse the existing email
path, and everything stays in Stripe test mode. If an item needs a new
setting, it gets a cross-linked issue in the private infrastructure
repository.

**Still open elsewhere:** Sprint 54 (#2573 robustness re-run), Sprint 55
(#2581 spike, #2583 pilot, #2585 stretch) and Sprint 56 (#2606 items 2 and 3)
keep their milestones. This sprint does not depend on them.

## Owner decisions

1. **Where the erasure warning points.** Decided by the owner on 2026-11-23.
   The app has a single flow, "Delete your account", which erases after 30
   days, so the warning keeps the decided text and ends with: "If you want to
   keep using it until {period end}, cancel Artist Pro in Manage billing and
   delete your account after that date." A separate self-service closure is
   not planned.
2. **Legal check.** Unchanged from the 2026-11-09 review: a lawyer reads the
   withdrawal flow labels, the closure rule and the renewal notices before
   `BILLING_LIVE_MODE` is turned on.

## Exit criteria

- #2594, #2595, #2596 and #2597 closed with tests, and PR #2619 merged.
- `docs/legal/refund-policy.md` and `/help` describe each item as built, with
  no "planned" marker left for them.
- The User Guide covers the withdrawal entry and the erasure warning.
- Verified on staging in Stripe test mode: a withdrawal refund, a test
  dispute (won and lost) on a credit pack and on Artist Pro, and an operator
  closure refund.

## Not in this sprint

- Turning the Pro gates on (#2409): its other gates (pricing sign-off, legal
  review, VAT/OSS and Stripe Tax, a live Stripe account, a rollout decision)
  are outside the code.
- Auto-reload, USDC top-up and the annual plan (#2410).
- A separate self-service account closure (owner decision 1: not planned).

## Revenue line

ADR-BM-6: Line 2 (Artist Pro and generation credits) for all four items, and
Line 3 (marketplace) for withdrawal from held purchases in #2594. Phase 2.
Trust, compliance and loss prevention only. No fee, price, split or payout
change; ADR-BM-4 is untouched.
