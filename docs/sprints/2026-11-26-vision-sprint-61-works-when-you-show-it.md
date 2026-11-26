# Vision Sprint 61: Works when you show it

**Status:** ✅ Closed on 2026-11-26 (all three items and the first slice of
the stretch item merged). Runs alongside
[Sprint 60](2026-12-10-vision-sprint-60-ready-to-show.md), whose rehearsal
waits on invited artists. #1121 stays open, with no milestone, for its
remaining recommendation work. Release notes:
[milestone-60](releases/milestone-60.md).
**Milestone:** [60](https://github.com/akoita/resonate/milestone/60), due
2026-12-23.
**Goal:** When an artist or a partner first looks at the preview, the
features they are shown work end to end, with no step that says "not built
yet".

## Why this theme

- **Consent has to be a real step.** An artist can already say "ask me before
  AI-assisted remixes of my music are shared", but there is no way to ask or
  answer. Today that choice silently keeps every remix a private draft.
- **Artists look at their numbers.** Shows interest and stem previews are
  collected or shown elsewhere, but not where an artist looks.
- **A dashboard should say what to do next.** Charts alone do not help a new
  artist; a few clear next steps do.
- **Nothing here needs anyone outside the team.** Each slice can be built and
  tested with seeded data.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2682](https://github.com/akoita/resonate/issues/2682) | A remix creator asks; the artist previews, then approves or declines one remix version; the answer is kept with its provenance |
| 2 | P1 | Business value | [#2686](https://github.com/akoita/resonate/issues/2686) | Shows interest totals and counts by city in artist analytics, under the minimum-group rule |
| 3 | P1 | Known issue | [#2689](https://github.com/akoita/resonate/issues/2689) | Stem previews are recorded and counted on the preview measures page |
| 4 | P2 | Usability | [#1121](https://github.com/akoita/resonate/issues/1121) | Stretch, first slice: deterministic next-step cards in artist analytics, at least three card types with deep links |

**Dependencies.** None between slices. #2686 and #1121 both touch artist
analytics; build #2686 first.

## Rules for this sprint

- One PR per issue, based on `main`, submitted with `/ship` where available.
- No fee, split, price or payout change. No money moves.
- The owner's 2026-11-26 instruction admits work that needs no outside
  people. Work that needs invited artists, lawyers or partners stays where it
  is (Sprint 60 rehearsal #2672, legal review #2649).

## Not in this sprint

- Sprint 55 decision models: the spike (#2581) needs paid model runs against
  more than one provider, so it stays paused with the pilot (#2583) and the
  stretch (#2585).
- Package-check tuning for official stems (#2379): it needs real uploads.
- The production opening, which is planned and not scheduled.
- Generated-audio marking work, which has its own plan for its deadline.

## Exit criteria

- Approve and decline each work end to end in tests: approval unlocks
  publish and export for that version only, a new version needs a new
  approval, and a decline keeps the remix a private draft and tells the
  creator.
- Artist analytics shows Shows interest without any city below the minimum
  group (tests).
- A stem preview writes one record, and the weekly count shows on the preview
  measures page (seeded test).
- Feature pages and the User Guide are updated for each user-visible change.
- The milestone's release exists
  (`docs/sprints/releases/milestone-60.md`, "Close A Milestone" in
  `docs/operations/release_process.md`).

## Revenue line

Vision-neutral trust infrastructure (#2682: consent before use of an artist's
work) and quality. Shows interest (#2686) is groundwork for revenue line 1.
Nothing is charged or paid. Artists keep at least 85% (ADR-BM-4).
