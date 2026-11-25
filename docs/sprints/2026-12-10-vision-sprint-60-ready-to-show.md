# Vision Sprint 60: Ready to show

**Status:** 🟡 Approved by the owner on 2026-11-25. Third of three sprints to
the invitation-only preview. Starts when
[Sprint 59](2026-12-03-vision-sprint-59-clear-for-newcomers.md) closes.
**Milestone:** [58](https://github.com/akoita/resonate/milestone/58), due
2026-12-16.
**Goal:** A few invited artists rehearse the preview, what they hit is fixed,
and the product can be shown to anyone from a cold start.

## Why this theme

- **A rehearsal finds what tests do not.** Real artists, the preview
  environment, the whole path from account to a played release.
- **Rights data starts at upload.** Composition details are collected from the
  first release, so that usage can be reported later.
- **The preview exists to learn.** The operator reads the preview measures on
  one page.
- **Readiness is a ledger, not a feeling.** #1595 is brought up to date and
  split into what blocks the preview and what waits for the production
  opening.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2672](https://github.com/akoita/resonate/issues/2672) | Rehearsal with three to five invited artists; blocking findings fixed |
| 2 | P0 | Known issue | [#1595](https://github.com/akoita/resonate/issues/1595) | Readiness ledger current, with preview lines and production-opening lines told apart |
| 3 | P1 | New needs | [#2669](https://github.com/akoita/resonate/issues/2669) | Writers, publisher, society and work code at upload, with a usage export |
| 4 | P1 | Business value | [#2670](https://github.com/akoita/resonate/issues/2670) | Preview measures on one admin page |
| 5 | P2 | Usability | [#2671](https://github.com/akoita/resonate/issues/2671) | Stretch: search in the top bar |

**Dependencies.** #2672 needs Sprints 58 and 59 closed. #2670 needs #2662 for
the invited-artist figure. #2669 and #2671 are independent.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#315: the load check for the preview environment.

## Exit criteria

- At least three artists have each published a release, and each release has
  been played by an invited listener. Every blocking finding is closed.
- #1595 is current. Each line that blocks the preview is closed or explicitly
  accepted by the owner, and each remaining line is marked for the production
  opening.
- Composition fields validate, and the usage export contains them (tests).
- The preview measures have tests with seeded data.
- The milestone's release exists
  (`docs/sprints/releases/milestone-58.md`, "Close A Milestone" in
  `docs/operations/release_process.md`).

## After the preview opens

The production opening is planned and not scheduled; its items are listed in
[Sprint 59](2026-12-03-vision-sprint-59-clear-for-newcomers.md#production-opening-planned-not-scheduled).
After it, the next work in order is: the split sheet per track, the artist
statement export, card checkout with provider payouts, card pledges for Shows,
and the paid switch for Artist Pro (#2409, #1421). Sprint 55 resumes when the
freeze lifts.

## Not in this sprint

- Charging money, in any form.
- Creating a production environment, and the first protected release
  (#1667), which belongs to the production opening.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral quality and operations, plus rights data for ingestion
(#2669). Nothing is charged or paid. No fee, split, price or payout change,
and artists keep at least 85% (ADR-BM-4).
