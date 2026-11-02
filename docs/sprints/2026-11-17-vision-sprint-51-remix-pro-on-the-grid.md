# Vision Sprint 51: Remix Pro on the grid

**Status:** ✅ Approved 2026-11-02 by the owner. Starts after Sprint 50 closes.
**Milestone:** Vision Sprint 51 (created by the owner once the scope is
approved).
**Goal:** In Remix Studio Pro mode an artist can fix the tempo and downbeat
by ear, mark an intro and outro to loop or cue, and export a DJ extended
version whose beat grid and cues land where they put them.

## Why this theme

- **Remix Pro is half built.** #1903 shipped S6a (Pro switch, entitlement
  seam, per-stem EQ and pan, #1940) and S6b (per-stem Punch compressor,
  #2481). Every later slice depends on a grid the artist can trust, and today
  the grid comes only from analysis: when the measured tempo or first beat
  is off, the beat maker, AI parts and structure are off with it.
- **It is the user lens after a quality sprint.** Sprint 50 is quality and
  hygiene; Sprint 51 gives artists and DJs a new capability on a core
  surface (epic #1896, `vision:core`).
- **S6c and S6d are the right size.** S6e automation lanes is the stretch;
  S6f stem export and mashups depend on the export-rights work #1903 names (#891 E) and stay
  out.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | User feature | [#1903](https://github.com/akoita/resonate/issues/1903) S6c | Grid correction: tap tempo and a downbeat nudge (± one beat, ± 10 ms), stored as a project-level override of the measured section grid. The beat maker, AI parts and structure read the override. Preview and render agree (parity fixture) |
| 2 | P1 | User feature | [#1903](https://github.com/akoita/resonate/issues/1903) S6d | Cue and loop points: intro and outro snapped to the (corrected) grid, loopable in the preview. A **DJ extended** export adds the intro and outro and writes the beat grid and cues alongside the audio |
| 3 | P2 | User feature | [#1903](https://github.com/akoita/resonate/issues/1903) S6e | Stretch: per-stem level and filter automation lanes over the timeline, only if S6c and S6d land early |

## Defaults taken (owner may override in review)

1. **Free for now.** All of this sits behind the existing `remix.pro` seam,
   which allows everyone. No price; any future tier goes through
   `docs/rfc/business-model.md` first.
2. **The override never rewrites analysis.** The measured grid stays stored;
   the project keeps an override that can be reset.
3. **DJ export format.** The beat grid and cues ship as a sidecar file next to
   the audio; rekordbox and Serato imports are checked by hand later with
   #2121, not in this sprint.

## Exit criteria

- S6c and S6d merged with focused web and backend tests and the preview and
  render parity fixture green.
- #1903 updated with what shipped and the slices left (S6e if not done, S6f).
- Feature page and the in-app Remix guide's Pro level (#1905) updated with
  grid correction and cues, with screenshots, in the same PRs.
- Verified on staging after a Release Deployment; milestone closed and a
  release cut (project rule).

## Not in this sprint

- #1903 S6f stem export and mashups: depends on export rights (#891 E).
- #2367 remix challenges: owner decision first.
- #2379, live charging (#2409), buying credits (#1422): gated as in Sprint 50.

## Revenue line

- **#1903 S6c–S6e:** line 2 (creator tools, Remix Studio Pro), phase 1,
  behind an entitlement seam that allows everyone. No fee, price or split
  change. ADR-BM-4 untouched: no money moves.
