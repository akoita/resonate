# AI DJ filter-adherence evals

Status: `in-progress` (#2451). Stage A (parser) and stage B (deterministic
selection) are the first slice. Stage C, the LLM-path guard, is #2454.
Follow-up fixes measured here: #2452 (parser drops, comparison 2), #2453 (loose genre
matching).

Vision-neutral infrastructure/quality: no money, payout, ingestion-trust or
billing surface is touched.

## Why

A listener who starts "Zen, relaxed" and hears hard rap concludes the AI DJ
does not work. The existing DJ golden set (#2235,
`backend/src/tests/dj_retrieval_golden/`) measures **recall**: did the tracks
a listener expects show up in the shortlist? Nothing measures **precision**:
did a track that has nothing to do with the request get played? A selector
that plays every on-request track *and* pads with unrelated ones passes the
recall suite, so off-filter picks never fail CI.

This suite measures what the listener hears against what they asked for, for
every kind of request: each Moments and Sounds starter, each filter alone and
in combination, typed sentences, named artists, discovery modes, and requests
the catalog cannot meet. It is the yardstick for fixing the selector:
baseline first, then each fix must move the numbers without regressing any
case.

## Method

The method follows the evaluator discipline used in `akoita/draft-loop`:
invented fixtures with distractors, cases grouped by category, predeclared
metrics, a pinned baseline that a change may raise but never lower, and a
written record of each comparison.

1. **Two-layer fixture catalog.** Every invented track carries
   - its **truth**: genre family, energy band, BPM, the moments it fits, and
     whether it is explicit, labelled by hand. Only the grader reads it.
   - its **observed metadata**: what the system sees, made deliberately as
     sparse and messy as a real catalog: free-text genres ("Hip Hop/Rap",
     "Rap FR", "Afro"), vague or missing genres, mood tags on a minority of
     tracks, measured audio features on about half.

   Off-filter picks in production come from exactly this gap: an untagged,
   unmeasured rap track looks neutral to the selector, while a listener hears
   it as the opposite of "Zen".
2. **Independent grader.** The grader decides from truth labels and its own
   hand-written tables. It never imports the selector's predicates, the genre
   families, or the parser vocabulary. Otherwise it would agree with the bug
   it is meant to catch.
3. **Grade the intent, not the parse.** A sentence case states what the
   listener meant. The picks are graded against that, so a parser misread
   shows up as a selection failure as well as a parser failure.
4. **Listener profiles.** Every request runs for a `fresh` listener (no
   taste), a `conflicting` listener whose saved vibes and learned genres
   differ from the request (the "Zen → rap" case), and an `aligned` control.
   The harness reproduces the preference assembly of session start
   (`AgentConfigController.startSession`) and next pick
   (`SessionsService.ownGenres` / `withLearnedGenres`).
5. **Two batches.** Batch 1 is what session start plays. Batch 2 is the next
   pick, with batch 1 as played tracks. Most exhaustion leaks (widened
   fallback, padding) only show in batch 2.
6. **Variants.** Every case runs under the default retrieval and
   `hybrid_rrf_v1`.

## Grading a pick

For each filter the request sets, the grader reads the pick's truth:

| Filter | Match | Mismatch | Contradiction |
| --- | --- | --- | --- |
| Genre | truth family is a requested family | — | any other family |
| Moment / mood | the moment is in the track's `fits` | not in `fits` | track energy is the opposite of the moment's energy |
| Energy | same band | adjacent band | opposite band (low vs high) |
| Tempo | truth BPM in range (±3) | outside by ≤ 15 BPM | outside by > 15 BPM |
| Explicit off | not explicit | — | explicit |
| Artist | the artist, or one listed as similar | — | anything else |

A pick is **on-request** when every filter matches, **partial** when some
filter mismatches and none contradicts, and a **contradiction** when any
filter contradicts.

## Metrics

Per case, per batch (batch size 12):

- `onRequest`: on-request picks / picks.
- `attainable`: on-request tracks the catalog holds for this case, capped at
  the batch size. `adherence` = on-request picks / `attainable`, capped at 1.
- `contradictions`: picks that contradict the request. This is the "it does
  not work" metric; the target is zero.
- `silentLeaks`: picks the grader does not rate on-request but the system
  presents as in the request (tier A or B, so no "Outside your request"
  mark). The target is zero: an off-request pick is acceptable only when it
  is marked.
- `unmetHonest`: for a request the catalog cannot meet, the system says so
  (empty or marked picks) instead of filling silently.

Target per case: zero contradictions, zero silent leaks, adherence ≥ 0.8.
The report gives the pass rate against that target, means by group, profile
and variant, and the worst offending picks with the reason each failed.

## Gates

`backend/src/tests/dj_filter_eval/baseline.json` pins each case's current
numbers. CI fails if any case gets worse: more contradictions, more silent
leaks, or lower adherence. An improvement updates the baseline in the same
PR (`UPDATE_DJ_FILTER_BASELINE=1 npm run eval:dj-filters`), so gains cannot
quietly regress. The baseline records what the code does today, not a goal.

## Run

```bash
cd backend
npm run eval:dj-filters
```

The suite writes `eval-results/dj-filter-adherence.json` and `.md`. It is
Docker-free: it drives the real `AgentSelectorService` and
`DiscoveryRankingService` over an in-memory twin of the catalog tools, as the
recall golden set's twin does.

## Baseline (2026-10-30)

Recorded before any selector or parser change. These numbers are the
starting point a fix must improve, not a target.

**Stage A, parser** (57 sentences): 46 parse exactly (80.7%). Precision is
100% on every dimension: the parser never invents a filter. All 11 failures
are silent drops, where the sentence reads as nothing:

- natural phrasing: "pump me up for the gym", "party", "relaxing evening"
- typos: "hip hpo", "afrobaet", "techo", "classicl"
- French: "musique classique calme", "électro pour danser"

A dropped sentence starts an unfiltered session. All 20 starters parse to
their documented request.

**Stage B, selection** (141 cases × 2 variants = 282 runs, 2 batches each):

| | Pass rate | On-request | Adherence | Contradicting picks | Silent leaks |
| --- | ---: | ---: | ---: | ---: | ---: |
| all | 2% | 53% | 40% | 1033 | 1848 |
| moments (mood/energy starters) | 0% | 38% | 38% | 249 | 663 |
| sounds (genre starters) | 0% | 79% | 37% | 126 | 126 |
| typed sentences | 0% | 39% | 25% | 255 | 404 |
| conflicting-taste listener | 3% | 47% | 37% | 665 | 1104 |
| batch 2 (next pick) | 7% | 33% | 21% | 397 | 828 |

Failure classes, by size:

1. **A request with no genre is never gated.** This covers moment starters,
   energy, tempo, and sentences the parser dropped. Picks come from saved
   vibes and learned genres, and every pick shows as on-request (tier A or
   B, or no tier at all). The "Zen, relaxed" report reproduces:
   `moment-zen@conflicting` plays high-energy rap, pop and Afro tracks with
   1 of 12 on-request and none marked.
2. **Parser silent drops** feed class 1. "musique classique calme" from a
   hip-hop listener plays 12/12 contradicting tracks, all tier A.
3. **Loose genre matching inside gated requests.** "Afro-Pop" in the
   Afrobeats starter admits every "Dance Pop" release through two-way phrase
   containment. "Dance" in Pop Hits admits Techno and Deep House. These
   picks are tier A.
4. **Metadata gaps.** Tracks with no or vague genre are invisible to a genre
   request. Hip-Hop & Rap with explicit off finds 2 of the 4 clean hip-hop
   tracks.

`hybrid_rrf_v1` is slightly better than the default (fewer contradictions:
483 against 550), but it does not fix any class.

## Comparison 1: soft gate for mood, energy and tempo (class 1)

Change: a request with a mood, energy or tempo and no genre is `softGated`.
A contradicting pick (low vs high energy, a measured tempo more than 15 BPM
outside the range) is tier C for every request. A soft-gated pick needs at
least one soft match. The default retrieval path also searches by measured
sound. Details: `docs/features/agent_taste_intelligence.md`, "Mood, energy and
tempo constrain the session (#2451)".

| | Before | After |
| --- | ---: | ---: |
| Pass rate | 2% | 3% |
| On-request | 53% | 70% |
| Adherence | 40% | 44% |
| Contradicting picks | 1033 | 376 |
| Silent leaks | 1848 | 978 |
| moments: contradicting picks | 249 | 0 |
| single filters: contradicting picks | 194 | 0 |
| conflicting-taste listener: contradicting picks | 665 | 258 |
| batch 2 on-request | 33% | 58% |

**Decision: enable.** No case gained a contradiction. 48 case-batch entries
fell on silent leaks or adherence. These were accepted, and the baseline was
re-pinned in the same change:

- **Shorter batches.** With sparse metadata, nothing else retrievable provably
  fits, so the batch is shorter or empty (`catalog_short`) instead of padded
  with contradicting tracks. Tempo-only requests and the Club starter are most
  affected in batch 2, because only a measured tempo can match.
- **Partial picks.** Contradictions were replaced by tier-B picks that fit the
  energy but not the exact moment, such as a low-energy lo-fi track for Zen.
  They share the requested energy and are no longer unrelated.

Both retrieval variants now give the same totals. The remaining contradictions
come from parser drops (class 2) and loose genre matching (class 3).

## Comparison 2: listener words, French and typos in the sentence (#2452)

Change: a deterministic listener layer reads what Crate Digger's rules leave
unread. It covers listener energy and activity words in English and French,
French and adjectival genre forms, and one-typo tolerance for genre names
behind a length guard and a stoplist.

Before the change, the parser stage gained:

- 10 adversarial no-match sentences, words one edit from a genre such as
  "songs from france" and "horse riding playlist". All were pinned clean.
- 16 held-out sentences, written before the change and kept out of the
  implementer's view: 13 positive and 3 no-match.

| | Before | After |
| --- | ---: | ---: |
| Parser exact (visible cases) | 54/65 | 65/65 |
| Parser exact (held-out, first run) | — | 15/16 |
| Parser exact (all, final) | — | 81/81 |
| Selection: contradicting picks | 376 | 220 |
| Selection: `typed` contradicting picks | 174 | 18 |
| Selection: silent leaks | 978 | 820 |
| Selection: on-request | 70% | 73% |

The one held-out miss, "running late again", read as Hype with high energy.
Bare "running" was then narrowed to workout contexts.

One selection entry regressed on silent leaks, `typed-sad-slow` (0 → 1 per
batch). "slow sad songs late night" now reads Late Night with low energy. The
session went from 1 pick to 12, 92% of them on-request; the leak is one
partial pick. **Decision: enable,** baseline re-pinned.

## Out of scope for this slice

- **Stage C, the LLM curation path** (`AGENT_RUNTIME=adk`, the default where
  a model key is configured). Model picks cannot be replayed offline. The
  follow-up feeds adversarial model picks to `AgentRuntimePolicyService.apply`
  and measures what its guard lets through.
- Embedding-backed semantic retrieval and trending, which are off in the
  twin, as in the recall golden set.
- Real-catalog distribution. The fixture's sparsity ratios are assumptions.
  Measuring a deployed catalog's metadata coverage is deployment work and is
  tracked privately.
