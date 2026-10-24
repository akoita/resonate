# Vision Sprint 42: Sell with confidence

**Status:** Owner-approved 2026-10-24; in progress. No due date: it closes when
its exit checks pass on staging.
**Milestone:** [44](https://github.com/akoita/resonate/milestone/44).
**Goal:** A consumer purchase is legally complete: consent to immediate
delivery is recorded, confirmed to the buyer and tied to the transaction.
Artists can sell official lossless stems with their source shown. The
platform's admin and indexing paths are fully hardened.

## Why this theme

- **The last gates before real money.**
  - The EU withdrawal right survives every consumer digital purchase until
    Resonate collects consent to immediate delivery, an acknowledgement, and a
    durable confirmation (#1776). That is also the legal gate for charging
    credits (#1421).
  - The worker cut-over needs a lease on the contract indexer (#2360).
  - The admin surfaces outside #2173 are not yet audited (#2362).
- **A reason for professionals to pay.**
  - Separated stems are available anywhere. Official lossless stems with a
    clear licence aren't (#1976, ADR-TE-7).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#1776](https://github.com/akoita/resonate/issues/1776) | A consumer purchase completes only with a recorded consent and acknowledgement (confirmed to the buyer, tied to the transaction), or with delivery held until the withdrawal period ends. The refund policy and Terms are updated |
| 2 | P1 | Known issue | [#2360](https://github.com/akoita/resonate/issues/2360) | The contract indexer holds a distributed lease |
| 3 | P1 | Known issue | [#2362](https://github.com/akoita/resonate/issues/2362) | The remaining admin surfaces are audited, the destructive ones step-up gated, and the deferred admin request bodies become DTOs |
| 4 | P2 | Known issue | [#2361](https://github.com/akoita/resonate/issues/2361) | Wallet fund and budget amounts are validated |
| 5 | P1 | Business value | [#1976](https://github.com/akoita/resonate/issues/1976) | Artists upload official lossless stems, delivered lossless, with "Official" or "Separated (AI)" shown wherever a stem is sold |
| 6 | P2 | Usability | [#2182](https://github.com/akoita/resonate/issues/2182) | An optional email step at onboarding, and contextual prompts; email is never required |
| 7 | P2 | New needs | [#1121](https://github.com/akoita/resonate/issues/1121) (scope check) | A written decision on the remix-challenge cockpit card |

Every prerequisite is closed: #1769, #1567, #1608, #2173, #2197, #1965, #2169
and #891.

## Owner decisions (2026-10-24)

1. **ADR-TE-7 is accepted as proposed:** a stem purchase sells a licence, and
   artists can supply official stems. Official and separated stems are priced
   separately by the artist, with no platform floor.
2. **#1776 surfaces:** stem and licence purchases, collectibles and drops, and
   future credit top-ups. x402 agent and MCP purchases (machine to machine) and
   Shows pledges (not digital content) are out of scope. This scoping is
   flagged for legal review.
3. **#1776 without consent:**
   - Off-chain deliveries are held until the 14-day period ends, and the buyer
     is shown when delivery will happen.
   - On-chain mints require consent before minting.
   - The consent wording is marked "for legal review before production".
4. **#2362:** destructive actions are step-up gated (takedowns, credit grants,
   recovery, maintenance resets and reindexing), and every admin action is
   audited.

## Deployment halves

None expected.

## Exit criteria

- The consent flow is enforced at the checkout boundary (tests), with a
  durable record and a buyer confirmation, and the refund policy and Terms
  are updated.
- The contract indexer is leased (a parallel-poller test).
- Every admin surface is audited, and the destructive ones are step-up gated
  (the route-set test is updated).
- Wallet amounts are validated.
- Official stems upload, validate and deliver lossless, with the source shown
  on the stem page, listing, quote and receipt.
- Optional email prompts work end to end.
- The #1121 scope decision is written.
- On staging, the new surfaces are in the deployed code.

## Not in this sprint

- Charging money: buying credits (#1422) waits on the #1421 sign-off and this
  consent flow.
- Fee or price changes.
- Listener Pro, Session DJ (#1971), crate auto-buy (#2027) and the Shows
  go-live (#1583).
- The #1774 regulatory question, which needs a qualified adviser.
- **Not counted:** the owner checks in #2154.

## Revenue line

- #1976: Line 3 (marketplace). No fee or split change; artists keep at least
  85% (ADR-BM-4).
- #1776: changes when a sale completes, not what it costs or who gets paid.
- The rest is vision-neutral security and quality.
