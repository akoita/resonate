# Vision Sprint 40: Honest numbers, toward Artist Pro

**Status:** Closed 2026-10-24. Three issues are closed. #1422 shipped its
Sprint 40 slice and stays open for buying credits, which waits on the owner's
pricing (#1421). Verified on staging at `3ef74447`. The sprint was approved and
run under the owner's delegated authority overnight.
**Milestone:** [42](https://github.com/akoita/resonate/milestone/42).
**Goal:** Artists see what they actually received, everyone sees what their
metered actions use in one place, catalog attestation has a durable artist
signal, and agent analytics store no free text. This is the groundwork for
Business Model Phase 2 that needs no pricing decision.

## Outcome

The groundwork that needs no pricing decision is in place, and nothing is
charged.

| Issue | Result | PR |
| --- | --- | --- |
| #2172 | Net received per marketplace sale beside gross. The split is finalised from the indexed `RoyaltyPaid` and the fee rate at the sale block, and a sale stays **pending** until both are proven, never shown as 0 or the gross. Proven against real on-chain balances (Anvil) | #2345 |
| #1422 | Slice: one registry for metered costs and limits, read by the enforcers (no numbers changed); per-kind 30-day spend; a limit meter in Remix Studio; the dead "Auto-reload" button removed; "How credits are granted today" explained | #2343 (partial) |
| #2258 | MusicBrainz id, Wikidata QID, match confidence and match time stored on the artist; attestation prefers them over URL-host inference | #2342 |
| #2337 | Agent analytics store unmet-intent keys only and no track titles; a hostile-payload test covers every agent event | #2340 |

**Unplanned:** #2339 (sprint plan). A migration timestamp clash between #2258
and #2172 was renamed before merge.

**Staging verification (2026-10-24, `3ef74447`):**

- The deployed code contains:
  - Net received;
  - "How credits are granted today";
  - "Spend by action".
- The usage summary answers 401 without a sign-in.
- The three migrations (analytics session index, artist external ids, sale
  split columns) were applied by the deploy.

**Carry-over and follow-ups:**

- #1422: buy credits, auto-reload and Stripe, after #1421 (pricing, the
  owner's decision) and #1193.
- #2344: x402 net received, legacy pending sales, and an existing
  `RoyaltyPayment` batch collision.
- The next sprint is not yet selected.

## Why this theme

- **Business Model Phase 2 (Artist Pro + metered generation) is the current
  quarter** in `docs/strategy/business-model-review-2026-07.md`. Charging
  depends on the owner's pricing (#1421) and #1193. The surface and the
  metering it needs do not.
- **Artists see gross sales but not what they received** (#2172).
  Reporting the real figure is a trust prerequisite for any paid tier.
- **The AI DJ work of Sprints 36–39 is complete for now.** Its last privacy
  follow-up (#2337) rides along.

## Approved scope

| Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| P0 | Business value | [#2172](https://github.com/akoita/resonate/issues/2172) | Net received per sale beside gross; a sale whose split isn't indexed yet shows pending |
| P0 | Usability / new needs | [#1422](https://github.com/akoita/resonate/issues/1422) (slice) | A registry of metered actions, one usage endpoint, a reusable meter on Create and Remix Studio, and a Usage & Billing page. No real-money purchase |
| P1 | Known issue | [#2258](https://github.com/akoita/resonate/issues/2258) | MusicBrainz and Wikidata ids persisted with match confidence; attestation prefers them |
| P1 | Known issue | [#2337](https://github.com/akoita/resonate/issues/2337) | Agent analytics store filter keys, never typed values or titles |

## Decisions taken under delegated authority (2026-10-24)

1. **#1422:** no Buy credits, auto-reload or Stripe until the owner decides
   pricing (#1421). The page says how credits are granted today, with no dead
   purchase button. The registry reads today's costs; it doesn't set new ones.
2. **#2172:** read-only reporting from indexed facts; pending is never shown as
   0 or as gross.
3. **#2258:** stored ids are preferred, URL-host inference is the fallback, and
   there is no forced backfill.

## Deployment halves

None expected. No item needs new deployment configuration.

## Exit criteria

- Net received matches on-chain amounts for a split sale (integration test
  against Anvil), and pending is shown honestly.
- The usage endpoint and page show balance, limit windows and per-kind usage.
  The registry is pinned to today's costs.
- The attestation report classifies on stored ids.
- No `agent.*` analytics mapping stores free text (test).
- On staging, the new surfaces are in the deployed code.
- The User Guide and feature pages describe what is built.

## Not in this sprint

- Charging money: Buy credits, auto-reload, subscriptions, any fee change.
- The pricing model (#1421, the owner's decision).
- Listener Pro (#1972).

## Revenue line

- #2172: reporting for Line 3 (marketplace) and x402.
- #1422: Line 2 (creator tools / metered generation) groundwork; nothing is
  charged.
- No fee, split, price or payout change, and artists keep at least 85%
  (ADR-BM-4).
