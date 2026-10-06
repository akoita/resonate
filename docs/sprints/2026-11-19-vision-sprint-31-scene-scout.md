# Vision Sprint 31: Scene Scout v1

**Status:** Initial application slices are merged; remaining signal work and
acceptance are in progress. The original sprint window was indicative (2026-11-19 to 2026-12-09).
**Milestone:** [33](https://github.com/akoita/resonate/milestone/33).
**Goal:** An artist sees where real demand for a release is and gets one
concrete next action for it.

Direction: [RFC: Taste Engine §6](../rfc/taste-engine.md) ·
[milestone plan](../roadmap/2026-10-taste-engine-milestones.md) · epic
[#1952](https://github.com/akoita/resonate/issues/1952).

## Approved scope and order

| Priority | Issue | Outcome |
| --- | --- | --- |
| P0 | [#1968](https://github.com/akoita/resonate/issues/1968) | Listening-demand cards in the existing artist action cockpit ([#1121](https://github.com/akoita/resonate/issues/1121)) |
| P1 | [#1969](https://github.com/akoita/resonate/issues/1969) | "Searched but missing" demand from crates and short sessions |
| P1 | [#1970](https://github.com/akoita/resonate/issues/1970) | First-listeners exploration slot and reception summary |
| P2 | [#1450](https://github.com/akoita/resonate/issues/1450) | Popularity and engagement marts |

#1121 hosts the cards and keeps its own remaining tail; it is linked, not
admitted.

## Delivery status

- **#1968:** city-demand backend, cockpit card and editable Shows prefill are
  merged in [PR #2044](https://github.com/akoita/resonate/pull/2044), with privacy, API, browser and help coverage.
  [PR #2054](https://github.com/akoita/resonate/pull/2054) preserves validated
  release context when saving and editing a Show draft. The next continuation
  adds consent-governed API pledge city declarations and indexer-qualified demand,
  and the Shows pledge panel now offers optional, consent-gated browser city
  entry; canonical follows remain open.
- **#1969:** categorical request/session shortfalls and catalog supply actions
  are merged in [PR #2046](https://github.com/akoita/resonate/pull/2046).
- **#1970:** taste-fitting fresh release selection and day-seven reception are
  merged in [PR #2047](https://github.com/akoita/resonate/pull/2047), with
  exposure/privacy coverage; [PR #2048](https://github.com/akoita/resonate/pull/2048)
  contains the follow-on UI polish.
- **#1450:** application materialization/export is merged in
  [PR #2045](https://github.com/akoita/resonate/pull/2045). Scheduling and live
  warehouse checks are tracked privately in
  [resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263).

Staging acceptance remains open in
[resonate-iac#264](https://github.com/akoita/resonate-iac/issues/264), and
warehouse scheduling and live checks remain open in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263). Canonical
follows are still unavailable without a follow ledger event; pledge demand
requires canonical release attribution, an indexer-confirmed pledge and a
consent-governed backer city declaration, which the Shows pledge panel now collects as an optional field. The linked parent
feature remains open until acceptance and its remaining signal families are
resolved.

## Exit criteria

- On staging, a demand card links to a prefilled Shows campaign draft for that
  city.
- No aggregate below `DISCOVERY_MIN_AUDIENCE` is shown, and a test proves it.
- Low-traffic releases show "not enough listening yet" rather than a guess.

## Revenue line

Line 2, Artist Pro, phase 2 (behind an entitlement seam, free for now); it
converts into Line 1 (Shows, 6%) and Line 3 (marketplace, 10%). Demand is never
a payout input (ADR-BM-4). No fee change.
