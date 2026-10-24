# Vision Sprint 39: A DJ that listens while you listen

**Status:** Closed 2026-10-24. All six issues are closed, verified on staging
at `3ef74447`. The sprint was approved and run under the owner's delegated
authority overnight; the decisions taken on the owner's behalf are recorded on
each issue as overridable defaults.
**Milestone:** [41](https://github.com/akoita/resonate/milestone/41).
**Goal:** Skips and saves steer the rest of the session, trending tracks join
only inside the request, listeners choose how familiar or new the session is,
artists can correct their tracks' tags, My Mix explains an empty state, and
operators can read a session's agent decisions.

## Outcome

The goal is built and deployed. The DJ now reacts to what the listener does
during a session, and the session page gives the listener more control.

| Issue | Result | PR |
| --- | --- | --- |
| #2247 | In-session steering: a bounded (±15), decaying, session-scoped ranking term from this session's skips, "Not this", completes and saves; it works inside the request tiers, leaves Home unchanged, and explains a pick it changed | #2335 |
| #2246 | Trending in your families: a sixth hybrid source, capped at 20%, admitting tier A/B tracks only, reading the popularity serving tables with the minimum-audience thresholds | #2334 |
| #2327 | Discovery (Familiar · Mixed · New), a Tempo range that edits the request's BPM, and a once-only first-session tip stored locally | #2336 |
| #2270 | My Mix reason codes (no signals, unknown genres, too few sessions, evidence decayed), distinct from a failed call; family-keyed lane boosts work | #2333 |
| #2292 | Artists correct their tracks' families and sub-genres from the vocabulary; a correction survives re-tagging and the backfill and re-embeds the track | #2331 |
| #2259 | An admin-only, audited view of a session's agent decisions, read from the existing analytics events with field-by-field whitelisting | #2332 |

**Unplanned:**

- #2330 (sprint plan).
- Two stale test expectations: the My Mix E2E copy, and the session id on the
  adapter specs.
- A flaky contracts integration test, re-run.
- One real code conflict between #2246 and #2247 in the selector's explanation
  lines, resolved by keeping both.

**Staging verification (2026-10-24, `3ef74447`):**

- The deployed code contains:
  - the Discovery control;
  - the Tempo hint;
  - the first-session tip;
  - the My Mix reason copy;
  - the operator events page;
  - the release page's tag editor.
- The admin events route answers 401 without a sign-in, and the descriptor
  vocabulary is public.
- The steering and trending sentences are written by the backend and covered
  by integration tests.
- Not yet tested by the owner on staging: steering and Discovery = New.

**Carry-over and follow-ups:**

- #2337 (minimised agent analytics) shipped in Sprint 40.
- A stronger MusicBrainz identity bind and the session-start preference
  strings are noted on #2342 and #2340.
- Promoting `hybrid_rrf_v1` still waits for production traffic (#1455).

## Why this theme

- **Sprint 38 made the request the rule.** Request-first selection (#2316)
  passed the owner's Hip-Hop and World tests on staging. Phase 3 of the AI DJ
  plan can now add its "competitor" signals safely, because they work inside
  the request tiers. The plan is
  `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`.
- **The listener's live reactions don't steer the session yet.** Skips and
  saves only shape the long-term profile (#2247).
- **Classification is still text-only** (the #2248 spike). The artist is the
  best source of truth for their own track, and corrections are the cheapest
  fix for wrong metadata (#2292).
- **Operators had to query the database to diagnose a DJ session** during
  Sprint 37 testing (#2259).

## Approved scope

| Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| P0 | Business value | [#2247](https://github.com/akoita/resonate/issues/2247) | Skips and "Not this" move the rest of the session away, and completes and saves move it closer, inside the request tiers |
| P1 | Business value | [#2246](https://github.com/akoita/resonate/issues/2246) | Trending in your families is a capped hybrid source (20%) that never displaces a request match |
| P1 | Usability | [#2327](https://github.com/akoita/resonate/issues/2327) | The Discovery control (Familiar · Mixed · New), the Tempo filter and the first-session tip |
| P1 | Known issue | [#2270](https://github.com/akoita/resonate/issues/2270) | My Mix says why there are no lanes, and boosting a family-keyed lane works |
| P2 | Business value | [#2292](https://github.com/akoita/resonate/issues/2292) | Artists correct their tracks' families and sub-genres; corrections survive re-tagging and re-embed the track |
| P2 | Usability | [#2259](https://github.com/akoita/resonate/issues/2259) | An admin-only, audited view of a session's agent decisions, read from the existing analytics events |

Dependencies:

- All prerequisites are closed: request tiers (#2316), hybrid retrieval
  (#2242, #2315), descriptors (#2240), the For you row (#2249), and the
  per-pick decision events (#2317).
- The items are independent. They run in parallel, and the two that touch
  retrieval and ranking (#2247, #2246) are rebased on whichever lands first.

## Decisions taken under delegated authority (2026-10-24)

1. **#2327:** Discovery is a three-step control (Familiar · Mixed · New),
   defaulting to Mixed, and is not personalised yet. Tempo is a BPM range that
   counts only measured tempo. The tip appears once, and its dismissal is
   stored locally.
2. **#2246:** trending is capped at 20% of fused candidates, tiers A/B only
   for a request session, and the minimum-audience thresholds apply.
3. **#2247:** a session-scoped signal of at most ±15 points; each event halves
   after 4 picks, works inside a tier, and nothing new is persisted.
4. **#2259:** the view reads the existing analytics events, uses an admin JWT,
   and writes an audit event on every read. It shows no free text.
5. **#2292:** the owner or a credited manager can edit families and sub-genres
   from the vocabulary only. Bands stay measured. A correction is stored with
   `source: artist` and is never overwritten.

## Deployment halves

None expected. #2246 reads the existing popularity serving tables, and any new
setting has a code default (documented in `docs/deployment/environment.md`).

## Exit criteria

- The golden set does not regress. New tests prove that a trending track
  never displaces a request match and that steering never moves a track across
  tiers.
- Steering: after skips of one style, the next picks in the same session move
  away from it (integration test). Home is unaffected.
- On staging:
  - the Discovery control, Tempo filter and tip are in the deployed code;
  - the operator view returns 403 for a non-admin;
  - the AI DJ panel works end to end.
- The User Guide, feature pages and `docs/deployment/environment.md` describe
  what is built.

## Not in this sprint

- Promoting `hybrid_rrf_v1` to the code default, which waits for production
  traffic (#1455).
- Audio embeddings (#2248 is closed with a re-open trigger).
- **Not counted:** the owner checks in #2154.

## Revenue line

Vision-neutral quality (ADR-BM-6). No fee, split, price or payout change.
Popularity stays out of payouts, and ranking is never for sale (ADR-BM-4,
ADR-TE-2).
