# Vision Sprint 60: First artists in

**Status:** 🟡 Approved by the owner on 2026-11-25. Third of three sprints to
the first production version. Starts when
[Sprint 59](2026-12-03-vision-sprint-59-clear-for-newcomers.md) closes.
**Milestone:** [58](https://github.com/akoita/resonate/milestone/58), due
2026-12-16.
**Goal:** Five artists rehearse the pilot, what they hit is fixed, and the
doors open.

## Why this theme

- **A rehearsal finds what tests do not.** Real artists, the real environment,
  the whole path from account to a played release.
- **Rights data starts at upload.** Composition details are collected from the
  first release, so that usage can be reported later.
- **The pilot exists to learn.** The operator reads the pilot measures on one
  page.
- **Readiness is a ledger, not a feeling.** #1595 is brought up to date and
  every blocking line is closed or accepted by the owner.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2672](https://github.com/akoita/resonate/issues/2672) | Rehearsal with five artists; blocking findings fixed |
| 2 | P0 | Known issue | [#1595](https://github.com/akoita/resonate/issues/1595) | Readiness ledger current; the go or no-go check is the owner's |
| 3 | P1 | New needs | [#2669](https://github.com/akoita/resonate/issues/2669) | Writers, publisher, society and work code at upload, with a usage export |
| 4 | P1 | Business value | [#2670](https://github.com/akoita/resonate/issues/2670) | Pilot measures on one admin page |
| 5 | P1 | Known issue | [#1667](https://github.com/akoita/resonate/issues/1667) | The first protected software release, with its evidence |
| 6 | P2 | Usability | [#2671](https://github.com/akoita/resonate/issues/2671) | Stretch: search in the top bar |

**Dependencies.** #2672 needs Sprints 58 and 59 closed and the production
deployment. #2670 needs #2662 for the invited-artist figure. #2669, #1667 and
#2671 are independent.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#340: restore drill, paging alerts, incident page, and the load
  check with resonate-iac#315.

## Exit criteria

- Five artists have each published a release, and each release has been
  played by an invited listener. Every blocking finding is closed.
- #1595 is current. Each blocking line is closed or explicitly accepted by
  the owner.
- Composition fields validate, and the usage export contains them (tests).
- The pilot measures have tests with seeded data.
- The milestone's release exists
  (`docs/sprints/releases/milestone-58.md`, "Close A Milestone" in
  `docs/operations/release_process.md`).

## After the pilot opens

When the freeze lifts, the next work in order is: the split sheet per track,
the artist statement export, card checkout with provider payouts, card pledges
for Shows, and the paid switch for Artist Pro (#2409, #1421). Sprint 55
resumes alongside.

## Not in this sprint

- Charging money, in any form.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral quality and operations, plus rights data for ingestion
(#2669). Nothing is charged or paid. No fee, split, price or payout change,
and artists keep at least 85% (ADR-BM-4).
