# Vision Sprint 38: A DJ that plays what you asked for

**Status:** Owner-approved 2026-10-24; in progress. No due date: it closes when
its exit checks pass on staging.
**Milestone:** [40](https://github.com/akoita/resonate/milestone/40).
**Goal:** When a listener asks for something, every pick matches it unless they
chose to widen the session, and when the catalog has too few matches the DJ
says so instead of quietly padding the batch.

## Why this theme

- **Sprint 37 fixed finding; selection still loses the right tracks.**
  - Owner testing after Sprint 37 showed Hip-Hop and World sessions where
    tracks that match the request were found by retrieval and correctly
    classified by their descriptors, yet left out of the batch.
  - Their slots went to Pop and New Age tracks from the listener's learned
    taste.
  - A code trace found eight structural gaps. In short, the request is a +20
    ranking bonus, never a rule:
    - learned favourites are searched as if requested;
    - tracks Home has shown score zero;
    - the batch fills in plain score order;
    - exploration and the AI curator ignore the request.

  [#2316](https://github.com/akoita/resonate/issues/2316) records the evidence
  and the request-first model.
- **Two honesty gaps ride along.**
  - Session-start decision analytics are dropped for 12-track batches (#2317).
  - First-batch pick notes, including the new "Outside your request" mark
    (#2312), live only in memory (#2299).
- **Phase 3 of the AI DJ plan starts with what doesn't touch ranking.** The
  "Right now" start (#2245) and the For you row (#2249, slice 3) complete the
  quick starts. Trends (#2246) and in-session steering (#2247) wait for the new
  ranking. The plan is `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`.
- **The owner's question on wrong or missing metadata** becomes the
  time-boxed audio-embedding spike (#2248). Audio is the source of evidence
  classification does not use today.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2317](https://github.com/akoita/resonate/issues/2317) | Session-start decision analytics are recorded for 12-track batches |
| 2 | P0 | Business value | [#2316](https://github.com/akoita/resonate/issues/2316) | The request gates, taste orders, and padding is explicit. One match predicate is used for selection and display |
| 3 | P1 | Known issue | [#2299](https://github.com/akoita/resonate/issues/2299) | Pick reasons, and the first batch's match flags, survive a restart |
| 4 | P1 | Business value | [#2245](https://github.com/akoita/resonate/issues/2245) | A session with no filters is weighted by the time of day and weekday, with a visible reason |
| 5 | P2 | Usability | [#2249](https://github.com/akoita/resonate/issues/2249) (slice 3) | The For you row: "Right now" and "More like…" starters |
| 6 | P2 | Usability | [#2313](https://github.com/akoita/resonate/issues/2313) | The AI DJ panel's Sonic Radar line is about this session, or absent |
| 7 | P2 | New needs | [#2248](https://github.com/akoita/resonate/issues/2248) (spike) | A written adopt/close decision on audio embeddings, with recall and worker cost |

Dependencies:

- Every external prerequisite is closed: the golden set (#2235), descriptors
  (#2240), hybrid retrieval and its fallback (#2242, #2315), the Up next card
  (#2243), seeded sessions (#2244), and the per-pick match flag (#2312).
- #2245 comes after #2316, because both touch how session preferences are
  built.
- #2249 slice 3 comes after #2245.

## Owner decisions (2026-10-24)

1. **Padding is off by default.** When the catalog has fewer matches than the
   batch size, the DJ returns fewer tracks and says so ("8 tracks match your
   request"). A "Fill with similar sounds" switch in Adjust allows marked
   off-request padding.
2. **Home impressions carry no penalty inside the request.** Only tracks played
   in this session are excluded. Recently played tracks are demoted gently,
   within their tier.

## Deployment halves

None. No item changes deployment configuration.

## Exit criteria

- The #2316 golden cases pass on both the in-memory and Postgres runners, no
  case regresses, and baselines are raised.
- On staging:
  - the owner's Hip-Hop and World tests return every matching non-explicit
    track before any off-request track;
  - a short catalog gives a shorter batch, with a reason;
  - with padding off, `requestMatch` is true for every pick.
- The `hybrid_rrf_v1` decision is recorded with golden and staging evidence:
  promote, keep as an experiment, or retire.
- Session-start decision analytics are recorded for 12-track batches.
- Pick reasons survive a backend restart.
- The #2248 result is written up, with a decision.
- The User Guide, feature pages and `docs/deployment/environment.md` describe
  what is built.

## Not in this sprint

- Trends as a source (#2246) and in-session steering (#2247). Both build on the
  ranking #2316 changes.
- The operator view of agent events (#2259), which needs a storage decision
  first.
- My Mix "no lanes" reasons (#2270), artist correction of descriptors (#2292),
  and persisted artist ids (#2258).
- **Not counted:** the owner checks in #2154.
- **Housekeeping:** #2215 (lifecycle smoke) is closed as resolved. Every
  scheduled run since 2026-10-20 has passed.

## Revenue line

Vision-neutral quality (ADR-BM-6). No fee, split, price or payout change. Model
cost is unchanged: there is no new model call on the pick path, and the spike
runs on the existing worker. Popularity stays out of payouts (ADR-BM-4).
