# Vision Sprint 58: Safe to show

**Status:** 🟡 Approved by the owner on 2026-11-25. First of three sprints to
the invitation-only preview.
**Milestone:** [56](https://github.com/akoita/resonate/milestone/56), due
2026-12-02.
**Goal:** The preview environment holds nothing it should not, no money can
move in it, and a newcomer can publish without a deposit.

## The road to the preview

The owner decided on 2026-11-25 that the next stage is a free,
invitation-only preview on the pre-production environment, and that work is
frozen to it. Opening a production environment is a separate stage, planned
and not scheduled (see "Production opening" below).

| Sprint | Theme | Due |
| --- | --- | --- |
| 58 | Safe to show (this sprint) | 2026-12-02 |
| [59](2026-12-03-vision-sprint-59-clear-for-newcomers.md) | Clear for newcomers | 2026-12-09 |
| [60](2026-12-10-vision-sprint-60-ready-to-show.md) | Ready to show | 2026-12-16 |

The dates are targets for the work, not a launch date.

**Freeze rule.** Until the preview is open, work is admitted only if it is in
one of these three sprints. The exceptions are security alerts, an incident,
and the marking of generated audio due on 2026-12-02 (Sprints 54 and 56).
Sprint 55 is paused. The purchase items of Sprint 56 (#2606 items 2 and 3)
wait, because buying is off in the preview.

## Why this theme

- **No money moves in the preview.** The payment surfaces stay in the code and
  are switched off. That needs switches the web app does not have today.
- **Masters are an archive, not a stream.** The player receives a streaming
  rendition, and the storage that holds originals is closed and recoverable.
- **A first release must not need a deposit.** Abuse by new accounts is slowed
  by upload limits instead.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2658](https://github.com/akoita/resonate/issues/2658) | One switch per money surface, enforced by the backend, off by default in production |
| 2 | P0 | Known issue | [#2661](https://github.com/akoita/resonate/issues/2661) | Streaming renditions; no public route returns an original file |
| 3 | P0 | Usability | [#2659](https://github.com/akoita/resonate/issues/2659) | Publishing without a deposit, with upload limits for new accounts |

Carried from Sprint 54 and still required: [#2573](https://github.com/akoita/resonate/issues/2573),
so that generation cannot be switched on without the mark.

**Dependencies.** #2658 has none and goes first, because Sprint 59 builds on
it. #2661 and #2659 are independent of each other.

**Capacity.** Recent sprints closed four to six issues in one or two days.
Engineering is not the limit; the operator's actions in the deployment halves
are.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#341: audio storage (companion to #2661).
- resonate-iac#342 and resonate-iac#248: preview data, a curated demo catalog
  and no test records.
- resonate-iac#322 and resonate-iac#212: running cost of the preview
  environment.
- resonate-iac#333: the watermark key.

## Exit criteria

- With every switch off, no screen offers a payment, a pledge, a purchase or a
  wallet action, and the matching routes refuse (tests).
- No public route returns the bytes of an original file (test), and the
  rendition backfill reports nothing remaining.
- A new account publishes a release with no balance, and the upload limit
  holds (tests).
- The User Guide, the feature pages and `docs/deployment/environment.md`
  describe what is built.

## Production opening (planned, not scheduled)

The work that only makes sense with a production environment is kept as its
own stage, with no date
([milestone 59](https://github.com/akoita/resonate/milestone/59)):

- [#2660](https://github.com/akoita/resonate/issues/2660): start-up guards
  that refuse development defaults in a production deployment, and a
  `config:check` script for the deploy pipeline. Deferred by the owner on
  2026-11-25, because the guards only act in production.
- [#1663](https://github.com/akoita/resonate/issues/1663): target
  configuration and cutover smoke against the production deployment.
- [#1667](https://github.com/akoita/resonate/issues/1667): the first
  protected software release, with its evidence.
- The deployment halves resonate-iac#339 (environment), resonate-iac#338
  (secrets and keys) and resonate-iac#340 (operations).

Nothing built in Sprints 58 to 60 is specific to the preview: the switches,
the renditions and the storage rules apply unchanged to a production
deployment.

## Not in this sprint

- Anything that charges money: live card billing, buying, pledging.
- Removing any payment feature from the code. They are switched off, not
  deleted.
- Creating a production environment.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral infrastructure, security and ingestion trust. #2659 removes a
deposit and adds no fee. No fee, split, price or payout change, and artists
keep at least 85% (ADR-BM-4).
