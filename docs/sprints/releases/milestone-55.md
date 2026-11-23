# Vision Sprint 57

Fair before we charge: every promise the refund policy makes about Artist Pro and credit packs is now something the app does, in Stripe **test mode**. No real money is charged, and the Pro gates stay off.

- **Card disputes on Artist Pro:** while a dispute on an invoice is open or lost, that paid period grants no Pro. A won dispute restores it. Disputes appear in the monthly reconciliation.
- **Withdraw from contract:** an entry in Usage & Billing for Artist Pro within 14 days and for held credit packs, with these steps:
  - a statement form, then a bare confirmation;
  - an acknowledgement with the UTC time;
  - an automatic Stripe refund, retried until it goes through.
- **Fair closure:**
  - An operator closure records whether it is for a serious breach. If it is not, the unused days and the unspent bought credits are refunded.
  - Deleting an account while Artist Pro runs first shows how to keep it until the period ends.
- **Renewal notices:**
  - an acknowledgement when Artist Pro starts;
  - a yearly reminder;
  - a reminder 15 to 45 days before an annual renewal;
  - a price-change notice 7 to 30 days ahead.

  Checkout links the terms and the refund policy.

Application milestone: [#55](https://github.com/akoita/resonate/milestone/55). All four slices and the stretch shipped. This is a changelog for the milestone, not a software version or deployment event.

## Shipped work

- [#2596](https://github.com/akoita/resonate/issues/2596): card disputes (credit packs and Artist Pro).
- [#2594](https://github.com/akoita/resonate/issues/2594): in-app withdrawal. Held on-chain purchases are tracked in [#2642](https://github.com/akoita/resonate/issues/2642).
- [#2595](https://github.com/akoita/resonate/issues/2595): closure refund and erasure warning.
- [#2597](https://github.com/akoita/resonate/issues/2597): renewal notices and Checkout terms links.

## Merged pull requests

[#2653](https://github.com/akoita/resonate/pull/2640) (plan), [#2619](https://github.com/akoita/resonate/pull/2619), [#2641](https://github.com/akoita/resonate/pull/2641), [#2643](https://github.com/akoita/resonate/pull/2643), [#2644](https://github.com/akoita/resonate/pull/2644), [#2646](https://github.com/akoita/resonate/pull/2646), [#2647](https://github.com/akoita/resonate/pull/2647) (closure).

## Carry-over and owner decisions

- A manual Stripe test-mode walk-through: a withdrawal refund, won and lost disputes, and a closure refund.
- A lawyer reads the withdrawal labels, the closure rule and the renewal notices before live charging. This is not legal advice. Tracked in [#2649](https://github.com/akoita/resonate/issues/2649).
- [#2642](https://github.com/akoita/resonate/issues/2642): withdrawal from held on-chain purchases, with no milestone yet.
- The next milestone is not yet selected.
