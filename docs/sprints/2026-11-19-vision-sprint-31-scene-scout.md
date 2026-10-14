# Vision Sprint 31: Scene Scout v1

**Status:** Closed 2026-10-14. All four approved items are closed and their
work is merged on `main`; the original sprint window was indicative
(2026-11-19 to 2026-12-09). Two staging checks carry over to
[resonate-iac#264](https://github.com/akoita/resonate-iac/issues/264).
**Milestone:** [33](https://github.com/akoita/resonate/milestone/33).
**Release:** [Milestone 33 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-33-vision-sprint-31-scene-scout)
records the closed application milestone, not a software version or deployment
event.
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

## Delivery status (2026-10-14)

| Issue | Status | Where |
| --- | --- | --- |
| #1968 | `implemented` | #2044: thresholded city demand and the cockpit card with an editable Shows prefill. #2054 keeps validated release context on drafts; #2058 and #2104 add consent-qualified, indexer-confirmed pledge city demand with optional browser entry; #2105 counts canonical follows. #2128 / #2129 let artists save the drafts the card opens: the artist-side Shows routes now authorize by profile ownership instead of a JWT role that was never issued |
| #1969 | `implemented` | #2046: categorical request and session shortfalls with catalog supply actions. #2127 logs the bounded demand-observation purge |
| #1970 | `implemented` | #2047: capped, taste-fitting first-listener placement and day-seven reception; #2048 UI polish; #2105 adds follows to reception |
| #1450 | `implemented` | #2045: popularity and engagement marts with a bounded serving export; #2106 and #2107 are GoogleSQL fixes. Scheduling and live checks are done in resonate-iac#263 |

Acceptance tooling: #2071 (city-card fixtures), #2110 and #2113 (consent,
erasure, unmet-demand and access phases), #2125 (first-listener and reception
phases).

## Exit criteria

- On staging, a demand card links to a prefilled Shows campaign draft for that
  city.
- No aggregate below `DISCOVERY_MIN_AUDIENCE` is shown, and a test proves it.
- Low-traffic releases show "not enough listening yet" rather than a guess.

## Exit criteria evidence

All three criteria were checked on staging against synthetic fixtures and a
signed-in artist session (evidence is tracked privately with the deployment):

- A demand card opens a prefilled Shows draft for the city, and the draft saves
  with its source release, keeps it across edits, and drops it when an
  uncredited artist is chosen.
- No aggregate below `DISCOVERY_MIN_AUDIENCE` is shown: a test proves it, and
  the live consent-withdrawal, erasure and day-seven reception phases confirm it.
- Low-traffic releases show "not enough" copy instead of a guess.

## Carry-over and next milestone

- Cross-artist access as a real second artist (needs a second artist account).
- The demand-retention drain, observable once demand observations start
  expiring on 2026-11-01. Retention already runs daily.
- Optional live checks of the unverified and fully AI first-listener exclusions
  once such a fresh release exists; integration tests cover both.

All three are tracked in resonate-iac#264. Epic #1952 stays open. Next in the
approved sequence:
[Vision Sprint 32: purchased stems ready to remix](2026-10-03-vision-sprint-32-purchased-stems.md)
(milestone 34).

## Revenue line

Line 2, Artist Pro, phase 2 (behind an entitlement seam, free for now); it
converts into Line 1 (Shows, 6%) and Line 3 (marketplace, 10%). Demand is never
a payout input (ADR-BM-4). No fee change.
