# Vision Sprint 41: Ready to charge, with honest money

**Status:** Closed 2026-10-24. Five issues are closed. #1421 delivered its
pricing proposal and stays open for the owner's sign-off. Verified on staging at
`35a2ea14`.
**Milestone:** [43](https://github.com/akoita/resonate/milestone/43).
**Goal:** The owner has a measured, per-path pricing proposal for metered
generation to sign off; money reporting has no known gaps; admin actions need
a fresh passkey; and the staging API no longer has to run an always-on
instance.

## Outcome

The trust-and-readiness work is in place. The pricing proposal now waits for
the owner's decision and the private billing reconciliation.

| Issue | Result | PR |
| --- | --- | --- |
| #1421 | Pricing proposal in `docs/rfc/generation-cost-model.md`. It finds that the flat 10¢/30 s over-charges per-song models about 5× and under-charges cold GPU renders. It proposes Lyria 2 at 10¢/30 s, Lyria 3 Pro at 13¢ per song, Lyria 3 Clip at 6¢ per song, and the GPU paths at 5¢ per request + 4¢/30 s, plus a $5 minimum top-up and a legal gate. The canonical price is unchanged | #2351 (proposal; sign-off pending) |
| #2344 | `RoyaltyPayment` keyed on the log, so batched royalties are kept; a dry-run-first legacy split backfill; x402 **entitled net**, with the quote now recorded at sale time and labelled "Entitled — owed to you" | #2359 |
| #2173 | Step-up confirmation for suspend, close and broadcast: a fresh wallet or passkey signature, a 5-minute purpose-bound proof, and a global guard. One durable admin audit log with an outcome and an admin view | #2356 |
| #1933 | AI part takes have their own Usage & Billing line; totals unchanged | #2352 |
| #2197 | About 70 request bodies moved to class DTOs, with 400 tests and a guard test that fails on any new unvalidated body | #2357 |
| #1608 | `BACKEND_RUNTIME_MODE` (`combined` / `api` / `worker`): one image, one gate over every background loop | #2358 |

**Unplanned:** #2355. The validation audit found two indexer maintenance routes
without authentication (a finding already recorded in the repository's audit
report). They now require an admin session.

**Staging verification (2026-10-24, `35a2ea14`):**

- The indexer maintenance routes, step-up challenge, audit log and usage
  summary answer 401 without a sign-in. The indexer status stays public and
  shows the indexer healthy, so the default `combined` mode still runs the
  loops.
- The deployed code contains the Audit Log page and the entitled-net wording.
- The two migrations (audit outcome, `RoyaltyPayment` log key) were applied by
  the deploy.

**Carry-over and follow-ups:**

- **Waiting on the owner:** #1421 sign-off, after the private billing
  reconciliation and the legal gate.
- **Deployment halves:**
  - resonate-iac#320: billing figures;
  - resonate-iac#321: the backfill run;
  - resonate-iac#322: the worker cut-over and the API at minimum 0.
- **Follow-ups:**
  - #2360: a lease for the contract indexer;
  - #2361: wallet amount value rules;
  - #2362: step-up and audit for the remaining admin surfaces.
- The next sprint is not yet selected.

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
