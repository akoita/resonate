# Vision Sprint 37: A DJ that understands what you mean

**Status:** Owner-approved 2026-10-23; in progress. No due date: it closes when
its exit checks pass on staging.
**Milestone:** [39](https://github.com/akoita/resonate/milestone/39).
**Goal:** A listener's request reaches the right tracks even when the
catalog's genre text doesn't contain the word they used, and the listener can
see and steer what plays next.

## Why this theme

- **Sprint 36 measured the gap.** The AI DJ retrieval golden set (#2235)
  recorded a baseline of mean recall@10/@20 of 69% / 71%, with seven known
  gaps. A World request misses tracks tagged with a country name or no genre,
  "like <artist>" finds nothing, and "40-minute run" reads nothing. All of
  these come from retrieval being gated by free-text genre and fixed
  vocabulary (R1, R2 in the plan).
- **Phase 2 of the approved plan** fixes that at the source, and replaces the
  last unclear card on the AI DJ page. The plan is
  `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`, under epic
  [#1952](https://github.com/akoita/resonate/issues/1952).
- **Two small reliability and privacy debts ride along.** The Home streaming
  race that blocked the Sprint 36 release (#2290), and the consent fixes
  Sprint 36 set aside (#2230, #2231).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Business value | [#2240](https://github.com/akoita/resonate/issues/2240) | Each track gets a stored, versioned descriptor (families, sub-genres, measured bands) and is re-embedded from it. Tags are read-only in the release editor |
| 2 | P0 | New needs | [#2241](https://github.com/akoita/resonate/issues/2241) | The sentence joins the session's semantic query; artist names resolve to seeds; an optional model parser reads what the rules can't |
| 3 | P0 | Business value | [#2242](https://github.com/akoita/resonate/issues/2242) | Keyword, semantic, audio-feature, lane and seed sources are fused with per-source budgets, behind a ranker variant |
| 4 | P0 | Usability | [#2243](https://github.com/akoita/resonate/issues/2243) | "Now & Up next" replaces Next AI Pick, with Skip, Not this and More like this |
| 5 | P1 | Usability | [#2244](https://github.com/akoita/resonate/issues/2244) | Start a session from a track, an artist or one of your playlists |
| 6 | P1 | Known issue | [#2290](https://github.com/akoita/resonate/issues/2290) | Static pages render their content inline, with no late hidden copy |
| 7 | P1 | Known issue | [#2230](https://github.com/akoita/resonate/issues/2230), [#2231](https://github.com/akoita/resonate/issues/2231) | A failed consent check no longer silently stops telemetry, and the selected choice is visible |
| 8 | P2 | Usability | [#2249](https://github.com/akoita/resonate/issues/2249) (slice 2) | Catalog-aware Sounds starters with counts; no dead-end starters |
| 9 | P2 | Known issue | [#2257](https://github.com/akoita/resonate/issues/2257) | No production path creates a track without an AI disclosure |

Dependencies:

- Every external prerequisite is closed: #1959 (full-mix features), #1452
  (embeddings), #2005 (ranker variants), #2235 (golden set), #2236 (one genre
  matcher) and #2238.
- #2242 comes after #2240 and #2241, because it fuses their outputs.
- #2244 comes after #2242: a seed is a hybrid-retrieval source.
- #2249 slice 2 uses the #2240 families.

## Owner decisions (2026-10-23)

1. **#2240:** generated tags are **read-only** in the release editor at first.
   Artist correction is the follow-up
   [#2292](https://github.com/akoita/resonate/issues/2292).
2. **#2241:** the model-assisted parser is **off by default** in every
   environment. It is enabled per environment, staging first, only after it
   passes the golden set.

## Deployment halves

- [resonate-iac#317](https://github.com/akoita/resonate-iac/issues/317):
  the descriptor strategy flag, model credentials and the catalog backfill job
  (#2240).
- [resonate-iac#318](https://github.com/akoita/resonate-iac/issues/318):
  the session parser flag, deterministic by default (#2241).

## Exit criteria

- On the golden set, every World and Rap case reaches its expected tracks in
  the top 20, including tracks whose metadata never says "world" or "rap".
  The case baselines are raised to the new values, and no case regresses.
- No model call happens on the pick path, and at most one per session start,
  enforced by tests.
- The hybrid ranker ships behind a variant label, and the promotion decision
  is recorded with its offline evidence.
- On staging:
  - the Up next card works;
  - Home has no hidden streamed copy;
  - the consent buttons show the selected choice.
- The deployment halves are configured, and the descriptor backfill has run on
  staging.
- The User Guide, feature pages and `docs/deployment/environment.md` describe
  what is built.

## Not in this sprint

- **AI DJ Phase 3** (#2245–#2247) and the audio-embedding spike (#2248). The
  spike is decided after this sprint's golden results.
- #2249 slice 3; merging saved vibes into Taste memory.
- The legal waiver item #1776 and the staking investigation #1752.
- **Not counted:** the owner checks in #2154.

## Revenue line

Vision-neutral quality (ADR-BM-6). Model cost is bounded by the plan's
guardrails: one small-model call per track per content change, and at most
one per session start. No fee, split, price or payout change; artists keep at
least 85% (ADR-BM-4), and popularity is never a payout input.
