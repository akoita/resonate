# Vision Sprint 58: Safe to open

**Status:** 🟡 Approved by the owner on 2026-11-25. First of three sprints to
the first production version.
**Milestone:** [56](https://github.com/akoita/resonate/milestone/56), due
2026-12-02.
**Goal:** Production exists, holds nothing it should not, and no money can
move in it.

## The road to the first production version

The owner decided on 2026-11-25 that the first production version is a free,
invitation-only pilot, and that work is frozen to it:

| Sprint | Theme | Due |
| --- | --- | --- |
| 58 | Safe to open (this sprint) | 2026-12-02 |
| [59](2026-12-03-vision-sprint-59-clear-for-newcomers.md) | Clear for newcomers | 2026-12-09 |
| [60](2026-12-10-vision-sprint-60-first-artists-in.md) | First artists in | 2026-12-16 |

**Freeze rule.** Until the pilot is open, work is admitted only if it is in
one of these three sprints. The exceptions are security alerts, an incident,
and the marking of generated audio due on 2026-12-02 (Sprints 54 and 56).
Sprint 55 is paused. The purchase items of Sprint 56 (#2606 items 2 and 3)
wait, because buying is off in the pilot.

## Why this theme

- **No money moves in the pilot.** The payment surfaces stay in the code and
  are switched off. That needs switches the web app does not have today.
- **Masters are an archive, not a stream.** The player receives a streaming
  rendition, and the storage that holds originals is closed and recoverable.
- **Production must refuse development defaults.** A missing setting stops the
  service instead of falling back to a mock or a shared key.
- **A first release must not need a deposit.** Abuse by new accounts is slowed
  by upload limits instead.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2658](https://github.com/akoita/resonate/issues/2658) | One switch per money surface, enforced by the backend, off by default in production |
| 2 | P0 | Known issue | [#2661](https://github.com/akoita/resonate/issues/2661) | Streaming renditions; no public route returns an original file |
| 3 | P0 | Known issue | [#2660](https://github.com/akoita/resonate/issues/2660) | Production start-up guards and a `config:check` script for the deploy pipeline |
| 4 | P0 | Usability | [#2659](https://github.com/akoita/resonate/issues/2659) | Publishing without a deposit, with upload limits for new accounts |
| 5 | P1 | Business value | [#1663](https://github.com/akoita/resonate/issues/1663) | Target configuration and smoke proven against the production deployment |

Carried from Sprint 54 and still required: [#2573](https://github.com/akoita/resonate/issues/2573),
so that generation cannot be switched on in production without the mark.

**Dependencies.** #2658 has none and goes first, because Sprint 59 builds on
it. #2661, #2660 and #2659 are independent of each other. #1663 needs the
production deployment, which is the deployment half.

**Capacity.** Recent sprints closed four to six issues in one or two days.
Engineering is not the limit; the operator's actions in the deployment halves
are.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#341: audio storage (companion to #2661).
- resonate-iac#338: production secrets and keys (companion to #2660).
- resonate-iac#339: production bootstrap at pilot size, with an empty
  database, and the production values for #2658, #2659 and #2662.
- resonate-iac#333: the watermark key for production.

## Exit criteria

- With every switch off, no screen offers a payment, a pledge, a purchase or a
  wallet action, and the matching routes refuse (tests).
- No public route returns the bytes of an original file (test), and the
  rendition backfill reports nothing remaining.
- Production refuses to start on each unsafe default (tests), and the deploy
  pipeline runs the check.
- A new account publishes a release with no balance, and the upload limit
  holds (tests).
- The application answers in production with an empty catalog, and the smoke
  evidence is recorded.
- The User Guide, the feature pages and `docs/deployment/environment.md`
  describe what is built.

## Not in this sprint

- Anything that charges money: live card billing, buying, pledging.
- Removing any payment feature from the code. They are switched off, not
  deleted.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral infrastructure, security and ingestion trust. #2659 removes a
deposit and adds no fee. No fee, split, price or payout change, and artists
keep at least 85% (ADR-BM-4).
