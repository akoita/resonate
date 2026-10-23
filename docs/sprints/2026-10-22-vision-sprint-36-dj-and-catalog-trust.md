# Vision Sprint 36: A DJ you can understand, a catalog you can trust

**Status:** Closed 2026-10-23. Ten of eleven issues are closed; #2249 shipped
slice 1 of 3 and moves out for slices 2–3. Verified on staging at `13a88eea`.
The attestation run on staging is the deployment half,
[resonate-iac#316](https://github.com/akoita/resonate-iac/issues/316).
**Milestone:** [38](https://github.com/akoita/resonate/milestone/38).
**Goal:** A listener can start the AI DJ from one place and see what it will
play from, we can measure whether it finds what was asked for, and well-known
human recordings no longer show "AI disclosure unavailable".

## Outcome

The goal sentence holds on staging, except the last clause: the human-made
attestation is built and tested, but the pill only disappears once the
operator approves a manifest and runs it in resonate-iac#316.

| Issue | Result | PR |
| --- | --- | --- |
| #2235 | Golden set: 19 cases, recall@10/@20 baseline recorded (mean 69% / 71%; 7 known gaps) | #2261 |
| #2236 | One genre matcher for sessions and My Mix lanes; free-text genres form lanes | #2271 |
| #2239 | Starting-taste line with an Edit link; mood-only sessions no longer narrow to saved vibes | #2265 |
| #2237 | One Start action; the status card and unused `AgentDashboard` removed | #2266 |
| #2238 | Live Feed card removed; request coverage under the filter chips | #2267 |
| #2249 | Slice 1: plain starters that write their sentence, Moments without hidden genres, an Adjust row | #2273 (partial) |
| #2252 | `catalog_attestation` source; report and dry-run-first apply scripts with tests | #2260 |
| #2228 | A failed chart request says "Charts are unavailable right now." | #2262 |
| #2229 | User Guide: which listens count toward the charts | #2263 |
| #2254 | Home reveals in layout order; no reshuffle for signed-in listeners | #2264 |
| #2216 | Mutation campaigns re-sharded; verification run green, longest leg 61 min | #2256 |

Unplanned:

- #2251, buyer-bound x402 smart-account redemption and the AI DJ quality plan,
  had failing tests that needed updating; fixed and merged.
- #2278 bounds the CI ffmpeg install after a stalled apt mirror twice held
  the merge queue.
- #2291 fixes a pre-existing streaming race in which Home was briefly in the
  DOM twice; it blocked the first staging release. The root cause is #2290.

**Staging verification (2026-10-23, `13a88eea`):**

- Signed-out Home shows one AI DJ section with plain starters, and Trending
  Now renders.
- The deployed AI DJ code contains the starting-taste line, Stop-only command
  bar, Adjust row, coverage line and attestation tooltip, and no Live Feed
  card.
- The charts help entry and the rewritten AI DJ article are live.
- The signed-in AI DJ page was seen through the refreshed screenshot, captured
  locally with mock sign-in, because staging has no test sign-in. A signed-in
  look on staging joins the owner checks in #2154.

**Carry-over and follow-ups:**

- #2249 slices 2–3.
- #2257: UNDECLARED writers.
- #2258: persist MusicBrainz and Wikidata ids.
- #2259: an operator view of agent events.
- #2270: My Mix "no lanes" reasons and family-lane boosts.
- #2290: AppShell Suspense streaming.
- The next sprint is not yet selected.

## Why this theme

- **The AI DJ misses obvious tracks and its page is hard to read.** The owner
  approved the AI DJ quality plan on 2026-10-22 (sub-issues #2235–#2249 of
  [#1952](https://github.com/akoita/resonate/issues/1952)). Its Phase 1
  (measure, then fix the cheap causes) is sized for one sprint. The plan is
  `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`, which lands on
  `main` with [#2251](https://github.com/akoita/resonate/pull/2251).
- **The Home rails cast doubt on human artists.** Tracks uploaded before AI
  disclosure (#1336) show "AI disclosure unavailable", even for well-known
  recordings whose human origin is public knowledge.

Sprint 35 closed with all six issues done, so nothing carries over.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | New needs | [#2235](https://github.com/akoita/resonate/issues/2235) | AI DJ retrieval golden set with recall@k per case. Today's misses (World → African, rap, sentences, artist names) are recorded as the baseline that gates every later retrieval change |
| 2 | P0 | Known issue | [#2236](https://github.com/akoita/resonate/issues/2236) | Sessions and My Mix lanes use one genre matcher. Explains why a listener with many sessions is not offered My Mix |
| 3 | P0 | Usability | [#2239](https://github.com/akoita/resonate/issues/2239) | The DJ's starting taste is a labelled line with an Edit link. Mood-only sessions no longer narrow to the saved vibes |
| 4 | P0 | Usability | [#2237](https://github.com/akoita/resonate/issues/2237) | One Start action; the status card merges into the command bar; the unused `AgentDashboard.tsx` is removed |
| 5 | P0 | Business value | [#2252](https://github.com/akoita/resonate/issues/2252) | A reviewed attestation marks publicly known human-made releases `NONE` with a distinct source. Unknown sources stay `UNDECLARED` |
| 6 | P1 | Usability | [#2238](https://github.com/akoita/resonate/issues/2238) | The Live Feed card is removed; request coverage moves under the filter chips |
| 7 | P1 | Usability | [#2249](https://github.com/akoita/resonate/issues/2249) (slice 1 only) | Plain-language quick starts and composable filters; frontend and copy only |
| 8 | P1 | Known issue | [#2228](https://github.com/akoita/resonate/issues/2228) | A failed chart request no longer looks like "not enough listening" |
| 9 | P2 | Usability | [#2229](https://github.com/akoita/resonate/issues/2229) | The User Guide explains which listens count toward Trending Now and Top Artists |
| 10 | P2 | Known issue | [#2216](https://github.com/akoita/resonate/issues/2216) | The cause of the cancelled mutation-testing run is found and the next weekly run is green |

Dependencies:

- Every prerequisite is closed: #2088, #1455, #1336 and #1451.
- #2239 lands before #2237: the saved-vibes chips on the card that #2237
  removes move to #2239's labelled line. #2239 also lands before #2249, whose
  slice 1 pairs with it.
- #2238 refers to the Up next card (#2243, Phase 2). Until #2243 ships, pick
  reasons stay on the existing pick card, as the issue states, so #2238 is
  not blocked.
- #2252's run in a deployed environment is its deployment half,
  [resonate-iac#316](https://github.com/akoita/resonate-iac/issues/316).
  Only the application half counts toward this sprint.

## Exit criteria

- The golden set runs and its baseline is recorded.
- Sessions and My Mix lanes match the same genres, covered by tests.
- On staging, the AI DJ page has:
  - one Start action;
  - no Live Feed card;
  - a visible starting-taste line;
  - plain-language quick starts.
- #2252's report and apply scripts are merged with tests. The pill disappears
  for attested tracks once resonate-iac#316 has run.
- If the P1 and P2 items land: a failed chart request is not shown as low
  data, and the help entry ships.
- The User Guide and the feature pages describe what is built.

## Not in this sprint

- **AI DJ Phases 2–4:** #2240–#2248, and #2249 slices 2 and 3.
- **Consent fixes:** #2230 and #2231. They are a separate privacy topic and a
  good fit for a later sprint.
- **Uploader-proven human origin:** future work under
  [#1164](https://github.com/akoita/resonate/issues/1164).
- **Not counted:** the owner-signed staging checks (#2154) and the rekordbox
  check (#2121) remain the owner's.

## Revenue line

Vision-neutral quality and trust infrastructure (ADR-BM-6). #2252 is AI Music
Integrity trust work supporting revenue line 3. No fee, split, price or payout
change; artists keep at least 85% (ADR-BM-4), and popularity is never a payout
input.
