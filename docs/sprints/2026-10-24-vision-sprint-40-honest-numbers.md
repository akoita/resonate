# Vision Sprint 40: Honest numbers, toward Artist Pro

**Status:** Approved 2026-10-24 under the owner's delegated authority (overnight
run); in progress. Decisions taken on the owner's behalf are recorded on each
issue as overridable defaults. No due date: it closes when its exit checks pass
on staging.
**Milestone:** [42](https://github.com/akoita/resonate/milestone/42).
**Goal:** Artists see what they actually received, everyone sees what their
metered actions use in one place, catalog attestation has a durable artist
signal, and agent analytics store no free text. This is the groundwork for
Business Model Phase 2 that needs no pricing decision.

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
