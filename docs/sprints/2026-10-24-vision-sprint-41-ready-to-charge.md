# Vision Sprint 41: Ready to charge, with honest money

**Status:** Owner-approved 2026-10-24; in progress. No due date: it closes when
its exit checks pass on staging.
**Milestone:** [43](https://github.com/akoita/resonate/milestone/43).
**Goal:** The owner has a measured, per-path pricing proposal for metered
generation to sign off; money reporting has no known gaps; admin actions need
a fresh passkey; and the staging API no longer has to run an always-on
instance.

## Why this theme

- **Business Model Phase 2 (Artist Pro + metered generation) is the current
  quarter** (`docs/strategy/business-model-review-2026-07.md`). Sprint 40 built
  the Usage & Billing foundation. Charging now waits only on pricing (#1421),
  whose remaining work is measurement and a priced proposal.
- **Trust before the first charge.** Artists' net received still has three
  gaps (#2344). Admin actions need a second factor (#2173), and some request
  bodies still bypass validation (#2197).
- **Cost.** The staging API stays always-on only to run the indexers (#1608).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2344](https://github.com/akoita/resonate/issues/2344) | The `RoyaltyPayment` batch collision is fixed, a dry-run-first backfill finalises legacy pending sales, and x402 net is shown as "entitled net" |
| 2 | P0 | New needs | [#1421](https://github.com/akoita/resonate/issues/1421) | A measured, per-path pricing proposal in the RFC, ready for the owner's sign-off |
| 3 | P1 | Usability | [#1933](https://github.com/akoita/resonate/issues/1933) | AI part takes get their own Usage & Billing line; totals are unchanged |
| 4 | P1 | Known issue | [#2173](https://github.com/akoita/resonate/issues/2173) | Step-up passkey for destructive admin actions, and one durable admin audit log |
| 5 | P2 | Known issue | [#2197](https://github.com/akoita/resonate/issues/2197) | The remaining interface-typed request bodies become class DTOs, with 400 tests |
| 6 | P2 | Business value | [#1608](https://github.com/akoita/resonate/issues/1608) | A separate indexer worker mode; the API runs no background loops when told not to |

Every prerequisite is closed: #2172, #1443, #1193, #1901, #2166, #1890 and
#1567. #1933 needs only the shipped #1422 registry slice.

## Owner decisions (2026-10-24)

1. **#2344:**
   - x402 net is reported as the quoted `netToSeller`, labelled "entitled
     net", until a per-sale artist payout fact exists.
   - The legacy backfill is dry-run first.
2. **#1421:**
   - The public RFC holds the model, the method, list prices and the proposed
     prices.
   - The measured billing figures stay private (resonate-iac).
   - Setting the final prices is the owner's decision.
3. **#2173:**
   - The step-up window is 5 minutes.
   - The `/admin` network restriction is documented, not adopted.
4. **#1608:** one image, with a mode flag (API or indexer worker).

## Deployment halves

- [resonate-iac#320](https://github.com/akoita/resonate-iac/issues/320): the
  measured billing figures for the cost model (#1421).
- [resonate-iac#321](https://github.com/akoita/resonate-iac/issues/321): the
  legacy pending-sale backfill run (#2344).
- [resonate-iac#322](https://github.com/akoita/resonate-iac/issues/322): the
  indexer worker service, and the API at minimum 0 (#1608).

## Exit criteria

- The pricing proposal is ready for the owner's sign-off.
- The `RoyaltyPayment` collision fix and the backfill are tested, and the
  backfill dry run is reviewed. x402 net is shown with honest wording.
- Step-up protection rejects a stale session (tests), and the audit log
  records admin actions.
- No interface-typed `@Body()` remains in the audited modules.
- The API can run with no background loops (test), and the worker mode runs
  them.
- On staging, the new surfaces are in the deployed code.
- The User Guide, feature pages and `docs/deployment/environment.md` describe
  what is built.

## Not in this sprint

- Charging money: Stripe, buying credits (#1422), subscriptions.
- Listener Pro (#1972) and Remix Studio S6 (#1903).
- The cockpit's remix challenge launch (#1121), which needs a scope check
  first.
- Adopting the `/admin` network restriction.
- **Not counted:** the owner checks in #2154.

## Revenue line

- #1421: revenue Line 2 (metered generation), Phase 2 pricing groundwork.
  Nothing is charged.
- #2344: reporting for Line 3 (marketplace) and x402.
- The others are vision-neutral infrastructure, security and quality.
- No fee, split, price or payout change, and artists keep at least 85%
  (ADR-BM-4).
