# Vision Sprint 52: Remix Pro, stems out

**Status:** 🟡 Planned and started 2026-11-03 under the owner's overnight
instruction ("if you finish the sprint, start a new one"); the owner reviews
the scope in the morning and can change it.
**Milestone:** [Vision Sprint 52](https://github.com/akoita/resonate/milestone/50).
Each item is a sub-issue of #1903, so the milestone can close while #1903
stays open.
**Goal:** An artist with the export right can take the stems of a rendered
remix to a DAW or a DJ set, automation is edited on the curve itself, and the
owner has a mashups design to decide on.

## Why this theme

- **Remix Pro is one slice from done.** Sprint 51 shipped S6c grid
  correction, S6d cues and the DJ extended export, and S6e automation lanes.
  S6f (stem export and mashups) is what #1903 has left.
- **Export rights exist now.** The plain export (#1323) and the DJ export
  (#2540) already gate on the `export` action (a commercial license on the
  source stems), so stem export can reuse that gate. Mashups add a second
  source, a second rights route and a split between two artists, so they
  start as a design for the owner.
- **A small UX follow-up.** S6e left points editable only in a list; editing
  on the curve is what users expect from automation.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | User feature | [#2550](https://github.com/akoita/resonate/issues/2550) (S6f-1 of #1903) | "Also render stems" on the Mix stems render writes pre-master, time-aligned 24-bit FLAC stems (each source stem, the beat, each AI part) and a `resonate-stems/v1` manifest; "Export stems" on the draft streams a zip, gated by `remix.pro` and the `export` right |
| 2 | P1 | User feature | [#2551](https://github.com/akoita/resonate/issues/2551) (S6e follow-up) | Add, drag, nudge and remove automation points on the lane curve, keyboard included |
| 3 | P2 | Decision | [#2552](https://github.com/akoita/resonate/issues/2552) (S6f-2 design) | `docs/rfc/remix-mashups.md`: rights, project model, lineage and the two-artist split, with a recommendation; no build |

## Defaults taken (owner may override)

1. **Free for now.** Everything sits behind the `remix.pro` seam, which
   allows everyone; export keeps the commercial-license gate. No price.
2. **Stems come from the render, not the request.** They are written by the
   same `stem_mix` job and ffmpeg pass as the draft, only when asked, so a
   download never re-renders and stays within request limits (streamed from
   storage).
3. **Pre-master stems.** Each layer keeps its own processing; master tone,
   space, warmth, fades, build-ups and loudness stay out, so the stems sum to
   the pre-master mix.

## Exit criteria

- #2550 and #2551 merged with focused backend and web tests; stems proven
  time-aligned and summing to the pre-master mix in a real-ffmpeg test.
- #2552's design doc merged and linked; the decision stays with the owner.
- Feature page and the in-app Remix guide's Pro level updated, with
  screenshots, in the same PRs.
- Verified on staging after a Release Deployment; milestone closed.

## Not in this sprint

- Building mashups (#2552 decides first).
- #2367 remix challenges, #2379, live charging (#2409), buying credits
  (#1422): gated as before.

## Revenue line

- **#2550, #2551:** line 2 (creator tools, Remix Studio Pro), phase 1, behind
  an entitlement seam that allows everyone. No fee, price or split change;
  ADR-BM-4 untouched.
- **#2552:** design only; any mashup split must reconcile with
  `docs/rfc/business-model.md` and ADR-BM-4 (artists ≥ 85%, no recoupment).
