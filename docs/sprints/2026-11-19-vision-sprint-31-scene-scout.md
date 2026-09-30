# Vision Sprint 31: Scene Scout v1

**Status:** Planned 2026-09-30, starts after Sprint 30 closes (indicative
2026-11-19 to 2026-12-09).
**Milestone:** _to be linked when created_.
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

## Exit criteria

- On staging, a demand card links to a prefilled Shows campaign draft for that
  city.
- No aggregate below `DISCOVERY_MIN_AUDIENCE` is shown, and a test proves it.
- Low-traffic releases show "not enough listening yet" rather than a guess.

## Revenue line

Line 2, Artist Pro, phase 2 (behind an entitlement seam, free for now); it
converts into Line 1 (Shows, 6%) and Line 3 (marketplace, 10%). Demand is never
a payout input (ADR-BM-4). No fee change.
