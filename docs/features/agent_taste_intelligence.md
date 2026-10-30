---
title: "Agent Taste Intelligence"
status: partial
owner: "@akoita"
issues: [977, 978, 979, 980, 981, 982, 983, 989, 1954, 1955, 1956, 1456, 1957, 1958, 1960, 1452, 1455, 2005, 2003, 2006, 2036, 2037]
---

# Agent Taste Intelligence

> **Direction change (accepted 2026-09-30):** the AI DJ stops buying stems on
> its own and becomes one face of a shared taste engine. See
> [AI DJ Rethink and Taste Engine](../strategy/ai-dj-taste-engine-2026-09.md),
> [ADR-TE-1…6](../strategy/taste-engine-decisions.md) and the
> [Taste Engine RFC](../rfc/taste-engine.md). This page describes current
> behavior; it changes as the slices in the
> [milestone plan](../roadmap/2026-10-taste-engine-milestones.md) ship.
>
> **Shipped in Vision Sprint 28:** AI DJ sessions no longer buy stems
> ([#1954](https://github.com/akoita/resonate/issues/1954)). The buy mode and
> its operator flag `AGENT_SESSION_BUY_MODE_ENABLED` were then removed once the
> Crate Digger quote flow shipped
> ([#1964](https://github.com/akoita/resonate/issues/1964)); purchases now
> happen through listener-approved quotes, see [Crate Digger](crate_digger.md).
> See [Agent Commerce Runtime](agent-commerce-runtime.md).

> **Frozen (ADR-TE-6, 2026-09-30).** ERC-8004 identity and reputation publishing and on-chain curator agents proved the technology but serve no current customer. The code stays behind `ERC8004_ENABLED` and `ERC8004_REPUTATION_SCHEDULER_ENABLED` (both default off); no new work without a new ADR naming a user and a revenue line. The listener taste score and tier described here are learned taste and stay; the flags gate only on-chain identity and reputation, and the agent dashboard hides identity mint and attest controls while `ERC8004_ENABLED` is off. Stem quality ratings from #322 stay as data, for the future Crate Digger quality filter; only their on-chain publishing is frozen. See [ADR-TE-6](../strategy/taste-engine-decisions.md).

> **AI DJ surface (#2032).** The standalone AI DJ page is gone. `/agent`
> redirects to Home's **Your AI DJ** section (`/#ai-dj`): signed in, the
> listener starts and stops a session, picks an intent preset, and sees status,
> activity, the Now & Up next card (#2243) and session history; signed out they see the presets
> and a sign-in button. The Home tuner and feed "start a session" actions start
> a session in place. DJ preferences (DJ name, vibes, first-time setup) live in
> Settings → **AI DJ** (`/settings?section=dj`). The ERC-8004 identity and
> reputation actions are no longer shown to listeners. The AI DJ never buys.

> **Listening sessions are price-free and keep your vibes (#2036).** Vision-neutral
> infrastructure/quality: no money, payout or fee changes. A listening session
> shows no prices, spend or budget anywhere in the AI DJ UI and negotiates
> nothing; its pick-log rows (`License` rows, kept as the "tracks picked" log)
> are recorded at price 0, a session start no longer writes an auto-`accept`
> signal for the DJ's own picks, and session budgets and spend limits no longer
> apply. Starting a session from a preset, the Home tuner or a Home feed prompt
> never overwrites the vibes saved in Settings → AI DJ: the web sends the
> session's genres as session preferences only, and the backend searches learned
> favorite genres, then the saved vibes, then the session's requested genres
> (in that order, de-duplicated). Preset cards no longer show a "Tempo target"
> because selection never used it, and listening presets carry no license tier.
> Only a first-time Home start, which creates the DJ, seeds the saved vibes.

> **Describe the session in your own words (#2037).** Vision-neutral
> infrastructure/quality: no money, payout or fee changes. The AI DJ section on
> Home has a "What's this session for?" box ("dark deep house, 120 to 125 BPM,
> high energy"). The text is read by the same request parser Crate
> Digger uses (`POST /agents/config/session/parse`, signed in, 500 characters,
> 20 requests a minute) into visible listening filters: genres and moods from
> the catalog vocabulary, an energy band (low, medium, high) and a tempo range.
> The listener sees each filter as a chip, can remove or edit any of them, and
> starts the session from the filters. The presets are quick-start chips:
> one fills the box and the chips without parsing and starts the same session
> the preset started before. Anything the parser could not read is listed under
> "Didn't catch", and Crate Digger-only terms (keys, stems, license tier, price
> limits, verified human only) under "Not used for listening". The filters then shape ranking: the requested genres join
> the session's genres, every mood is also searched, the energy band overrides
> the preset's energy, and a requested tempo range gives a ranking boost to
> tracks whose tempo was **measured** (an inferred tempo never counts, #1960).
> Filters are boosts, not guarantees: after each set the AI DJ reports, in the
> live feed and as `requestCoverage` on a next-pick response, which requested filters
> some picks did not match ("not matched: 120-125 BPM (1 of 5)"). Coverage is
> computed on both paths (#2075): the deterministic selector computes it for its
> picks, and for the LLM runtime (`AGENT_RUNTIME=adk|vertex`) the runtime policy
> step computes it for the final picks. The LLM prompt also names the session's
> own genres on a separate "Requested genres" line and asks the model to rank
> them above saved vibes and learned taste, and the policy step scores its picks
> with the same requested terms, tempo and audio features as the selector (it
> still never reorders the model's picks). Editing
> the chips mid-session sends a new request with the next pick, which replaces
> the old one (an empty request clears it), and the web swaps the DJ's upcoming
> picks in the queue for new ones; the playing track and tracks the listener
> queued themselves stay. Privacy: the sentence exists only in the parse request body. It is
> never stored, logged, published on the event bus, put into session or signal
> rows, kept in browser storage or sent to analytics; only the parsed filters
> (genres, moods, energy, tempo) travel on to the session, and analytics carry
> filter keys and counts only. The saved vibes in Settings are never written.
> The live feed itself, including the coverage line and any LLM reasoning, is
> delivered only to the session owner's authenticated socket (`user:<userId>`
> room); signed-out or other accounts' sockets never receive it (#2078).

> **Session requests receive priority (#2059).** Vision-neutral quality. A
> preset or described session keeps its own genres and moods separate from
> learned favourites. A matching track receives one `session_request` boost at
> weight 20, above the learned-preference cap of 18. Taste-memory hide and
> downrank controls still apply. My Mix uses its lane-local request for this
> boost, without adding a second ordinary-session boost. Learned favourites
> fill remaining slots, and coverage notes report misses. Home and sessions
> without a request retain their existing ranking.
>
> Starters use the shared upload vocabulary. (Superseded by #2249: the mood
> starters no longer carry genre lists and the brand names were dropped; see
> "AI DJ quick starts" below.) The upload options live in
> `web/src/lib/catalogVocabulary.ts`; starter tests check that every genre and
> mood belongs to that vocabulary.

> **The DJ keeps going on a small catalog (#2056).** Vision-neutral
> quality: no money, payout or fee changes. A listening session used to
> dead-end with `no_tracks` after one Next Pick on a catalog with few artists:
> every matching track was already in the session, or every artist already
> had two tracks in the last ten. When the strict pass finds nothing,
> `AgentSelectorService.select` (with `fallback`, set by the deterministic
> adapter for session start and Next Pick) retries in order: (1) the same
> matching tracks without the per-session artist window, keeping two per
> artist per pick (`fallback: "relaxed_artist_window"`); (2) mid session only,
> once the strict pass found matching tracks and every one is used, the 50
> newest catalog-wide tracks too (`fallback: "widened"`). A request nothing in
> the catalog matches is never widened, so the session says so and the unmet
> intent stays recorded (ADR-TE-4). Session tracks are never repeated, and
> hidden taste, the AI-content rule and the exploration share are never
> relaxed. The orchestrator now returns the selector's reason with
> `no_tracks`, and the web shows plain words instead of the status code:
> "You've heard everything that fits this session" or "Nothing in the catalog
> matches this session's filters yet".

> **Everyday genre quick starts (#2052).** Vision-neutral UX quality: no money,
> payout or fee changes. The quick starts come in two labelled rows. **Genres**
> holds seven everyday presets (Hip-Hop & Rap, R&B & Soul, Pop Hits, Afrobeats &
> Amapiano, Reggae & Dancehall, Latin & Reggaeton, World Music) built only from
> genres in the parser vocabulary, with an energy band and no mood. **Moods**
> holds the original five, whose filters and analytics intents are unchanged.
> Choosing, pointing at or focusing a preset shows a visible note with what the
> session is for and "You'll hear: …"; each chip also carries that text as its
> screen-reader description, outside its accessible name (the old hover-only
> `title` tooltip is gone). Artist names are not a filter yet, so "like
> Beyoncé" still appears under "Didn't catch"; that is a separate follow-up.

> **Session playback.** Starting a session from the AI DJ section plays the
> session's first picks in the player once they are recorded (the panel polls
> history for up to 45 s, then says it found nothing), and Next AI Pick plays
> its pick at once. Next AI Pick searches the same genres session start does
> (the listener's learned favorite genres plus the session's own) and excludes
> every track the session already picked, including the picks session start
> recorded as licenses. The set is continuous: one DJ run picks
> `AGENT_TRACK_LIMIT` tracks (default 12, was 5; #2242), and when the player reaches the last
> two tracks of the DJ's queue on any page (`AgentDjContinuation`, mounted in
> `AppShell`) the web asks for the next picks and appends them while the
> session is live. Every next-pick track is recorded on the session like the
> start picks, so session history counts the whole set and refills never
> repeat a track.

## Status

`partial`

The AI DJ and commerce-agent selector can now consume optional BigQuery-backed
user-track taste scores and joined listener cohort context as additive ranking
signals, and the analytics Dataflow output has a repeatable baseline
materialization path for warehouse scores.
The existing deterministic selector remains the default behavior: when BigQuery
taste signals are disabled, unavailable, or missing for a candidate track,
recommendations fall back to catalog, learned genre, embedding, and
metadata-derived audio-feature signals. When a listener has joined eligible
cohorts, the selector can also use safe cohort hints from transactional
membership state; this path does not require BigQuery or Dataflow.

This is the serving hook for a broader warehouse learning loop. A Dataform-ready
orchestration template now exists for scheduled materialization planning.
Session Intent feedback now lands in `AgentSignal` metadata, listeners can
govern the resulting taste memory from Settings, operators can monitor
aggregate recommendation quality in the AI DJ quality dashboard, and offline
fixtures can compare BigQuery ML scores against deterministic and
warehouse-baseline ranking before promotion. Vector indexes remain planned
follow-up work.

Issue [#977](https://github.com/akoita/resonate/issues/977) tracks the next
product evolution: using the running analytics pipeline to power AI DJ taste
intelligence, Session Intent presets, recommendation explanations, and quality
measurement.

## Roadmap

| Phase | Tracking | Outcome |
| --- | --- | --- |
| Analytics score materialization | [#981](https://github.com/akoita/resonate/issues/981) | Playback, save, skip, replay, purchase, session intent, and agent events produce bounded user-track scores. |
| Materialization orchestration | [#989](https://github.com/akoita/resonate/issues/989) | Dataform templates and GCP scheduling guidance define how Agent Taste jobs move from manual runs to managed execution. |
| Offline ML evaluation | [#978](https://github.com/akoita/resonate/issues/978) | BigQuery ML scores are compared against deterministic and warehouse-baseline ranking before promotion. |
| Analytics-derived explanations | [#983](https://github.com/akoita/resonate/issues/983) | Recommendation reasons include safe taste, intent, novelty, and commerce signals. |
| Intent feedback loop | [#980](https://github.com/akoita/resonate/issues/980) | Mood, vibe, Session Intent, completion, save, playlist, purchase, and session-duration outcomes feed back into `AgentSignal`. |
| Session Intent UI | [#979](https://github.com/akoita/resonate/issues/979) | The current preset gallery becomes a compact, instrumented agent-control surface. |
| Quality dashboard | [#982](https://github.com/akoita/resonate/issues/982) | Operators can monitor recommendation quality, preset usefulness, and model freshness. |
| Listener controls | [#1009](https://github.com/akoita/resonate/issues/1009) | Listeners can inspect, reset, hide, downrank, and consent-govern taste memory inputs. |

## Who It Is For

| Audience | Use |
| --- | --- |
| Listeners | Receive AI DJ recommendations that better reflect repeated listening, saves, skips, and purchases. |
| Agents | Score candidate tracks with collaborative taste fit before deciding what to recommend (the AI DJ never buys; purchases go through Crate Digger quotes). |
| Backend developers | Add warehouse-derived taste signals without replacing the runtime selector contract. |
| Data/ML developers | Materialize recommendation scores into a serving table consumed by the backend. |

## Value

The existing learning loop is intentionally local and explainable: it aggregates
weighted user signals into genre preferences. That is useful but shallow. The
warehouse can see richer patterns across listening, saves, purchases, skips,
session outcomes, and track metadata. BigQuery ML and Vertex-backed BigQuery AI
can turn those events into precomputed user-track scores that the agent uses as
another explainable signal.

## How It Works Today

1. The analytics event ledger exports playback, library, commerce, rights,
   agent, and generation facts into BigQuery.
2. A parameterized data job materializes `user_track_recommendation_scores`. The
   initial SQL lives in
   `workers/analytics-dataflow/sql/agent_taste_intelligence_baseline.sql`.
3. The backend sets `AGENT_TASTE_SIGNAL_SOURCE=bigquery`.
4. During candidate ranking, `AgentSelectorService` asks
   `AgentBigQueryTasteSignalService` for scores for the bounded candidate set.
5. Matching rows add a `bigquery_taste_score` recommendation signal and trace.
6. Missing rows or BigQuery failures return empty scores and keep the
   deterministic selector path intact.

Separately, `AgentSelectorService` can ask
`CommunityCohortService.getDiscoveryContextForUser()` for joined cohort context
for the current listener. That context is consent-gated, minimum-size gated,
and bounded to cohort-level labels and reason codes. Matching candidates receive
a `cohort_context` signal and safe explanation text such as "From your Dream Pop
listeners cohort"; hidden, left, stale, archived, expired, below-threshold, or
consent-disabled cohorts are not used.

The selector never performs an unbounded warehouse scan during recommendation.
It queries only the current `userId` and the candidate `trackIds` already found
by catalog search or semantic retrieval (#2088).

Agents never generate audio to fill a sparse selection
([ADR-TE-4](../strategy/taste-engine-decisions.md)). Every candidate comes from
the existing catalog, and AI-generated tracks stay out of this promotional
surface (ADR-BM-5.3). When the catalog cannot fill the requested track count, the
orchestrator returns fewer tracks with an explicit `shortfall` (requested minus
returned) and records the unmet intent (`genres`, `mood`, `energy`) on the
`agent.decision_made` event instead of padding with generated tracks. The
`agent.generation_triggered` analytics event is retired: nothing emits it.
Remix Studio generation is unaffected and stays credit-billed. Details:
[Agent Commerce Runtime](agent-commerce-runtime.md#no-generation-from-agents-adr-te-4).

Listener governance controls live in
[Listener Taste Memory Controls](listener_taste_memory_controls.md). Hidden and
downranked signals are applied before recommendation reasons are returned,
declared "more of this" (`boosted`) signals weight a matching genre or mood at
x1.5 and add a declared-preference ranking signal (#1961), reset
markers exclude older `AgentSignal` rows from learned profiles, and future
social/cohort use of private taste data is disabled unless the listener opts in.

Realtime agent-signal metadata is bounded before normalization. Each raw string
must fit its existing field contract (from 16 to 240 characters), and genre and
recommendation-explanation arrays are capped before their elements are scanned.
The shared normalizer removes closed tag segments, control characters, unsafe
identifiers, URLs, and email addresses using bounded work; an over-limit field
is omitted rather than truncated or partially interpreted.

## Serving Table Contract

Default table:

```text
user_track_recommendation_scores
```

Required columns:

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `STRING` | Pseudonymous or internal user identifier used by the backend. |
| `track_id` | `STRING` | Track identifier from the catalog. |
| `recommendation_score` | `FLOAT64` | Normalized `0..1` taste-fit score. Values outside the range are clamped by the backend. |

Optional columns:

| Column | Type | Notes |
| --- | --- | --- |
| `confidence` | `FLOAT64` | Normalized model confidence. |
| `rank` | `INT64` | Precomputed rank for the user. |
| `explanation` | `STRING` | Short human-readable reason attached to the recommendation signal. |
| `model_version` | `STRING` | Training or materialization version. |
| `updated_at` | `TIMESTAMP` or `STRING` | Freshness marker. |

## Learning from listening habits (#2062)

Status: `implemented` locally; the broader [habit-mixes epic #2061](https://github.com/akoita/resonate/issues/2061)
remains `in-progress`. This slice is vision-neutral infrastructure (ADR-BM-6),
enabling Line 4 Listener Pro, phase 4, without fee, payout or purchase changes.

The player feeds bounded feedback through analytics instrumentation into
`AgentSignal`. Weights and the seven-day replay lookback live in
`backend/src/config/agent_learning.ts`.

| Consented action | Signal | Weight |
| --- | --- | --- |
| Playback starts, including playlist starts | `accept` | +1 |
| Deliberate skip | `skip` | −1 |
| First completion, or no recent completion | `complete` | +1.5 |
| Completion following a completion/replay in the last seven days | `replay` | +2 |
| Segment loop enabled or finite repeat count set | `loop` | +2.5 |
| Library save / removal | `save` / `unsave` | +3 / −2 |
| Track added to playlist | `add_to_playlist` | +3 |

A replay replaces the completion signal for that occurrence. Repeat-one cycles
qualify through their preceding completion; merely enabling repeat-one does not
make the first play a replay. Replay history is scoped to the listener and track
and excludes pre-reset signals. Heartbeats and loop/repeat updates or clears do
not create learning signals. Agent-originated playback is excluded from the
analytics mirror because the agent runtime records its own signals.

Loop intent is capped once per track and browser session across segment loops
and finite repeat counts. Playback instance IDs and client event IDs suppress
retries; database-backed deduplication and serialized user writes also cover
concurrent requests. Playlist starts retain `playlistId` on their existing
`accept` signal. `playlist.played` is not mirrored again, avoiding two signals
for one start. Browser session IDs are pseudonymized in metadata, separate from the agent
`Session` foreign key. `loop` and `unsave` are telemetry-only actions on this
path; the manual agent-signals endpoint cannot bypass their consent and
deduplication controls.

The authenticated analytics routes require current product-analytics consent.
Persistence rechecks that consent and `agentPlaybackTrainingEnabled` for mirrored
feedback. A refusal or disabled training produces no habit signal. Existing
Taste Memory hide, downrank and reset controls continue to govern the learned
profile.

Playback lifecycle and completion payloads carry optional `localHourBucket`
(`night`, `morning`, `afternoon`, `evening`) and `weekdayKind` (`weekday`,
`weekend`). The browser computes these locally; the API rejects invalid values
with 400. Only the bounded categories reach signal metadata and warehouse fact
dimensions. No time zone or exact local time is collected.

Home's `recommendation.served` and `recommendation.clicked` events remain the
measurement base for discovery outcomes. The profile now computes decayed multidimensional weights (#2063), described
below. My Mix, habit ordering and measurement are implemented in #2065–#2067;
see the [epic plan](../../.agents/plans/2061-habit-mixes.md).

### Verification

- Backend: focused analytics controller HTTP, instrumentation, warehouse/parity
  and agent-habit integration tests. The integration fixtures exercise real
  Postgres persistence, concurrent retries, consent and training gates.
- Web: fixed-clock playback context boundaries and payload/provenance tests.
- Dataflow: `python -B -m unittest test_analytics_transform` verifies fact
  dimensions; shared playback fixtures keep TypeScript/Python transforms aligned.

## Habit profile v2 (#2063)

Status: merged with #2062. Vision-neutral infrastructure (ADR-BM-6), enabling
Line 4 Listener Pro, phase 4. Listening lanes are merged in #2064; My Mix is
implemented in #2065, with habit-aware ordering in #2066. Measurement is implemented in #2067.

`agent-taste-profile/v2` keeps the existing score, tier, favored genres and
`genreWeights` fields consumed by Home and the AI DJ. It adds aggregate maps:

| Dimension | Source |
| --- | --- |
| Genre and mood | Release genre and mood labels |
| Artist | Credited artist labels, with catalog artist metadata as fallback |
| Energy band and tempo band | Current original full-mix measurements; missing, inferred or unreliable tempo is omitted |
| Context | Eight possible hour-bucket × weekday/weekend combinations, each with genre and mood weights |

Behavioral weights halve every 60 days. Purchase, pledge and collect weights
halve every 365 days; this profile does not introduce new commerce ingestion.
History is bounded to the newest 500 signals within 730 days. These limits and
half-lives live in `backend/src/config/agent_learning.ts`. Declared controls do
not decay. Hidden genre/artist tracks are excluded, hidden moods are removed,
and downrank/boost multipliers apply to their dimension and contextual weights.
Reset excludes signals at or before its marker across all dimensions.

Signal writes persist the v2 profile on `AgentConfig.learnedTasteProfile`.
Shared profile reads recompute bounded history so time decay and current
controls take effect without another play. A valid legacy v1 snapshot remains
readable where no signal history exists to upgrade it. Older clients can keep
using genre fields; additional maps are optional in client types.

In **Settings → Taste Memory**, safe summaries show top genres, moods, credited
artists, measured energy/tempo bands, and contextual preferences such as
evenings on weekdays. Summaries contain no itemized playback history, track IDs,
exact local timestamps or time zones. Empty dimensions say there is not enough
signal yet. Reset clears every learned summary while retaining declared edits.

Verification: fixed-clock learning tests cover decay, controls, reset, bounds
and compatibility; real Postgres tests cover feature provenance, persistence,
profile resolution and safe summaries. Component tests cover older responses,
new summary rows and reset. See the [implementation plan](../../.agents/plans/2063-habit-profile-v2.md).

## Listening lanes (#2064)

Status: merged on the #2063 dependency; the parent feature remains
partial. Vision-neutral infrastructure (ADR-BM-6), enabling Line 4 Listener Pro,
phase 4. Lane summaries and controls in Taste Memory remain free. My Mix and
quota editing are described below in [#2065](https://github.com/akoita/resonate/issues/2065).

A lane captures a repeated side of a listener's taste, such as weekday-evening
Soul or weekend Dancehall. The deterministic computation groups governed genre,
mood and coarse context evidence by session and assigns sorted groups to
similar centroids. Similarity compares normalized category proportions; signed
weights retain evidence strength, so skips and removals reduce matching habits.
This bounded greedy method does not seek a globally optimal partition. It uses
catalog vocabulary from `taste_edit_vocabulary.ts`; aliases normalize to catalog
terms and unsupported labels are omitted. No model or embeddings name lanes.
Energy bands require measured full-mix features.

Evidence uses the v2 decay, reset and hidden/downrank/boost policies. A lane
requires at least two sessions and the configured minimum decayed weight.
Missing session identity cannot establish repeated evidence. At most six lanes
are returned; two observed lanes are valid and the system does not invent a
third. Insufficient evidence returns no lanes, allowing callers to use the
existing single-profile fallback. Thresholds live in
`backend/src/config/agent_learning.ts`.

`GET /recommendations/taste-memory` adds optional `summary.listeningLanes` cards
with catalog genre/mood weights, a strength share, coarse contextual weights,
measured energy and an opaque ID. Cards include hidden state for restoration.
`POST /recommendations/taste-memory/signals` accepts a current listener-owned
lane ID with `signalType: "lane"` and `action: "hidden"`; downranking lanes is
rejected. The existing owned-control DELETE restores it. Mix-facing
`resolveListeningLanes` excludes hidden lanes. Home uses the shared profile;
the DJ uses lanes when the listener chooses My Mix.

Derived summaries are cached per user and profile version in a bounded
128-entry process-local cache. The version covers bounded history, catalog
features, sessions and controls, with an hourly epoch for silent decay. Reads
still query bounded history to detect edits; cache entries retain derived
summaries only. Reset clears lane cards and lane hides while preserving declared
preferences and ordinary catalog controls. No raw sessions, tracks or precise
listening timestamps appear in lane summaries.

Verification covers fixed-history determinism, evidence thresholds, catalog
labels, hidden values, measured energy and bounded computation. Real Postgres
checks cover cache invalidation, user isolation, hide/restore and reset; mounted
browser checks cover the corresponding cards. See the
[implementation plan](../../.agents/plans/2064-listening-lanes.md).

## My Mix (#2065)

My Mix appears first among the AI DJ quick starts when Taste Memory has visible
listening lanes. It blends those lanes into one free session. Stronger lanes
receive more picks, and the broad local time context increases the share of
lanes associated with that time. The client sends only the existing coarse
time-of-day and weekday/weekend categories. Largest-remainder rounding turns
the shares into whole-track quotas for each batch.

Before starting or while listening, remove a lane, boost its share, or add a
catalog genre or mood. These edits affect the session only. Saving a preference
to Taste Memory is a separate explicit action that saves added categories and
boosted lanes' catalog terms, leaving removed lanes as session-only choices.
The editor reads the full vocabulary from the authenticated
`GET /agents/config/session/mix-vocabulary` route. The server resolves current
listener-owned visible lanes on every run; client labels and weights cannot
override hidden taste or invent learned lanes.

Each lane ranks tracks as a session request, then the shared policy applies
hidden taste, AI-content exclusions, exploration and artist diversity globally.
My Mix supplies the optional `sessionRequest` ranking context, with its boost
above the learned-preference cap. Home and ordinary sessions do not supply this
new context in this slice; the broader preset/request fixes remain in #2059.
Exploration picks can satisfy a matching lane quota. Missing slots transfer to
stronger lanes before the existing catalog fallback. Original lane coverage
remains visible: unrelated fallback tracks never count as covering a lane.

Unmet lane requests use the existing consent-gated unmet-demand mechanism.
Pick explanations name the actual lane and preserve discovery explanations.
The existing demand source attributes observations only to verified playable
catalog owners. A wholly absent genre still appears as missing coverage, but
does not produce an artist-attributed observation without catalog evidence.

Session start and Next Pick bind lane reads to the authenticated owner.
`GET /agents/config/session/:sessionId/mix-coverage` returns initial coverage
from a bounded ephemeral cache; Next Pick includes `mixCoverage` directly.
Lane labels and IDs never enter the public live event feed. Cache loss means
initial coverage is unavailable until another pick, rather than stored history.

My Mix uses the deterministic orchestrator even when a model runtime is
configured, so quotas and coverage do not depend on model output. Without lanes,
the existing presets and single-profile behavior remain available. This slice
does not introduce a new model tool or authorize purchases.

Revenue alignment: ADR-BM-6 Line 4, Listener Pro phase 4 candidate, with free
basic mixes supporting Line 1 engagement. The advanced entitlement seam is OFF;
saved named mixes, per-lane energy arcs and length/order controls are not
available. Default habit ordering is described below; evaluation is implemented in #2067. No fees,
royalty shares, payouts, deployment wiring or contract behavior change.

Verification and API details: [implementation plan](../../.agents/plans/2065-my-mix.md).

## Habit-aware ordering (#2066)

My Mix keeps its selected tracks and quotas, then groups picks into short lane
runs before planning transitions. Default ordering is free (ADR-BM-6 Line 4,
Listener Pro phase 4 candidate; free basics support Line 1 engagement). No fee,
payout, purchase or entitlement activation changes.

The owner-scoped ordering service derives decayed lane-pair counts from the
existing, bounded `AgentSignal` history. Only trusted playback telemetry with
current analytics consent and enabled playback training teaches transitions.
An actual playback start establishes an episode; completion, replay or a save
supports its incoming transition, while a skip within 30 seconds and the first
quarter of a known duration counts against it. Retries count once, delayed
outcomes attach to their original episode, and unmatched or currently hidden
music breaks the chain. Reset and current hidden controls apply on every read.
No new raw history, persistent transition table or public taste payload is added.

Central defaults require three decayed transitions overall and one for a lane
pair. Short runs aim for three tracks, with a maximum of four where a suitable
switch exists. Learned ordering avoids a habitually skipped transition when an
alternative exists; sparse evidence uses lane strength, measured energy
continuity and original rank. Only measured features constrain energy jumps.
A jump of two energy bands needs three decayed positive examples and a positive
share of at least 75%, unless no compatible remaining pick exists.

Across batches, the boundary comes from actual started playback associated
with the DJ session, rather than queued picks. Ordering returns a permutation
of the exact selected objects, preserving exploration, artist diversity,
explicit/AI/hidden filters, lane assignments, coverage and pick explanations.
An unavailable history read falls back to neutral ordering. Ordinary sessions
keep their existing rank order.

Owner-only session history can include `mixTrackIds`, the ordered latest batch
from the existing bounded My Mix cache. Initial autoplay uses these IDs instead
of unordered pick-log rows. Cache loss retains the existing history fallback;
this field does not store actual playback or transition counts.

Verification covers deterministic ties, duplicate track IDs, exact permutations,
short runs and actual playback boundaries, decayed evidence, early skips,
measured versus inferred energy, owner isolation and current consent/reset/hidden
controls. See the [implementation plan](../../.agents/plans/2066-habit-ordering.md).
Measurement is implemented in [#2067](https://github.com/akoita/resonate/issues/2067).
Advanced ordering styles remain behind the OFF Listener Pro seam; tempo,
Camelot and DSP sequencing remain gated future work in
[#1971](https://github.com/akoita/resonate/issues/1971).

## Meaning-aware retrieval and explicit content (#2088)

Catalog genres are free text typed by artists ("African", "French Rap",
"Hip Hop"), so literal keyword retrieval missed obvious fits: a World Music
session never saw an "African" release, and "Hip-Hop" never matched "Hip Hop".
Every model and ranking step works on the candidates retrieval hands it, so
retrieval itself now understands meaning.

- **Genre families.** `backend/src/modules/recommendations/genre_families.ts`
  is one pure, spelling-insensitive vocabulary (case, spacing, hyphens, accents
  and `&` are normalized). A requested term resolves to the families it names
  or narrowly belongs to; `broad` families (World, African, Electronic, Latin)
  are reached only by their own names, so "World" matches an Afrobeats release
  but "Afrobeats" does not widen to all of World. Release genres belong to every
  family one of whose members appears in them as whole words. The same module
  drives:
  - `catalog.search`: a genre query also searches its family's labels
    (`expandGenreSearchTerms`); the title match stays literal;
  - the ranking core's `session_request` signal (`genreMatchesRequest`);
  - request coverage ("Only N of M picks matched …").
- **Semantic retrieval.** The `catalog.semantic_search` tool embeds a
  description of the session and returns catalog-wide nearest neighbours
  (`TrackEmbeddingService.neighboursOfVector`) at or above the cosine floor
  `AGENT_SEMANTIC_MIN_SIMILARITY` (default `0.55`), with the explicit and
  AI-promotion filters applied. The deterministic selector adds these
  neighbours to its keyword candidates when the session asked for something
  itself (`buildSemanticSessionQuery`: intent, requested genres plus related
  family labels, moods, energy); learned taste alone never triggers it. The
  floor keeps ADR-TE-4 intact: a request nothing in the catalog resembles still
  finds nothing, so it is never widened and its unmet demand stays recorded.
  Retrieval fails open to the keyword candidates, and returns nothing while
  embeddings are disabled. Only tracks with a stored vector can be found this
  way; tracks are embedded on ingest, lazily when they become DJ candidates, or
  by the admin backfill.
- **LLM curator.** The ADK and Vertex curators get a `semantic_search` tool and
  are told that catalog genres are free text and to fill the selection target
  when enough tracks fit (still never dumping the catalog or generating audio).
- **Explicit content.** `AgentConfig.allowExplicit` (default `false`) is the
  listener's saved "Include explicit tracks" choice, toggled from the AI DJ
  session panel (`PATCH /agents/config` with `allowExplicit`). Session start and
  every Next Pick resolve it server-side (`resolveAllowExplicit`: a boolean sent
  with the session wins, otherwise the saved value), so a toggle applies from
  the next pick. The curator's tools no longer expose `allowExplicit` to the
  model: the server forces the session's value onto every catalog call.
- **Follow-ups.** "More like this" expansion from the session's own picks
  (seed-track neighbours) and tuning the similarity floor against real
  embeddings. The golden-eval cases for World → African and Rap → explicit rap
  are in the retrieval golden set below (#2235).
- Tests: `genre_families.spec.ts`, `agent_semantic_selector.spec.ts`,
  `agent_curator_session_controls.spec.ts`, `agent_explicit_preference.spec.ts`,
  `agent_semantic_retrieval.integration.spec.ts`,
  `agent_config_allow_explicit.integration.spec.ts`,
  `sessions.integration.spec.ts`, `discovery_ranking_session_request.spec.ts`,
  `agent_session_request.spec.ts`.

## AI DJ retrieval golden set (#2235)

A fixed, hand-labelled catalog (about 65 tracks) and 21 requests measure how
many of the tracks a listener expects the AI DJ actually ranks first. Each case
runs the real session path (request parser, session preferences,
`AgentSelectorService`, `DiscoveryRankingService`) and reports **recall@10** and
**recall@20** read off the ranked candidate list, plus the share retrieved at
all, so a retrieval miss can be told from a ranking miss. The numbers are the
baseline for any later retrieval or genre-matching change: a case may rise, not
fall. Cases the current ranker misses are kept as known gaps with the value it
achieves today, never a higher one. An unmatched request must stay an honest
unmet request (ADR-TE-4).

Only the deterministic path is measured. Embedding-backed semantic retrieval is
off in the eval because it needs a real embedding model, so the sentence's
semantic query (#2241) and the artist centroid neighbours are covered by unit and
integration tests instead (`agent_session_sentence.spec.ts`,
`agent_dj_sentence_meaning.integration.spec.ts`). Artist-name seeding is
measured here, because a resolved artist's own tracks need no embeddings. Every fixture track
carries the descriptor the deterministic backfill produces for it (#2240).

| Case | Recall@10 | Recall@20 | Known gap |
| --- | ---: | ---: | --- |
| World → African, Mandingue, region (West Africa) | 100% | 100% | none |
| World → country name (Senegal) | 100% | 100% | none (track descriptor, #2240; was 0% / 0%) |
| World → release with no genre | 0% | 100% | found only via its title and release title (kora, Bamako) in the track descriptor; ranks 14th (was 0% / 0%) |
| World → every World-family track (14) | 71% | 100% | equal scores keep catalog order, so the four oldest slip past rank 10 (was 71% / 86%) |
| Hip-Hop, explicit allowed → explicit rap | 100% | 100% | none |
| Hip-Hop, explicit off → clean rap, no explicit track | 100% | 100% | none |
| Rap → French Rap, Trap, Drill | 100% | 100% | none |
| Hip-Hop → every hip-hop-family track (13) | 77% | 100% | equal scores keep catalog order |
| "warm deep house for cooking" | 100% | 100% | none |
| "something to focus" | 100% | 100% | none |
| "40-minute run" | 0% | 0% | the parser reads nothing, so no genre is asked for |
| "like <catalog artist>" (also lower case, and a one-letter typo) | 100% | 100% | none (was 0% before #2241; the lower-case and typo cases were added with it) |
| Calm and low energy → track titled calm | 100% | 100% | none |
| Calm and low energy → measured low energy, no mood tag | 0% | 0% | mood words match only genre and title |
| Nothing matches (Gregorian Chant) | n/a | n/a | stays unmet (`no_matching_taste_candidates`) |

Mean over the 20 scored cases: recall@10 82%, recall@20 90% (was 69% / 71%
before track descriptors (#2240) and the sentence and artist-name work (#2241);
the two aggregate rows weigh the same as a single-track case). "40-minute run"
stays at 0%: its gain would come from the sentence's semantic query, which this
eval cannot measure.

- **Runners.** `backend/src/tests/agent_golden_eval.spec.ts` (`npm run
  eval:golden`, no Docker) runs the cases over an in-memory twin of
  `catalog.search`. `backend/src/tests/agent_dj_retrieval_golden.integration.spec.ts`
  (`npm run test:integration`) seeds Postgres under a unique prefix and runs the
  real search; its last test checks both report the same numbers.
- **Report.** Both write a per-case table and JSON to
  `backend/eval-results/dj-retrieval-golden-results-*.{md,json}` and print the
  table to the console. The cases and baselines live in
  `backend/src/tests/dj_retrieval_golden/fixtures.ts`.
- **Ratcheting.** When a change improves a case, raise its `baseline` in the
  same PR. Never lower one to make a run pass.

## Enriched track descriptors (#2240)

The keyword gate and the track embedding both used to depend on the free-text
genre an artist typed, so "Bambara", a country name, or no genre at all was
invisible to a "World" session. Each track now has a stored, versioned
**descriptor** (`TrackDescriptor`, one row per track, cascade-deleted with the
track): genre **families** (ids of `genre_families.ts`), free **sub-genres**,
measured **tempo** and **energy** bands (from the full-mix features, #1959,
same confidence gates and thresholds as the AI DJ audio features) and a
**vocal / instrumental** value (only from an explicit word such as
"instrumental"; no vocal measurement exists yet). `source` is `deterministic`,
`model`, or `artist` (a correction by the release team, #2292).

- **Strategy** (`TRACK_DESCRIPTOR_STRATEGY`). `deterministic` (default): the
  shared family matcher over the genre and its `/ , ;` parts, plus a small
  conservative place lexicon (African, Middle Eastern, Latin American and a few
  other countries, regions, cities and traditional instruments) read from the
  genre, title and release title. `model-assisted`: the same, then one model
  call per tag run, following the crate request parser pattern: bounded JSON
  data under a "data, not instructions" rule, strict schema, every family tag
  re-validated against the vocabulary, unknown tags kept as short plain-text
  sub-genres (at most 40 characters and 4 words), deterministic fallback on a
  missing key, timeout or malformed output. The model never sets a band and
  never touches a track, release, disclosure, moderation or rights column; the
  tagger writes `TrackDescriptor` only.
- **Pay once per track.** A content hash over the sanitized inputs (genre,
  title, release title), the measured bands, strategy, model and descriptor
  version decides whether to tag. Equal hash: nothing runs. A failed model
  call stores the deterministic result under the deterministic hash, so a
  later run retries it. A model descriptor under 24 hours old is kept even if
  the inputs changed (edit rate limit), and a call budget
  (`TRACK_DESCRIPTOR_DAILY_CALL_BUDGET`, per UTC day and process for ingest;
  `--max-model-calls` per backfill run) falls back to deterministic tagging and
  logs `catalog.track_descriptor.budget_exceeded` once per window.
- **When it runs.** On `catalog.release_ready` (non-blocking; a failure never
  fails or delays an upload) and by `npm run catalog:backfill-descriptors`
  (`:prod` for the built script): dry run by default (no write and no model
  call; reports `wouldCallModel`), `--apply`, `--limit N` (default 500, re-run
  until `deferred` is 0), `--max-model-calls N`, `--reembed` (embed the changed
  tracks now). Never on the AI DJ session or pick path, which only reads stored
  descriptors.
- **Embedding.** The track embedding text (format v2) appends the descriptor
  (families, styles, bands). A track without a descriptor renders exactly as
  before, so its hash is unchanged and nothing is re-embedded needlessly; a
  tagged track's hash changes and the existing incremental embedding backfill
  (or embed-on-ingest, which now tags a release first) re-embeds it. After a
  descriptor backfill, run the embedding backfill to completion, or use
  `--reembed`.
- **Retrieval.** `catalog.search` also matches `descriptor.families` for the
  families a query names, the ranking core's session-request signal and request
  coverage accept a descriptor match next to the release genre
  (`genreOrDescriptorMatchesRequest`), so "World" reaches a track whose genre
  says "Senegal". My Mix lane membership still reads the release genre only
  (follow-up).
- **Artists.** The release page shows each track's tags to people who manage
  the release (owner route `GET /catalog/me/releases/:releaseId` returns
  `tracks[].descriptor`; public responses never do), with the line "Suggested by
  Resonate from your track's details and sound". Corrections are below (#2292).
- **Artist corrections (#2292).** The release owner, or a manager holding the
  track-metadata scope (the same authority that edits a track's title), can
  correct a track's **genre families** and **sub-genres** from the release page
  ("Edit tags"). `PUT /catalog/releases/:releaseId/tracks/:trackId/descriptor`
  with `{ families: string[], subGenres: string[] }` replaces both lists
  (removals are absences; an empty list is allowed). Rules:
  - *Controlled vocabulary only.* Families must be ids from the genre families.
    A sub-genre must be a label of the vocabulary (every genre-family member
    plus the place lexicon, served by the public
    `GET /catalog/descriptor-vocabulary`), or a label already on the track, so a
    generated free label can be kept or removed but no new free text is added.
    At most 8 sub-genres. Anything else is a `400`, a non-manager is a `403`,
    a track not on the release is a `404`.
  - *Bands stay measured.* Tempo, energy and vocal are not part of the body and
    are copied from the existing descriptor (or computed from the measured
    features when the track was never tagged). They are shown in the editor as
    plain text with "measured from the audio and cannot be edited".
  - *Stored as `source: "artist"`.* The tagger skips such rows (counted as
    `skippedArtistOwned`; the backfill prints `kept (artist-written)`), and its
    write is conditional (`source != artist`), so a tagging run that read the
    generated row before the correction cannot overwrite it either.
  - *Re-embeds the track.* The service publishes `catalog.updated`, which
    `TrackEmbeddingService` already handles; the descriptor is part of the
    embedding text, so the content hash changes and the vector is rebuilt.
  - *Known gap.* An artist-written row is never re-tagged, so its measured bands
    do not refresh after an audio replacement (families and styles are the
    artist's; the bands are copied at correction time).
- **Inputs not available.** The schema has no release description and no artist
  country or region, so those are not inputs yet.
- **Tests.** `track_descriptor.spec.ts` (mapping, validation, injection, hash,
  embedding text), `track_descriptor.integration.spec.ts` (dry run, idempotent
  apply, hash change, limit, fake-provider model path with fallback, budget and
  cooldown, protected columns, ingest hook, embedding, retrieval), the golden
  set above, and `TrackDescriptorTags.test.tsx`. Corrections:
  `track_descriptor_correction.integration.spec.ts` (owner, credited manager,
  `401`/`403`/`404`/`400`, survives re-tag and backfill and a racing tagger
  write, re-embeds), `catalog.controller.http.spec.ts` (DTO `400`s) and
  `TrackDescriptorEditor.test.tsx`.

## Reading the listener's sentence for meaning (#2241)

Status: shipped as one slice. The model-assisted reading is **off by default in
every environment**; enabling it is a per-environment flag (deployment half:
resonate-iac#318) to be turned on only after it passes the golden set.

- **Semantic query.** The raw sentence (500 characters at most) joins the
  session's semantic query for that session only, as `Listener request: ...`. It
  travels as `preferences.requestText`, is held in memory for the live session
  (like the request filters), and is never stored, logged, published on the event
  bus, or written to the session row or the browser's storage. Because the query
  text is identical on every pick, `EmbeddingService.embedQuery` keeps one vector
  per (model, text hash) in memory for 30 minutes: a session start embeds the
  query once and every pick after it embeds nothing. (Before this, each pick
  re-embedded the query.)
- **Artist names.** Cued names (`like X`, `more X`, `more from X`, `similar to X`,
  `by X`, `X-style`, `X vibes`) resolve to a credited catalog artist: a release's
  `primaryArtist`, or the artist account name when none is credited. Matching is
  case-, accent- and punctuation-insensitive; a near miss resolves only when it is
  conservative (name of 7+ letters, one edit, or two from 13, same first letter,
  and only one catalog name that close). A genre or mood word never reads as an
  artist, and an uncued name is not read. An unknown name stays under "Didn't
  catch". The web shows a resolved artist as a removable "Like: <Artist>" chip.
- **Seeds.** Resolved artists become seed neighbours in the existing semantic
  step (no fusion framework; that is #2242): `catalog.artist_seed` adds the
  artist's own tracks (up to 8) and the neighbours of the centroid of their stored
  track vectors (needs stored vectors only, no embedding call), at most 20
  candidates per pass, explicit and AI-promotion filters applied, failing open.
  Own tracks score as a perfect semantic match, neighbours keep their cosine.
- **Model-assisted parser.** `AGENT_SESSION_PARSER_STRATEGY=model-assisted`
  reuses the Crate Digger model parser (`model_crate_request_parser.ts`) in
  "session mode", separate from `CRATE_REQUEST_PARSER_STRATEGY`. The rules always
  run first; the model runs only when they left part of the sentence unread, so a
  fully read sentence makes no call. At most one call per parse; none on the pick
  path. Output is schema-bound JSON with no tools, re-validated against the
  allowed genre and mood lists, tempo numbers kept only when their digits are in
  the sentence, artist names kept only when the words are in the sentence AND the
  catalog resolves them (never model-supplied ids). The call is cancelled by an
  `AbortSignal` at the timeout; a missing key, timeout, provider error or
  malformed output falls back to the rules, logging a fixed reason code only.
  Results are cached by (model, normalized text hash); each listener has a daily
  and per-minute model budget and there is a global daily circuit breaker; over
  budget the rules-only parse is used silently. Counters are per server
  instance.
- **Call counts.** `agent_session_parser.spec.ts` (parse calls, cache, budget,
  injection fixtures) and `agent_dj_sentence_meaning.integration.spec.ts` (a
  session start makes at most one parse call and one query embedding; four later
  picks make none of either).
- **Not done / follow-ups.** The model sees a sentence on each debounced
  parse-as-you-type, bounded by the cache and the per-listener budget rather than
  strictly once per Start; the 40-minute-run and "cooking" gains need a
  measurement with real embeddings (#2242 hybrid retrieval). Artist chips are not
  yet shown in Session History.

## Hybrid retrieval with budgets (#2242, variant `hybrid_rrf_v1`)

Status: shipped behind a ranker variant, **not promoted**. The default path is
unchanged for everyone until the variant is assigned (see Variant).

Before this, the DJ unioned keyword candidates (20 per query), semantic
candidates above one fixed similarity floor and artist-seed candidates, and
measured tempo/energy only re-ranked tracks that were already retrieved. Under
`hybrid_rrf_v1` the selector (`AgentSelectorService`, before the shared ranking
core) gathers candidates from six sources in parallel and fuses them (the sixth,
`trending`, is #2246; see its section below).

**Sources, each with its own candidate budget** (`AGENT_RETRIEVAL_BUDGETS`,
default 20 each, 1..50):

| Source | Retrieves | Notes |
| --- | --- | --- |
| `keyword` | `catalog.search` per query (genre families, descriptor families, title) | Budget is per query. The widened pass keeps its catalog-wide 50. |
| `semantic` | `catalog.semantic_search` from the session sentence's cached query vector | Top-k plus the calibrated floor below. Skipped when embeddings are off. |
| `audio_range` | `catalog.audio_range`: tracks whose **measured** energy band (stored descriptor) or measured BPM window fits the request | Reads stored values only; tempo needs the extractor's confidence gate; inferred values never retrieve. Runs only when the request names energy or tempo **and no genre**, so a genre request is never answered with unrelated tracks of that energy. |
| `lane` | My Mix lane terms (genres and moods) the keyword source did not already search, per lane | Only when lanes are active; the existing lane filter and quotas still decide membership. |
| `seed` | The listener's seeds by kind. Artist names today (`catalog.artist_seed`: own tracks plus vector neighbours) | `AgentSelectorInput.seeds = { artists?, trackIds? }` (`seedArtists` still works and merges). A new kind (`trackIds`: a current track or playlist, #2243) is one more field and one more runner in the seed source; fusion and budgets are unchanged. |
| `trending` | `catalog.trending`: this week's popular tracks in the listener's top genre families, or in the families the request names (#2246) | Reads the popularity serving tables only; capped at a share of the fused list; request sessions only get tracks that match the request. See "Trending as a source (#2246)". |

**Fail open and latency.** Every source runs under one deadline
(`AGENT_RETRIEVAL_TIMEOUT_MS`, default 5000; it was 1500, which keyword and
semantic retrieval both overran on every pick on a small staging database). An
error or a source still running at the deadline removes only that source's
candidates; the reason code (`tool_error`, `deadline_exceeded`) is logged, never
the error text, and the selection reports `retrieval.sources[]` (status, reason,
candidates, duration). Each hybrid retrieval logs `agent.retrieval.sources` with
every source's status and duration, so the budget can be tuned from real
numbers. If every source that ran failed, that pick falls back to the default
retrieval instead of returning nothing, logged as
`agent.retrieval.hybrid_fallback` with what each source did; only if the default
path fails too does the pick fail. A hybrid pass that ran but found nothing is
an honest empty result and is not retried.

**Fusion.** Reciprocal-rank fusion over every source ranking: a track's score is
the sum of `1 / (60 + rank)` over the lists that contain it (k = 60, the
constant from the original RRF paper, not tuned). The fused list, capped at
`AGENT_RETRIEVAL_MAX_CANDIDATES` (default 150), is handed to the shared ranking
core in fused order. Fusion only orders and bounds candidates; it adds no score.
The six rules (ADR-TE-2), hidden and downranked taste, the explicit preference
and the AI-promotion filter run after it, unchanged.

**No hidden widening (ADR-TE-4).** An unmet request stays unmet: a source with
nothing to add contributes nothing, and the audio-range source is off for genre
requests. What a source added alone is visible: `retrieval.onlyFrom`, each
pick's `agentRecommendation.retrievedBy`, and, for a track only the audio-range
source found, the explanation "Found by its measured energy or tempo, not by a
tag."

**Similarity floor.** Under the variant the fixed `AGENT_SEMANTIC_MIN_SIMILARITY`
gate is replaced by top-k plus a calibrated floor: of the `limit` nearest
neighbours keep those at or above `max(0.50, best score - 0.15)`
(`CALIBRATED_SEMANTIC_ABSOLUTE_FLOOR`, `CALIBRATED_SEMANTIC_RELATIVE_MARGIN` in
`agent_runtime.config.ts`). The absolute floor is lower than the fixed 0.55, so a
relevant track just under it is reachable; the relative margin trims the tail
behind a strong match; when even the best neighbour is under the absolute floor
nothing is kept. `AGENT_SEMANTIC_MIN_SIMILARITY` still overrides the absolute
floor when set. **Calibration caveat:** the golden set can only be run with the
offline `hash` embedder here (no real-model scores were available, and no
embedding call is made by this work). On it, every absolute floor from 0.3 to
0.7 gives identical recall and an unmet request stays unmet at every one
(`agent_hybrid_semantic_calibration.integration.spec.ts`), so the golden set
cannot discriminate between values. 0.50 / 0.15 are therefore structural
defaults chosen to be lower than the old floor with a bounded tail, and must be
re-checked against production embeddings before promotion.

**Variant.** `hybrid_rrf_v1` uses the existing ranker-variant mechanism (#2005):
set `DISCOVERY_RANKER_EXPERIMENT=<key>:hybrid_rrf_v1=<percent>`. The selector
reads the listener's deterministic assignment (`discoveryVariantForUser`), and
the DJ's `recommendation.generated` events already record `rankerVariant` (and
`experimentKey`), so skip rate and resonant discoveries are attributable per
variant. The experiment env is shared with the other arms (one key at a time).
Home impressions of a listener in the bucket carry the label too but Home
ranking is unchanged. Offline evaluation pins the variant with
`AgentSelectorInput.retrievalVariant`.

**Cost.** Postgres/pgvector queries and the one already-cached query embedding;
no new external call and no model call on the pick path. The audio-range tempo
filter reads the stem JSON column unindexed and is bounded by its budget and
the deadline; add an index only if the recorded source durations call for it.

### Offline evidence (golden set, both runners, per case)

`agent_golden_eval.spec.ts` (Docker-free) and
`agent_dj_retrieval_golden.integration.spec.ts` (real Postgres) now run every
case twice and assert the hybrid variant never does worse than the current path
on any case; the two runners report identical numbers. Semantic retrieval is off
in the golden runners (needs a real embedding model), so this measures keyword,
audio-range and seed sources.

| Case | Recall@10 current -> hybrid | Recall@20 current -> hybrid |
| --- | --- | --- |
| world-african, world-mandingue, world-region, world-country | 100% -> 100% | 100% -> 100% |
| world-no-genre | 0% -> 0% | 100% -> 100% |
| world-all | 71% -> 71% | 100% -> 100% |
| rap-explicit-allowed, rap-explicit-blocked, rap-french-rap, rap-trap, rap-drill | 100% -> 100% | 100% -> 100% |
| hip-hop-all | 77% -> 77% | 100% -> 100% |
| sentence-warm-deep-house-cooking, sentence-something-to-focus | 100% -> 100% | 100% -> 100% |
| sentence-40-minute-run | 0% -> 0% | 0% -> 0% |
| artist-like-nadia-okoro, artist-more-hana-mori-lowercase, artist-near-miss-spelling | 100% -> 100% | 100% -> 100% |
| calm-mood-tagged | 100% -> 100% | 100% -> 100% |
| **calm-measured-low-energy-no-tag** | **0% -> 100%** | **0% -> 100%** |
| unmet-gregorian-chant | honest unmet -> honest unmet | |
| **Mean** | **82% -> 87%** | **90% -> 95%** |

Reading it honestly: the only gain is the calm case (measured low energy now
retrieves the untagged track). The World and rap cases were already at 100% at
@20 through the track descriptors (#2240), so there is no @20 headroom for the
issue's "World, rap and calm" criterion to move; the @10 gaps on `world-all` and
`hip-hop-all` are the rank-10 cap (10 of 14 and 10 of 13), and `world-no-genre`
is a one-point score tie that fusion does not change. `sentence-40-minute-run`
needs the parser to read tempo/energy from the sentence, which is out of scope.
Latency: the sources run in parallel, so the step costs the slowest source, and
is bounded by the retrieval deadline (5000 ms by default); a before/after p95 needs production traffic
and is not recorded here.

**Promotion recommendation (not a decision).** Offline there is no regression
and one gain, but the semantic source and the calibrated floor are unmeasured
with a real model. Run `hybrid_rrf_v1` as a small percentage experiment on
staging, check recall with real embeddings, source durations and timeouts in the
logs, and the skip rate and resonant discoveries per variant before promoting.

## Default selection target and held-back matches (#2242)

Staging feedback: a "Hip-hop, rap, trap" session showed five picks and missed
two matches. The default selection target (`AGENT_TRACK_LIMIT`) is now **12**
(was 5; the env override and the cap of 50 are unchanged). The LLM curator prompt
and the deterministic top-up read the same value, and a continuation asks for the
same target, not more. The per-artist cap (two per artist per pick, ADR-TE-2) and
the explicit preference are unchanged.

The request coverage now reports what the batch held back: `heldBack` =
`{ variety, explicit }` counts of strong matches (tracks that fit the session's
own request) left out by the per-artist cap and by the explicit preference
(`catalog.explicit_matches`, one count query, fails open). The web coverage line
appends it to the same single line, for example "All picks matched your request
· 2 more held back: 1 for variety, 1 explicit". A held-back-only golden case
(nine hip-hop-family tracks: two artists with three tracks each, one explicit,
three singles) asserts that all playable matches are in the first batch and that
coverage reports what was held back. Since request-first selection (#2316) the
first artist's third track no longer waits behind the cap: the cap relaxes when
the catalog has nothing else on the request, so the first batch holds all eight
playable matches, the coverage reports the relaxed cap, and only the one explicit
match is reported as held back.

## Request-first selection (#2316)

Vision-neutral quality (ADR-BM-6): no fee, split, price or payout change, and
popularity stays out of payouts (ADR-BM-4). Owner testing showed a "Hip-Hop &
Rap" and a "World Music" session returning mostly off-request tracks, with the
empty slots filled by Pop and New Age under "Selected vibe match · Boosted by
learned taste". Classification was not the cause: the matching tracks were
retrieved, then lost in ranking and batch filling. The request is now a gate,
taste only orders inside it, and padding is an explicit choice.

**What counts as a request.** A session has a request when it sets its own
genres (a starter, the picker or a described session; saved vibes sent back as
genres are not its own), a mood, an energy, a tempo, a seed (artist, track,
playlist), a named artist or a sentence (`requestScopeFor`,
`agent_session_request.ts`). A session with none (My Mix, a plain "surprise me")
keeps the taste-driven path exactly as it was. A request **gates the catalog**
when it names a genre or a seed; a request that names only mood, energy or
tempo asks for every genre (Moments starters), so it keeps the taste pool and
nothing is left out.

**Request versus taste.** For a gating request the retrieval queries are the
request's own genres and moods. Learned favourites, saved vibes and cohort hints
are not searched (`tasteQueries` on the selector input); they stay ranking
signals (learned preference, warehouse taste, cohort context) and only order
tracks inside a tier. Hyphens read as spaces in taste expansion, so "Hip-Hop"
expands like "hip hop" (it never did before).

**Three tiers, one predicate.** `requestTierOf` classifies a track with the same
per-filter predicates the coverage line counts, with descriptor families on every
path (the LLM path's `loadTrackCandidates` now loads them too):

| Tier | Meaning |
| --- | --- |
| A | matches every filter the request sets |
| B | matches the genre or family (or is found by the seed) but misses a soft filter: mood, energy or tempo |
| C | outside the request |

Selection is tier first, score second (`applyDiscoveryPolicy` with
`requestFirst`); a tier never moves with taste. The tiering lives in the agent
selection path only: Home and the plain DJ call the ranking core and policy
without it, and a test pins a Home-style ranking call to its established scores.

**Repeat avoidance.** Only the session's own tracks are hard-excluded (they are
also left out of keyword search, so the per-query budget of 20 goes to tracks the
session can still play; the answer says whether everything matching was played
(`all_candidates_recently_played`) or nothing matches (`no_matching_taste_candidates`,
the unmet-demand case)). Home impressions (`servedTrackIds`) no longer demote a
track inside a request session: being shown a track is not hearing it. A track the
listener recently **played** (their own `accept`, `complete`, `replay` or `loop`
signals in the last 14 days, at most 50 tracks; `recentPlayedTrackIds`) steps down
by one signal-sized step (10 points) inside its tier instead of the duplicate
penalty of -100. A listener who switched off playback learning has no such
signals, so nothing is demoted. Home keeps its served-history demotion.

**A cap that yields, keyed on the performer.** The two-per-artist cap applies
first. When tiers A and B are exhausted while capped matches remain, the cap is
relaxed for them (one more track per artist at a time) before any tier C track
and before a short batch. The coverage reports it as `capRelaxed: { artists,
top: { artist, tracks } }` and the web says "3 from Fabolous: the catalog has few
matches". In a request session the cap key is the credited performer
(`Track.artist`, then `primaryArtist`) and never the uploader account's label or
id: a track with no credit gets its own key. (Other callers keep the key
described in "Diversity cap counts the credited artist".)

**Exploration** (rule 3) draws only from tiers A and B. With no unexplored
on-request artist the slot falls back to normal tier order.

**Padding is explicit.** With "Fill with similar sounds" off (the default) a
batch the catalog cannot fill with matches is returned short, with
`shortfallReason: "catalog_short"` on the request coverage; the web line reads
"8 new tracks match your request". With it on (`fillSimilar`, a boolean on the
session preferences: the `POST /agents/config/session` body, the
`POST /sessions/agent/next` DTO with a 400 for a non-boolean, and the web
`AgentNextPreferences`), the batch is padded after every A and B track with
tier C tracks, searched from the requested genres' related styles and the
listener's taste, and each carries `requestMatch: false` so the player shows
"Outside your request". `requestMatch` is now true for every tier A or B pick
(the pick belongs to the request; a missed soft filter shows in the coverage
gaps) and false only for a marked pad. The switch is offered only while the
request names a genre, an artist or a seed, and not in My Mix.

**The LLM curator and its top-up obey the tiers.** The model's tools show it only
catalog results that match a requested genre (unless padding is on) and leave out
the session's own tracks; its user message no longer carries the saved-vibes
"Genres:" list for a gating request; the prompt dropped "use the broader genres
to fill the remaining slots" and says to stop when matching tracks run out unless
`Widening: on`. A model pick outside the request is dropped when padding is off
(`policy.dropped.offRequest`, logged as a count). The rule-based top-up follows
the selector's tier order in three passes: A and B under the cap, A and B with the
cap relaxed, then (padding only) tier C. The discovery swap and any exploration
label stay on tiers A and B. A seed-only request cannot be verified for a model
pick (it has no seed evidence), so only a requested genre gates a model pick; the
top-up carries the seed.

**Interpretation and limits.** A sentence the parser read nothing from, with no
seed, does not gate (its semantic similarity stays a ranking signal): gating it
would empty a session whenever embeddings are unavailable. Mood, energy and
tempo gate softly since the filter-adherence work (see "Mood, energy and tempo
constrain the session (#2451)"). The widened fallback pass is skipped for a gating request
without padding (its tracks would all be tier C).

**Golden set.** Two small catalogs of their own (so the 21 cases above keep their
numbers; none improved, none regressed) add nine scenarios, registered once and
run by both runners and both retrieval variants
(`dj_retrieval_golden/request_first_cases.ts`): a Home-shown on-request track is
still picked; nine Rap tracks (three by one performer, one explicit) are all
heard before any off-request track, with the cap relaxed; a shorter batch with
the shortfall reason, and padding only when allowed; learned Pop plays no Pop
track for a Rap request while Rap remains; exploration never takes an
off-request track; different performers (and uncredited tracks) uploaded by one
account are not capped together; the session's own tracks are kept out and
"everything matching was played" is told apart from "nothing matches"; and a
recently played track keeps its place with the gentle step. Without the feature
eight of the nine fail. Tests: `agent_request_first.spec.ts` (pure),
`agent_golden_eval.spec.ts`, `agent_dj_retrieval_golden.integration.spec.ts`,
`agent_runtime_policy.spec.ts`, `discovery_policy_context.integration.spec.ts`,
`sessions.controller.http.spec.ts`.

**Not in this slice.** "Fill with similar sounds" lives in the session
(the panel state, sent with every start and pick, remembered by the server for
the live session); a saved listener setting would need a schema change and is
open. Hybrid retrieval and the default path both follow the same rules.

## Mood, energy and tempo constrain the session (#2451)

Vision-neutral quality (ADR-BM-6): no fee, split, price or payout change.
Status: `partial`. The deterministic path and the LLM guard follow the new
rules. Parser misreads and loose genre matching are measured but not fixed yet
(see "Remaining").

Owner testing showed "Zen, relaxed" (mood Zen, low energy) playing hard,
high-energy rap. A request with no genre was never gated. Its picks came from
saved vibes and learned genres, and every pick showed as in the request. The
coverage line already said "None of the 12 picks matched Zen".

**Evals first.** `npm run eval:dj-filters` (backend) measures precision: does
anything that does not fit get played? The recall golden set (#2235) only asks
whether the right tracks appear. The suite has two stages:

- a parser stage: 57 sentences, graded against hand-written intent;
- a selection stage: 141 requests over an invented two-layer catalog, where
  truth labels sit beside sparse observed metadata. It covers 3 listener
  profiles, 2 retrieval variants and 2 batches.

An independent grader scores contradictions, silent leaks and adherence, and
each case's numbers are pinned in a baseline. The method and the baselines are
in `docs/engineering/ai-dj-filter-adherence-evals.md`.

**Soft gate.** A request that names a mood, energy or tempo but no genre or seed
is `softGated` (`AgentRequestScope`; `constrainsCatalog` covers both kinds of
gate). For each soft filter, `requestTierOf` reads one outcome:

| Filter | Outcomes |
| --- | --- |
| Energy | match (same band), contradict (low vs high), mismatch |
| Tempo | match (measured, in range), contradict (measured, more than 15 BPM outside), mismatch (measured, closer), unknown (not measured) |
| Mood | match, mismatch, unknown (no tags); moods never contradict |

A contradiction is tier C for every request, so a genre request is affected
too. With "Fill with similar sounds" off, the track is left out; with it on,
the track is padded and marked. A soft-gated pick needs at least one soft match
to be tier B; with no match it is C. Every soft filter matched is A. Requests
without filters (a sentence only, My Mix) are unchanged.

**Energy evidence.** `effectiveEnergyBand` decides in this order: measured
audio-feature band, then the stored descriptor's band, then the inferred band
(a genre and title guess). Tiers, coverage counts and the player mark all read
it.

**Retrieval.** A soft-gated session keeps searching taste genres, which now
only order what fits. The default path also retrieves by measured sound
(`catalog.audio_range`, 30 candidates), as the hybrid path already did. The
widened fallback, cohort hints and the empty "newest" search are skipped
without padding, and a short batch reports `catalog_short`. The web now offers
"Fill with similar sounds" for mood, energy and tempo requests too
(`offersFillSimilarFor`).

**Measured effect** (selection stage, 282 runs, before -> after):

| Measure | Before | After |
| --- | --- | --- |
| Contradicting picks | 1033 | 376 |
| Moments starters, contradicting picks | 249 | 0 |
| Single filters, contradicting picks | 194 | 0 |
| Silent leaks | 1848 | 978 |
| On-request share | 53% | 70% |

Accepted trade-offs, recorded in the re-pinned baseline:

- In a catalog with sparse metadata, some batches are now shorter or empty
  (`catalog_short`) instead of padded with contradicting tracks.
- Some contradictions became partial picks: the energy fits but the exact
  moment does not.

The recall golden set did not regress.

**Remaining** (measured, not fixed):

- Sentences the parser drops (typos, French, natural phrasing) still start an
  unfiltered session (#2452). Parser stage: 46/57 exact.
- Loose genre matching inside gated requests. "Afro-Pop" admits any
  "Dance Pop" release; "Dance" in Pop Hits admits Techno and Deep House (#2453).
- A medium-energy request accepts tracks whose energy defaulted to medium
  because nothing was measured.
- The LLM curation path is guarded by the same tiers, but its own picks are not
  replayed offline yet (#2454).

## "Right now": a session with no filters follows the time of day (#2245)

Vision-neutral quality (ADR-BM-6): no money path, no new data, no external cost.
A session with no request scope (see "Request-first selection": no genre, mood,
energy, tempo, seed, named artist, sentence or starter intent, and not My Mix)
used to play from the flat saved vibes. Now, when the client sends its coarse
time/day bucket and the listener has enough history, the runtime weights the
listener's visible habit lanes by that bucket instead.

- **Reuse of My Mix.** `resolveRightNow` (`agent_right_now.ts`) calls
  `resolveMyMixPlan({ context }, visibleLanes, limit)`: the same eight buckets
  (`night|morning|afternoon|evening` x `weekday|weekend`), the same context gain
  and largest-remainder lane quotas. Hidden lanes stay out. The plan runs through
  `AgentRuntimeService.run`, the choke point both `POST /agents/config/session`
  and `POST /sessions/agent/next` reach, so the first batch and every later pick
  follow the same rule. Like My Mix it uses the deterministic selector (the LLM
  curator is bypassed for such a session).
- **What it is not.** It sets no request scope (the lane plan makes
  `requestScopeFor` ignore the session, exactly as for My Mix), so nothing gates
  retrieval, and it writes no chips, so no hidden genre can leak into the request
  chips (#2239/#2249). It is not a My Mix session: no coverage snapshot, no lane
  demand observation, no habit-ordering arm (`orderingVariant: "neutral"`), and
  `sessionSource` stays `preset` in the recommendation events.
- **Cold start.** A listener with no lane gets `no_history`; a listener whose
  lanes have no habit in the current bucket gets `no_context_history` (a lane
  belongs to a bucket when its weight there is at least
  `AGENT_RIGHT_NOW_MIN_CONTEXT_SHARE`, 25%, of its strongest bucket, so one stray
  play is not a habit). Either way the plan is withheld and the session uses the
  saved vibes, as before.
- **Privacy.** The client computes the bucket from the device clock and sends only
  `preferences.listeningContext` (one of the eight strings, validated: 400
  `invalid_listening_context`, or the session DTO's `IsIn`). The server never
  stores or publishes it (it is stripped from `session.started` and from the
  preferences handed to the executor and the remote worker); no timezone,
  timestamp or place is sent. The web re-buckets it on every pick request
  (`withCurrentMyMixContext`), and sends it only while the session has no filters
  (`withRightNowContext`); a filter, a starter, a sentence, a seed or My Mix drops
  it and the request decides.
- **The starter and its reason.** `GET /agents/config/session/right-now?context=`
  returns `{ status: "ready", context, highlights }` (the genres of the habit
  lanes of that bucket, strongest first, at most three) or `{ status:
  "cold_start", context, reason }`. A dedicated endpoint (rather than computing
  the reason from the taste-memory lanes in the browser) keeps one definition of
  "belongs to this time of day" for what is shown and what is played. The web adds
  "Right now" as the first starter of the For you row (beside My Mix, above Moments
  and Sounds; it does not replace the default empty state), always showing its
  reason ("Your usual weekday-evening mix: Deep House, Jazz.") or, on a cold start,
  "Not enough listening history yet. Your DJ will start from your saved vibes." If
  the summary cannot load, the starter is hidden. Choosing it clears the other
  choices and starts a session with no filters; analytics carry `starterRow:
  for_you`, `starterId: right_now`, `startedFrom: right_now`. The empty-state line
  reads "With no filters, your DJ follows your usual weekday-evening mix. Your
  saved vibes are the fallback: ..." once the habits are known.
- **Tests.** `agent_right_now.spec.ts` (evening-jazz and morning-electronic
  fixture history: evening leans jazz, morning leans electronic; cold starts; stray
  play), `agent_right_now.integration.spec.ts` (real history, runtime routing,
  selector leaning, filtered sessions untouched, the endpoint),
  `agent_config.controller.spec.ts`, `sessions.controller.http.spec.ts`, and web
  `agentRightNow.test.ts`, `AgentSessionPrompt.test.tsx`, `AgentSessionPanel.test.tsx`.
- **Open:** the reason is fetched once per page load (a tab left open across a
  time-of-day boundary shows the old reason, while the session itself uses the
  fresh bucket); Session History does not label a Right now session.

## The For you row: "More like..." and "New artists in..." (#2249, slice 3)

Vision-neutral quality (ADR-BM-6): no fee, split or payout is touched, and nothing
here is ranked by money or popularity. The For you row now holds, in order, Right
now (#2245), More like <the track that last resonated>, New artists in <your top
family> and My Mix. Each is built from data the web already has or one additive
field, and **a starter whose data is missing is not rendered** (no dead starter).

- **More like <title>.** The latest resonant item of the Sonic Radar journal
  (`latestResonantItem`: the group item with the newest `resonatedAt`, so a track
  played through but never replayed or saved does not count) becomes a track seed
  (#2244): the same removable "From: <title>" chip and `seed` preference as
  "Start a DJ session from this". Choosing it clears the other starter state (a
  clean seeded session); the server resolves the seed again on start. The button
  shortens a long title to 28 characters and keeps the whole title in its
  accessible name. Analytics: `starterRow: for_you`, `starterId: more_like`,
  `seedKind: track`; the id and the title are never sent.
- **New artists in <family>.** `GET /agents/config/session/sounds` gained an
  additive `topFamilyId`: the offered family (catalog count at least
  `AGENT_SOUNDS_MIN_TRACKS`) the listener's learned genre weights favour most
  (`familyTasteWeights`, positive weights only). Without any taste for an offered
  family it is absent: catalog size alone is not the listener's taste, and the
  starter is hidden. The starter selects that family's Sounds starter (so the
  request, the sentence and the chips are the family's own and the session is
  request-first, #2316) and turns on `preferences.newArtists`, shown as a
  removable "New artists only" chip. The saved vibes are not involved.
- **What "new artist" means.** An artist the listener has no `AgentSignal` for on
  any of their tracks: any recorded interaction counts (a skip too), the same
  lookup exploration uses (`loadPlayedArtists`). `newArtists` reaches the
  selector as `newArtistsOnly` and `applyDiscoveryPolicy` drops those candidates
  (`excludePlayedArtists`, off for Home and the plain DJ, so nothing else
  changes). Every other rule still applies (hidden taste, AI, the per-artist cap,
  the explicit preference); a candidate with no artist id cannot be known as
  played and stays. A short batch says so through the existing shortfall line
  rather than padding with known artists.
- **Runtime.** Only `true` counts (controller, `sessions.service` sanitiser and
  the session DTO's `IsBoolean`); the session remembers it, and a pick may send
  `false` (the chip). A New artists session runs through the deterministic
  selector (`AgentRuntimeExecutorService.runDeterministic`), because a model's
  picks never see the played-artist lookup; it is not weighted by the time of day
  (Right now skips it).
- **Limits.** The starter is shown when the family is fillable and the listener
  has taste for it, but it does not check that unplayed artists remain in that
  family (that needs a per-listener catalog query); a listener who has played
  every artist of the family gets an empty or short set with the shortfall line.
  If the played-artist lookup fails the session still plays (logged as a degraded
  fallback) rather than going silent. Session History does not yet show the
  "New artists only" limit.
- **Tests.** Backend `discovery_policy.spec.ts`, `agent_sounds.spec.ts`,
  `deterministic_recommendation_adapter.spec.ts`,
  `agent_new_artists.integration.spec.ts` (real history: a known artist is left
  out, an ordinary session still plays them; routing),
  `sessions.integration.spec.ts`, `sessions.controller.http.spec.ts`,
  `agent_config.controller.spec.ts`. Web `sonicRadarSummary.test.ts`,
  `sessionPresetData.test.ts`, `sessionPreferences.test.ts`,
  `agentSessionRequest.test.ts`, `AgentSessionPrompt.test.tsx`,
  `AgentSessionPanel.test.tsx`.

## One genre matcher for sessions and My Mix lanes (#2236)

There used to be two genre matchers. Ordinary sessions used the genre-family
matcher (#2088); My Mix lanes compared exact canonical labels from the taste-edit
vocabulary, so the same track could match a "World" session and miss a "World"
lane. Now `genreMatchesRequest` in
`backend/src/modules/recommendations/genre_families.ts` is the only genre
matcher. It is used by catalog search expansion, the ranking core's
`session_request` signal, request coverage, lane membership
(`matchingMyMixLaneIds`), lane ordering (`laneSessionRequestMatch`), habit
ordering's lane assignment and the habit-mix offline eval. It also treats the
taste-edit vocabulary's spellings as one genre ("DnB" = "Drum & Bass"), so lane
keys written before the change keep matching.

- **Lane keys.** A genre in the taste-edit vocabulary keeps its canonical label
  as the lane key, so existing lanes keep the same `id` (lane hide controls
  refer to it). Any other genre is keyed by the id of the genre family that
  names it (`primaryGenreFamily`: a narrow family wins, then the smallest broad
  one; "Mandingue" is `african`, "French Rap" is `hip-hop`). A genre neither the
  vocabulary nor a family names (a country name, a missing genre) still forms
  no lane. The listener's genre controls apply to the genre's own label, as they
  do for the taste profile.
- **Payload.** `listeningLanes[].genreWeights` (taste memory summary, My Mix
  plan) may now hold a family id (`african`, `hip-hop`, `r&b-soul`,
  `ambient-lofi`, ...) as a key next to vocabulary labels; `label` shows the
  family label ("African"). No field was added or removed and lane ids for
  vocabulary-only listeners are unchanged. A consumer must treat a genre key as
  a request for the matcher, not as a vocabulary entry. A boosted lane still
  saves its genre keys as taste edits; since #2270 a family id is stored as the
  family label and the declared-boost ranking resolves family names through the
  shared matcher (see below).
- **Why an active account may not be offered My Mix.** The web offers the My Mix
  preset only when the taste memory summary holds at least one visible lane
  (`AgentSessionPrompt`; a failed taste memory call also shows none). A lane
  comes from `AgentSignal` rows (listener actions), not from sessions:
  1. a session that only logged picks leaves no signal until the listener
     accepts, completes, saves or skips something (#2036);
  2. a signal needs a session key (`agent:<sessionId>` or a `playback_...` id),
     must be inside the 730-day window and after a taste reset, and only the
     newest 500 count;
  3. its genre must be known: before #2236 only the ~85-label taste-edit
     vocabulary, so a free-text catalog ("African", "Mandingue", "French Rap")
     produced nothing. This is what #2236 fixes;
  4. a lane needs at least 2 distinct positive sessions and 2.0 net positive
     decayed genre evidence (behavioral half-life 60 days, so light, old
     interaction decays below the floor);
  5. hidden genres or artists drop signals, negatives cancel evidence, and
     hidden lanes are not offered.
  Causes 1, 2 and 4 are not matcher problems; since #2270 the summary names
  which rule applies (see below) instead of showing nothing.
- Tests: `genre_matcher_lanes.spec.ts`, `genre_families.spec.ts`,
  `listening_lanes.integration.spec.ts` (free-text history yields a lane),
  `habit_ordering.integration.spec.ts`; the #2235 golden set did not change.

## Why a listener has no lanes; boosting a family-keyed lane (#2270)

Vision-neutral quality (ADR-BM-6). Two gaps left after #2236.

**Reason codes.** When the listener has no lanes the taste memory summary
(`GET /recommendations/taste-memory`) carries `summary.listeningLanesEmptyReason`,
and `null` whenever there is at least one lane (hidden lanes count: the cards
stay so they can be restored). The lane derivation (`analyzeListeningLanes` in
`listening_lanes.ts`; `computeListeningLanes` is its lanes-only wrapper, and
`getListeningLaneReport` caches both) names the first rule that left the
listener without:

| Code | Rule | Web sentence |
| --- | --- | --- |
| `no_signals` | No usable signal: none yet, none with a session key, none inside the 730-day window or after a taste reset (a session that only logged picks leaves none until the listener accepts, completes, saves or skips) | "Play some music and save, finish or skip a few tracks to start building My Mix." |
| `unknown_genres` | Signals exist but none has a genre the taste-edit vocabulary or a genre family names | "Your recent plays have no genre My Mix can group yet. Play tracks that name a genre to unlock it." |
| `too_few_sessions` | Positive evidence comes from fewer than 2 distinct sessions for any one habit (a history of only skips has no positive session at all) | "Play and keep a few more sessions to unlock My Mix. A habit has to show up in more than one session." |
| `evidence_decayed` | A habit spans 2+ sessions, but its net decayed positive evidence is under the 2.0 floor (behavioural half-life 60 days) | "Your listening has gone quiet lately. Play and save a few more tracks to bring My Mix back." |

The codes are a closed set (`LISTENING_LANES_EMPTY_REASONS`); the payload is the
code only, never counts, session keys or dates. An older server sends no field
and the web falls back to "Play and keep a few more sessions to unlock My Mix."

**Web.** The AI DJ page (`AgentSessionPanel` -> `AgentSessionPrompt`) and
Settings -> Taste Memory (`ListeningLaneSection`) show the sentence where My Mix
would be. A failed taste-memory call is a different state
(`MyMixLanesStatus` `unavailable`): the AI DJ page says "My Mix could not load
right now. Reload the page to try again." and never claims the listener has no
lanes. Lanes the listener hid are their own choice and show no note. The
vocabulary call is independent, so its failure no longer reads as either state.
"Right now" (#2245) is unchanged: it consumes the same visible lanes through
`resolveMyMixPlan` and keeps its own `no_history` / `no_context_history` cold
start reasons, which are about the time-of-day bucket and not the lane
derivation.

**Boosting a family-keyed lane.** A boosted My Mix lane saves its genre keys as
boosted taste edits (`buildMyMixTasteEdits`). A lane keyed by a family id (for
example `ambient-lofi`) therefore saved an edit the declared-boost ranking
matched exactly against release genres, so it boosted nothing. Now:

- `declaredBoostMatch` (ranking core) also accepts a boosted genre that NAMES a
  genre family, by id, label or alias (`genreFamilyNamed`), and matches release
  genres through the shared matcher (`declaredGenreMatchesRelease` ->
  `genreMatchesRequest`). Only a named family widens: a boost on "French Rap"
  or "Jazz" stays an exact label match, so ordinary declared boosts do not
  change. The reason reads "you asked for more Ambient / Lo-fi".
- `applyTasteEdits` stores a boosted genre edit whose value is a family id as the
  family label, so the controls list reads "Ambient / Lo-fi", not
  "ambient-lofi", and it dedupes with a label boost. Rows already stored as an id
  keep working through the ranking rule above.
- Home and session retrieval already matched family terms (the boosted genre
  rides in as a preference term), and session-level lane boost was unaffected.

**Tests.** `my_mix_empty_reason.spec.ts` (each code, the not-reported cases,
and the family boost in the ranking core), `listening_lanes.integration.spec.ts`
(each code through the real taste memory summary, reset, hidden lanes, and the
stored label), web `agentMyMix.test.ts`, `AgentSessionPrompt.test.tsx`,
`AgentSessionPanel.test.tsx` (no-lanes versus failed call) and
`TasteMemorySettingsPanel.test.tsx`.

## Diversity cap counts the credited artist (#2092)

Rule 4 (at most two tracks per artist per page, or per 10 session tracks) used
to identify "the artist" by `Release.artistId`, the uploading profile. One
profile can carry releases credited to many performers (a label, a manager or
an aggregator account), so a Hip-Hop session over seven rap tracks uploaded
from one profile kept only two picks, and Next Pick then found nothing.

- `discoveryArtistKey` now keys on the credited artist (`name:`), the same name
  the UI shows (#1492: `Track.artist`, main credits, `primaryArtist`, then the
  account label). The key folds accents and case, drops a featured-guest
  segment ("Ryan Leslie Feat. Booba" counts as Ryan Leslie) and collapses
  punctuation ("T.I" equals "T.I."). `artistId` (`id:`) is only the fallback
  when no name resolves, then the track id.
- The prior-session window uses the same resolution
  (`DiscoveryPolicyContextService.artistKeysForTracks`, built on
  `loadTrackCandidates`), and so does the runtime discovery swap; `catalog.search`
  candidates now carry `release.primaryArtist` and the uploader label.
- The same rule applies to Home rails, which already passed the credited name.
- Exploration (rule 3: verified human artists, played artists) still uses the
  account identity.
- Tests: `discovery_policy.spec.ts`, `agent_runtime_policy.spec.ts`,
  `agent_selector_fallback.spec.ts`, `agent_selector_unification.spec.ts`,
  `home_feed_rail_policy.spec.ts`,
  `discovery_policy_context.integration.spec.ts`.

## Server-side selection target (#2094)

With the LLM curator (ADK / Vertex), the model alone used to decide how many
tracks a request returned. The prompt asks for up to `AGENT_TRACK_LIMIT`
(default 12 since #2242; it was 5), but the same R&B & Soul request returned 2 tracks, then 5 twenty
seconds later, and an empty or fully policy-dropped reply left the session
with nothing.

- `AgentRuntimePolicyService` (the step every LLM result passes through) now
  tops the final picks up to `getAgentTrackLimit()` from the deterministic
  selector, called exactly as the rule-based adapter calls it
  (`deterministicSelectorInput`: request terms, semantic query, explicit
  choice, the #2056 session fallback). The model's picks keep their order and
  come first.
- Fill-ins keep every policy rule: no repeat of a pick or session track, at
  most two per credited artist on the page (and in the session window on a
  strict pass), and no first-listener placement without a reservation.
- A reply with no parsable pick (`llm_no_track_selected`) or whose picks the
  policy all drops is topped up the same way. A request nothing in the catalog
  matches still finds nothing (ADR-TE-4). `policy.toppedUp` counts fill-ins.
- The AI DJ panel refreshes Session History after **Update session**
  re-plans the queue, so the card shows the new request's picks.

## Session History shows each session's filters (#2096)

Session History used to list only a session's date, duration and tracks, so a
"Pop Hits" session and an "R&B & Soul" one looked the same.

- `Session.filters` (nullable JSON) stores a sanitized summary of the
  session's **own** filters, built by `sessionFilterSummary`
  (`backend/src/modules/agents/agent_session_filters.ts`): preset name, the
  requested genres and moods, energy band, tempo range, a My Mix flag (never
  lane details) and the resolved explicit choice. Values are bounded (at most 8
  terms of 40 characters, a 60-character preset name). The typed sentence is
  never an input, and the saved vibes a plain Next Pick falls back to are kept
  out.
- Session start writes it (`POST /agents/config/session` and
  `SessionsService.startSession`). A Next Pick or re-plan that sends
  preferences rewrites it only when the summary changed, so the card shows the
  latest filters. Both writes are best effort and never block a session or a
  pick.
- `GET /agents/config/history` returns `filters`, and `AgentHistoryCard` shows
  one line under the date. A session with no chosen filters reads "Saved
  taste", and sessions from before #2096 show nothing new.
- Tests: `agent_session_filters.spec.ts`,
  `agent_session_filters.integration.spec.ts`, `AgentHistoryCard.test.tsx`.
## The DJ's starting taste is visible and explained (#2239)

Vision-neutral quality (ADR-BM-6): no money, payout or fee path is touched.
The DJ's saved vibes used to be visible only as chips on the status card, with
no label and no link, and a request that named a mood but no genre silently
took them as its genres on pick requests.

- The prompt's empty state (`AgentSessionPrompt`) carries one labelled line,
  "With no filters, your DJ starts from: Chill, Deep House, Lo-fi… · Edit",
  linking to `/settings?section=dj`. It shows the first three saved vibes and an
  ellipsis when there are more. A DJ with no saved vibes sees "No saved vibes ·
  Set them" with the same link, so the empty state never dead-ends. The line is
  hidden while the sentence is being read and once any filter or My Mix exists.
- A request that names a mood or energy but no genre no longer takes the saved
  vibes as its genres. `buildSessionPreferences` carries only the request's own
  genres, so a mood-only session searches all genres, ranked by learned taste
  and the mood. The saved vibes still start a session with no filters at all
  (`buildPickPreferences`, in `web/src/components/agent/sessionPreferences.ts`,
  and the plain session start). The backend needs no change: it already treats
  an empty requested-genre list as "no genre asked for" and merges learned
  favorites and saved vibes only as additional search queries, never as the
  session's own requested terms (`mergeSessionGenres`,
  `buildAgentRecommendationQueries`, `requestedTermsFor`).
- Settings → AI DJ and the User Guide AI DJ article explain in one short table
  how the three taste inputs differ: **saved vibes** are the DJ's starting
  point when you give no filters, **Taste memory** is what Resonate learned from
  your listening and what you told it, and **My Mix** builds sessions from your
  listening habits (lanes).
- Tests: `sessionPreferences.test.ts` (mood-only carries no fallback genres, a
  no-filter pick still uses the saved vibes, requested genres win),
  `AgentSessionPrompt.test.tsx`, `AgentDjSettingsPanel.test.tsx`.
- Screenshots in the User Guide are not refreshed in this slice.
- **Open follow-up (owner decision, not implemented here):** should the saved
  vibes eventually merge into the declared layer of Taste memory (taste engine
  RFC, five layers), so one place controls the starting taste? The UI above does
  not depend on the answer. The status-card chips are removed by a separate
  slice (#2237).

## One Start action on the AI DJ page (#2237)

Vision-neutral quality (ADR-BM-6): no money path touched. The page used to show
three buttons that started a session; only the prompt's carried what the
listener typed or picked.

- The prompt's button is the only start action ("Start session", then "Update
  session" while live). The command bar (`AgentCommandBar`) shows the DJ name
  and live state, plus **Stop Session** only while a session is live.
- `AgentStatusCard` (name, status, saved-vibes chips, Start/Stop, counts) and the
  unused `AgentDashboard` copy are deleted. The saved vibes now appear as the
  labelled line in the prompt (#2239). The lifetime session and track counts
  moved to the top of Session History (`AgentHistoryCard`, same
  `GET /agents/config/history/summary` source).
- Analytics: `agent.session_started` is sent from the prompt's button, so
  `source` is `agent_session_prompt` for plain, typed and My Mix starts and
  `agent_session_intent_panel` for an untouched quick start; the removed
  `agent_command_bar` start source no longer appears (`payload.startedFrom`
  still separates `plain`, `prompt`, `preset` and `my_mix`). `agent.session_stopped`
  keeps `agent_command_bar`, since Stop still lives there. `source` is a free
  string, so no enum or contract changed.
- Tests: `AgentCommandBar.test.tsx`, `AgentSessionControls.test.tsx` (exactly one
  start control idle; Update and Stop, no start, live), the idle, start, live,
  stop flow in `AgentSessionPanel.test.tsx`, `AgentHistoryCard.test.tsx`.
- Screenshots in the User Guide are not refreshed in this slice.

## Live Feed removed; request coverage under the filters (#2238)

Vision-neutral quality (ADR-BM-6): no money path touched. The Live Feed card was
an engineering log: two hard-coded placeholder lines before a session, then raw
backend events, and a leftover 💰 icon for the retired buy mode (ADR-TE-1).

- `AgentActivityFeed` and its layout row are deleted; the Next AI Pick card now
  sits on its own. Its pick reasons moved to the "Now & Up next" card (#2243,
  below).
- How well the picks matched the request is one line under the filter chips in
  the prompt, built by `coverageLine` (`web/src/lib/agentSessionRequest.ts`)
  from the same coverage as before (a pick response's `requestCoverage` or the
  newest `agent.decision_made` event): "All picks matched your request", "Only 1
  of 5 picks matched 120–125 BPM" (largest gap first), or "Nothing in the
  catalog matched World yet — playing the closest picks" when no pick matched
  any filter. An unmet request is stated, never dressed up as a match (ADR-TE-4).
  It replaces the per-gap notes, so coverage appears once.
- Raw events for developers: no admin view of agent events exists, and events
  reach only the session owner's socket (#2078), so an operator cannot read
  another account's stream. `AgentEventsDebug` renders the viewer's own events in
  a plain `<details>` only when the page is opened with `?debug=agent`; listeners
  never see it. A real cross-account operator view would need a backend read
  path and is a separate follow-up.
- `agent.negotiated` no longer has an icon mapping in `useAgentEvents`.
- Tests: `agentSessionRequest.test.ts` and `AgentSessionPrompt.test.tsx` (full,
  partial, none), `AgentEventsDebug.test.tsx`, `useAgentEvents.test.ts`.
- Screenshots in the User Guide are not refreshed in this slice.

## AI DJ quick starts: plain starters and composable filters (#2249)

Status: **implemented** (slices 1 and 2 here, slice 3 in the For you row and #2327 sections). Vision-neutral quality (ADR-BM-6):
no fee, split, price, payout or purchase change.

Shipped in slice 1 (frontend and copy only):

- **Plain names.** The starters are Focus, High energy, Chill, Dark, Calm, Club,
  Late night and Warm (Moments) and the genre families Hip-Hop & Rap, R&B &
  Soul, Pop Hits, Afrobeats & Amapiano, Reggae & Dancehall, Latin & Reggaeton
  and World Music (Sounds). Neural Flow, Pulse Raid, Liquid Sky, Abyss Shift and
  Static Calm are gone from the UI (owner decision 1). The internal `intent`
  ids Focus, Hype, Chill, Dark and Zen are unchanged, so `agent.intent_selected`
  and `agent.session_started` stay continuous; the new moods use their parser
  names as ids (`Club`, `Late Night`, `Warm`), which the free-string
  `intent`/`intentName` analytics fields accept without a contract change.
  `sessionIntentName` is now the plain label for new sessions. Session History
  maps old brand names and old intent ids to today's plain label
  (`plainPresetLabel`), so past sessions read consistently.
- **Starters write their sentence.** Tapping a starter fills the prompt with
  its sentence ("Focus, low energy") and shows the filters it reads as, without
  waiting for the parser; the listener can edit the sentence or the chips.
- **No hidden genres in Moments.** Moments set mood, energy and tempo only and
  search every genre, ranked by taste. Sounds set genres only; the old built-in
  energy on genre starters is gone, since Energy is now the Adjust filter.
- **Rows.** "Moments" and "Sounds" are labelled groups with pressed state; a
  "For you" row appears only when My Mix has lanes to blend (nothing broken is
  shown for absent items). The selected starter's description and "You'll hear"
  line are always visible, so touch does not depend on hover.
- **Adjust row.** Energy (Any, Low, Medium, High) and the explicit-tracks
  checkbox (moved here) combine with any starter or sentence into one request:
  a starter plus Energy keeps the starter selected and the request's energy wins
  in the session preferences. Removing a chip removes only that filter.
  Energy is hidden while My Mix is chosen, since My Mix follows listening lanes.
- **Rotating placeholder** of real example sentences the parser fully reads.
- **Analytics** extend the existing events, no new event and no free text:
  `agent.intent_selected` adds `starterRow` and `starterId`;
  `agent.session_started` adds `starterRow` (`moments`, `sounds`, `for_you`),
  `starterId` (the intent id, `my_mix` for My Mix), `starterEdited` (the
  sentence or chips were changed after the tap) and `optionalFilters`
  (`energy` when set from Adjust, `explicit` when included). Consent rules are
  unchanged (`recordProductAnalytics`).
- **Tests.** `sessionPresetData.test.ts` runs every starter sentence and every
  placeholder example through the backend's own deterministic parser
  (`parseCrateRequestText` and `listeningRequestFromCrateParse`, both pure, the
  same functions behind the parse endpoint) and asserts no "Didn't catch" text,
  that each starter's chips equal what the parser returns, and that no Moments
  starter carries a genre. `AgentSessionPanel.test.tsx` covers sending no genre
  from any Moments starter, starter plus Energy in either order, chip removal
  removing only that filter, and the analytics payload. `AgentHistoryCard.test.tsx`
  checks that every old intent id and brand name renders its plain label.

Shipped in slice 2 (catalog-aware Sounds):

- **One cached catalog aggregate.** `agent_sounds.service.ts` counts, per genre
  family from `genre_families.ts`, the tracks the DJ could actually play: a
  ready or published release, clean content, a public rights route
  (`classifyTrackAvailability`, the catalog's own availability rule), at least
  one current stem, and promotion-eligible (`AI_PROMOTIONAL_ELIGIBILITY_WHERE`,
  so fully AI-generated tracks are excluded as in the other DJ and discovery
  filters, ADR-BM-5). A track counts toward a family when its release genre text
  or its stored descriptor families (#2240) satisfy the family through the
  shared matcher `genreOrDescriptorMatchesRequest`, so a "Bambara" track tagged
  `world` counts toward World. Each family stores a total and a count without
  explicit tracks. The scan is paged and bounded, and the result is held in
  memory for `AGENT_SOUNDS_CACHE_TTL_MS` (default 10 minutes); concurrent
  requests share one refresh and a failed refresh keeps serving the last good
  aggregate. A render never queries the catalog.
- **`GET /agents/config/session/sounds`** (JWT) returns
  `{ families: [{ id, label, count }], minTracks }` for this listener. The
  explicit preference selects the count (the optional `allowExplicit=true|false`
  query previews the choice before it is saved; otherwise the saved
  `AgentConfig.allowExplicit` applies). Families under `AGENT_SOUNDS_MIN_TRACKS`
  (default 3) are omitted. The rest are ordered by the listener's learned taste
  (the shared v2 taste profile's positive genre weights, added to every family
  the genre belongs to), then by catalog count, then by label. If taste cannot be
  read, the order falls back to catalog size.
- **Sounds row from that data.** The row shows "World Music · 40+": the exact
  count under 10, then 10+, 20+ and 40+. It keeps the returned order and hides any
  family under the threshold, so a starter never dead-ends; the web also checks
  the count against the server's `minTracks`. Families with no starter (for
  example African, which World and Afrobeats cover) are not shown. Beyond the
  seven everyday starters, Electronic, Jazz, Rock & Indie, Ambient & Lo-fi and
  Classical appear when the catalog can fill them. If the request fails, today's
  seven static Sounds starters stay. A starter's sentence and chips are unchanged
  (genre names the parser reads), now with a `familyId`.
- **Tests.** `agent_sounds.spec.ts` (tally, threshold, explicit, ordering, ties,
  config), `agent_sounds.integration.spec.ts` (real Postgres fixtures: explicit,
  AI-generated, unready, withdrawn, quarantined and stemless tracks excluded,
  descriptor-only match counted, below-threshold families hidden, cache reuse,
  the route handler), the route's `401` in
  `agent_config_session_parse.controller.http.spec.ts`, and web tests for order,
  buckets, hiding below the threshold (`sessionPresetData.test.ts`), the panel
  fallback and wiring (`AgentSessionPanel.test.tsx`), and that every generated
  starter parses with nothing left over.
- **Deferred inside slice 2:** lane weights are not used separately for ordering
  (the same history feeds the taste profile); the aggregate is per backend
  instance (no shared cache) since it is cheap to recompute; the "dimmed" variant
  was dropped in favour of hiding.

Remaining from #2249: nothing is open. The For you row shipped with its own
section; Discovery, Tempo and the first-session tip shipped with #2327 (see
[Discovery, Tempo and the first-session tip](#discovery-tempo-and-the-first-session-tip-2327)),
which closes #2249. Screenshots in the User Guide are not refreshed in these slices.

## Discovery, Tempo and the first-session tip (#2327)

Vision-neutral quality (ADR-BM-6): no fee, split, price, payout or purchase change.
Discovery promotes verified human artists through the existing exploration share
(ADR-BM-5 filters unchanged). These are the last three items of #2249's spec; the
Sprint 39 decisions on #2327 are binding.

- **Discovery: Familiar, Mixed, New.** A three-step control in Adjust. **Mixed is the
  default and today's behaviour** (the 20% exploration share,
  `DISCOVERY_POLICY_DEFAULTS.explorationShare`); the default does not follow the
  listener's history (not personalised yet). **Familiar** reserves no exploration slot:
  the batch is the best fit by request and taste, and nothing is labelled a discovery
  pick. **New** raises the share to `NEW_EXPLORATION_SHARE` (0.4; 5 of a 12-pick batch,
  against 2 for Mixed). The share is the only thing the control changes:
  `explorationShareFor(level)` feeds `applyDiscoveryPolicy({ explorationShare })`,
  where a share of 0 now means "reserve nothing" (any other share still reserves at
  least one slot). Every other rule is unchanged: hidden taste, AI-generated tracks,
  the per-artist cap, verified human and never-played artists only, and the session
  pacing (a session never catches up in a burst).
- **Inside the request.** Exploration slots still draw only from request tiers A and B
  (#2316), at every step, with or without "Fill with similar sounds". New with too few
  matching fresh artists serves fewer discovery picks rather than reaching outside the
  request. The picks' reasons show the effect: a discovery pick carries the shared
  `discovery_pick` reason ("a verified artist you haven't played yet" wording from
  `DISCOVERY_EXPLANATIONS`), so more of them appear in New and none in Familiar.
- **Plumbing (mirrors `fillSimilar`, #2316).** `preferences.discovery` is
  `"familiar" | "mixed" | "new"`: validated by `IsIn` on the sessions DTO (anything else
  is `400`), re-checked in the `agent_config` controller and the `sessions.service`
  sanitiser (an unknown value is dropped, so Mixed), remembered for the live session
  (a pick states it either way, including `"mixed"`, because the server keeps the last
  value when the key is omitted), carried through the runtime and orchestrator inputs
  and `deterministicSelectorInput` as `AgentSelectorInput.discovery`, where the selector
  turns it into `explorationShare`. The LLM path honours it too:
  `AgentRuntimePolicyService` passes the same share to the policy stage, skips the
  discovery swap-in under Familiar (`canSwapForDiscovery`), and asks the selector for the
  replacement under the same level. The LLM path still swaps in at most one discovery
  pick; New's larger share then applies to the policy stage and the rule-based top-up.
  A Start sends `discovery` only when it is not Mixed; a Mixed session is byte-for-byte
  what it was. It applies to My Mix sessions as well (the control stays visible there).
  Analytics: `optionalFilters` gains `discovery` when it is not Mixed.
- **Tempo.** A BPM range in Adjust (two inputs: lowest and highest; one bound alone is
  an open range; both empty clears it). It **edits `request.bpm`**, the tempo a sentence
  such as "around 122 BPM" already sets, rather than adding a second preference: it
  therefore combines with any starter or sentence, shows and removes through the
  existing BPM chip, travels in the existing `request` (validated and bounded by the
  backend, 40 to 220 BPM), and needs no new backend field. It is honest about coverage:
  the hint reads "Only tracks with a measured tempo can match. A track without one never
  counts as a match; it comes after the matches." (`requestPredicates`: an unmeasured
  tempo never matches, so such a track is tier B behind the matches.) A half-typed or
  unsupported number, or a lowest tempo above the highest, is not applied
  (`readTempoDraft`) and says why. Hidden inside My Mix, which has no request. A Tempo set
  before a starter survives picking it, like Energy. Analytics: `optionalFilters` gains
  `tempo`.
- **First-session tip.** After the first finished session (a session with `endedAt`,
  none live), the prompt shows one line: "Tip: you can combine. Try *Afrobeats, chill*",
  where the example fills the prompt when tapped, and a dismiss button. Dismissal (also
  trying the example, or starting the next session) is stored in this browser only
  (`localStorage` key `resonate.dj.firstSessionTipDismissed`, every access wrapped in
  try/catch); nothing goes to the server or to analytics. If storage cannot be read the
  tip stays hidden rather than returning on every visit. The example is covered by a
  test that the parser reads it with nothing left over.
- **Tests.** Backend pure: `discovery_control.spec.ts` (slots per level, tiers
  respected, pacing, cap), the LLM path in `agent_runtime_policy.spec.ts`,
  `deterministic_recommendation_adapter.spec.ts`, the DTO `400` cases in
  `sessions.controller.http.spec.ts`, `agent_config.controller.spec.ts`. Backend
  integration: `agent_discovery_control.integration.spec.ts` (real Postgres: Familiar
  labels none, Mixed unchanged, New more than Mixed and never outside the request),
  `sessions.integration.spec.ts` (remembered value). Web: `sessionPreferences.test.ts`,
  `agentSessionRequest.test.ts`, `agentFirstSessionTip.test.ts`,
  `AgentSessionPrompt.test.tsx`, `AgentSessionPanel.test.tsx`.
- **Deferred.** A Discovery default that follows the listener's history (a later
  decision); screenshots in the User Guide are not refreshed here.

## Played-through milestone for Sonic Radar (#2097)

Sonic Radar's resonance rule needs a `complete` `AgentSignal` with
`completionRatio >= 0.9`, but that signal mirrored `playback.completed`, which
the web sends once per track at the 30-second counted-play mark with the
position at that moment (about 0.1 for a typical track). No web play could
qualify, so the journal, its "Almost there" prompt and the AI DJ "resonated"
banner stayed empty.

- The web player sends a separate lifecycle action, `played_through`, once per
  playback instance when the position reaches 90% of a known duration
  (`shouldReportPlayedThrough`, `PLAYED_THROUGH_RATIO`).
- `AgentLearningService.recordPlayedThrough` upgrades the `complete` signal of
  the same playback instance (same telemetry dedup id) to the real ratio and
  marks `outcome.playedThrough`. Action, weight, count and `createdAt` are
  unchanged, so the taste profile needs no recompute. When no 30-second play
  was recorded it creates that signal through the regular telemetry path.
  Analytics consent, agent-playback training and taste reset are honoured.
- `playback.completed` keeps its counted-play meaning for popularity, Scene
  Scout, first-listener reception and warehouse reports.
- The journal's `completedAt` stays the signal's 30-second timestamp, so the
  seven-day follow-up window starts there. Plays from before #2097 cannot be
  upgraded because no position was recorded.
- Tests: `playback_played_through.integration.spec.ts` (including an
  end-to-end Sonic Radar case), `analytics_instrumentation.spec.ts`,
  `analytics.controller.http.spec.ts`, `playbackAnalytics.test.ts`.

## Unified Ranking Core (#1448 WS-1)

Since Sprint 8, the AI DJ and the Home feed rank with **one shared brain**:
`DiscoveryRankingService` (`backend/src/modules/recommendations/
discovery-ranking.service.ts`), extracted from the DJ's selector. Both
surfaces feed it candidates plus context (taste queries, learned genre
weights, embedding similarity, warehouse taste scores, cohort context, energy,
taste-memory policy) and receive weighted signals + human explanations.

- `GET /recommendations/:userId` now routes through the core: candidates come
  from a UNION of sources (newest-50, catalog-wide preference matches with no
  recency bias, cohort query hints, embedding neighbours) instead of "50 newest"
  — older tracks are recommendable. WS-3 popularity marts / WS-6 CF slot in as
  further sources; the WS-5 embedding source is wired in, see
  [Home candidate source](#home-candidate-source-2003-2006) below.
- User preferences and served-history are durable (`RecommendationProfile`
  Prisma model), fronted by a fail-open Redis cache
  (`shared/redis_cache.service.ts`) — they survive restarts and are coherent
  across Cloud Run instances.
- Deterministic fallback: with Redis, BigQuery, and every optional signal
  source unavailable, both surfaces still return correct ranked results from
  Postgres alone.
- The legacy Home response contract is unchanged (reason strings
  `genre:X`/`mood:Y`/`cohort:Title`, strategies, taste-memory hide/downrank
  semantics); items additionally carry `explanations` from the core.
- Tests: `backend/src/tests/discovery-ranking.integration.spec.ts`
  (durability across instances, wide-pool, deterministic fallback) plus the
  pre-existing recommendation/agent suites.

## Track Embeddings (#1452 WS-5)

Status: `partial`. The 16-dim hashed bag-of-words placeholder is replaced by
real text embeddings over track metadata, stored in pgvector and searched
through an HNSW index. ADR-BM-6: vision-neutral infrastructure for Line 4
discovery quality; it changes no price, fee or payout.

- **Model and dimension.** Vertex AI `text-multilingual-embedding-002` by
  default (override with `TRACK_EMBEDDING_MODEL`), 768 dimensions
  (`TRACK_EMBEDDING_DIMENSION`, matching `TrackEmbedding.vector(768)`). Documents
  are embedded with `task_type: RETRIEVAL_DOCUMENT`, queries with
  `RETRIEVAL_QUERY`, `autoTruncate: true`, at most 16 instances per request and
  a 15 s timeout. Auth is Application Default Credentials over REST, the same
  pattern as the SynthID client.
- **What is embedded.** `trackEmbeddingText`: title, credited artist, featured
  artists, release title, genre and moods. No listener, play or commercial data.
  `TrackEmbedding.contentHash` = sha256(model + text), so re-embedding is skipped
  when metadata and model are unchanged. Only publicly listable tracks (release
  `ready`/`published`, public or unassigned rights route, track not quarantined or
  removed) get a vector.
- **Provider modes** (`TRACK_EMBEDDING_PROVIDER`): `vertex` (opt-in, since calls
  are metered; needs a GCP project), `hash` (explicit offline fallback: the old hash
  embedder widened to 768 dims, stored as model `hash-v1`; lexical, for local
  work and tests) or `disabled` (the default). Every stored vector
  records its `model`; similarity and nearest-neighbour queries only compare
  vectors of the same model, so hash and real vectors never mix and a model
  change re-embeds lazily.
- **Index.** `TrackEmbedding_vector_hnsw_idx` (`USING hnsw (vector
  vector_cosine_ops)`, created in the migration as raw SQL because Prisma cannot
  express it) plus an index on `model`. `EmbeddingStore.nearest` uses
  `ORDER BY vector <=> $q LIMIT k` (k clamped to 1..100) so the planner can use it.
- **Embed on ingest.** `TrackEmbeddingService` subscribes to
  `catalog.release_ready` (and `catalog.updated` when it carries a `trackId`) and
  embeds that release's tracks fire-and-forget: a provider failure is logged and
  never blocks or fails the publisher. Tracks missed this way are picked up by
  the backfill.
- **Backfill.** `POST /admin/embeddings/backfill` (admin JWT), body
  `{ "limit": 1..200 }` (default 50). Oldest tracks lacking a current-model vector
  first; leftover capacity re-verifies the least recently verified vectors
  against their content hash and re-embeds only those that changed. Returns
  `{ status, model, scanned, embedded, skipped, failed, remaining }`; re-run until
  `remaining` is 0. The application procedure only; scheduling and platform
  wiring live in the private deployment repository.
- **Similar tracks.** `TrackEmbeddingService.similarTracks(seedTrackId, { limit,
  allowExplicit })` returns `{ source, model, results: [{ trackId, score }] }`.
  With a current-model vector for the seed it returns its nearest neighbours
  (`source: "embedding"`), restricted to publicly listable, non-explicit (unless
  allowed), not fully AI-generated tracks (ADR-BM-5). It reads stored vectors
  only: no model call, no play data, so a track nobody has played yet is reachable
  (cold start) and it keeps working when Vertex is down. Otherwise it falls back
  deterministically (`source: "metadata_fallback"`): same release genre first,
  then same artist, newest first, seed excluded. Scores are only comparable within
  one source.
- **`embeddings.similarity` tool (AI DJ).** Embeds the combined query once
  (`RETRIEVAL_QUERY`), lazily embeds candidates that lack a current vector, then
  ranks by cosine similarity. When the provider is unavailable it returns
  `{ ranked: [], status: "unavailable" }` and the selector keeps its deterministic
  order; candidates without a vector are kept after the ranked ones.
- **Cost bound.** Embedding calls happen only in backfill runs (at most `limit`
  tracks), on ingest (one release's tracks), lazily for DJ candidates that have no
  current vector, and once per DJ similarity call for the query.
  `similarTracks` makes none.
- **Remaining for #1452.** Audio-feature vectors are later. The Home candidate
  source is described in the next section.
- Tests: `embeddings.spec.ts`, `vertex_embedding.client.spec.ts`,
  `agent_selector_embeddings.spec.ts`, `embeddings_module.spec.ts`,
  `embeddings.integration.spec.ts`, `track_embedding.integration.spec.ts`,
  `maintenance.controller.http.spec.ts`.

### Home candidate source (#2003, #2006)

Home (`RecommendationsService.gatherCandidates`) now has a fourth candidate
source, `embedding-neighbours`, next to newest-50, preference matches and cohort
hints. Vision-neutral infrastructure for Listener Pro discovery quality
(ADR-BM-6, Line 4); no payout mechanics.

- **Seeds.** Up to **3** tracks from the listener's own positive signals, newest
  first, one per track: a `save` or `add_to_playlist`, or a `complete` with a
  recorded completion ratio of at least 0.9. Never skips, short plays or anyone
  else's history. Seed rules (`embedding_seeds.ts`, pure and unit-tested):
  signals at or before the taste-memory reset are ignored; agent-originated
  playback is ignored when "AI DJ playback trains my taste" is off (the same
  predicate the learning loop and the discovery journal use); a track whose
  genre, mood or artist is hidden or downranked is never a seed; without the
  taste-memory policy there are no seeds (consent cannot be checked).
- **Neighbours.** For each seed, `TrackEmbeddingService.embeddingNeighbours`
  returns up to **10** nearest tracks from **stored vectors only**: publicly
  listable, non-explicit unless allowed, not fully AI-generated (ADR-BM-5), seed
  excluded. Zero-play tracks are reachable. The deterministic metadata fallback
  of `similarTracks` is deliberately **not** used on Home, so with the provider
  disabled (the default), no vectors, or no seeds, Home returns exactly what it
  returned before this source existed, and does no extra queries when disabled.
  Home never calls the embedding model and never writes vectors.
- **Written notes (#2006).** When a `note` control is applied
  (`applyTasteEdits`), its text is embedded once as a retrieval query and the
  vector is stored in `ListenerTasteNoteEmbedding` (`controlId`, `vector(768)`,
  `model`, `contentHash`), deleted with the control. Embedding is best-effort:
  provider disabled or failing means no vector and the apply still succeeds; the
  text goes to the provider and is never logged or published. On Home, up to **2**
  of the listener's newest notes with a current-model vector each contribute up
  to **10** neighbours. Notes survive a taste reset, like the control itself. A
  note saved while the provider was disabled has no vector until it is re-applied.
- **Bounds.** At most 3 x 10 seed neighbours plus 2 x 10 note neighbours join the
  pool, deduped against the other sources and re-checked against the public
  catalog predicate. Every failure degrades to "no neighbours".
- **Ranking.** Candidates carry a categorical `embeddingSources`
  (`seed_track` / `listener_note`), never the seed id or the note text. A
  seed neighbour gets `embedding_similarity` (weight 8, reason code
  `similar_sound`, "Sounds close to your taste"); a note neighbour gets
  `declared_note_match` (weight 8, reason code `taste_match`, "You asked for
  more of this"). Both sit below the declared-preference weight (20) and the
  learned-preference cap (18), so a neighbour never outranks a stated or learned
  match. Home treats an embedding neighbour as a taste match when choosing
  between preference matches and the fresh fallback, so it is not dropped
  whenever a genre or mood term matched elsewhere; the policy stage (hidden
  taste, diversity cap, exploration) still applies. The response contract is
  unchanged apart from the additive `reasonCode` / `explanations` values.
- Tests: `embedding_seeds.spec.ts`, `discovery_ranking_embedding.spec.ts`,
  `home_embedding_candidates.integration.spec.ts`.

## One Core, One Profile, One Policy (#1456 WS-9, #1957)

Status: `implemented`. The AI DJ and Home are now two callers of the same stack
(`backend/src/modules/recommendations/`): score with `DiscoveryRankingService`,
then pass the result through `applyDiscoveryPolicy` (ADR-TE-2,
[Taste Engine RFC §3.4](../rfc/taste-engine.md)).

- **One taste profile.** Both surfaces rank with the learned genre weights in
  the persisted `AgentConfig.learnedTasteProfile`, through one resolver,
  `resolveAgentTasteProfile` (`agents/agent_learning.service.ts`): the stored
  profile (kept current by `recordSignal`, cleared by a taste-memory reset), else
  a profile computed from the listener's `AgentSignal` history with the same
  reset and hide/downrank rules. Read-only; it never writes the profile. The
  same listener therefore gets the same score for the same track on Home and in
  the DJ. Home previously passed no learned weights.
- **One served history.** Home reads and writes `RecommendationProfile.
  servedTrackIds` — the 50 most recently served distinct tracks, newest
  first; a re-served track moves to the front rather than repeating, so the
  window never fills with copies of a few ids. The DJ selector reads the same
  list (through
  `RecommendationsService.getServedHistory`) and demotes those tracks like a
  recent play. They stay available at the tail, so a small catalog never runs
  dry. Only the session's own tracks (`recentTrackIds`) are excluded outright,
  as before. The DJ does not write to the served history. A session with a
  request of its own no longer reads it at all (#2316, "Request-first
  selection"): it demotes recently played tracks gently instead.
- **Policy on both surfaces.** Hidden taste, fully AI-generated tracks, the 20%
  exploration share for verified human artists the listener has never played,
  and the two-per-artist cap (per page on Home, per 10 session tracks in the DJ)
  run after scoring. Every item carries a categorical `reasonCode`
  (`DISCOVERY_REASON_CODES`) and vocabulary sentences. Home items expose
  `reasonCode` beside the existing `reasons` and `explanations`; DJ picks carry
  it on `agentRecommendation.reasonCode`, and the next-pick response and the
  accept signal's `metadata.recommendation` keep it (whitelisted against the
  vocabulary, which the Sonic Radar journal reads back). The policy lookups come
  from `DiscoveryPolicyContextService`; when they are unavailable the DJ and Home
  run the policy with empty sets, which only removes exploration slots. In the
  DJ the session exploration share counts the discovery picks among the last 9
  session tracks (accepted picks whose `metadata.recommendation.reasonCode` is
  `discovery_pick`), so late in a session only the remaining share is reserved;
  when that count is unavailable the share is taken over the page alone, never
  over the whole session window. One call never reserves more than its own
  page share, so a session that fell behind catches up gradually, not in a
  burst.
- **Session intent is context, not taste.** The DJ passes the session's intent
  and mood (`sessionIntent`, `mood`, `queueStyle`) to the ranking core as
  request context. A candidate whose moods, genre or titles match earns a
  `session_intent_fit` signal (+12, "Fits this session intent", `reasonCode`
  `session_fit`), smaller than any taste match. It is never stored as taste.
  `queueStyle` is carried for sequencing and is not matched against metadata.
- **No listing in listener ranking (rule 6).** `catalog.search` returns
  `hasListing` as data only; it no longer sorts listed tracks first, and the
  ADK, Vertex and model-assisted prompts no longer tell the model to prefer them.
  The recommendation eval still reports `listingCoverage` but neither scores nor
  gates on it. `catalog.search` now also returns `release.artistId` and
  `release.moods` so DJ candidates can be exploration picks and intent matches.
- **LLM runtime picks.** The default runtime (`AGENT_RUNTIME=adk`, and `vertex`)
  lets the model call `catalog_search` and pick tracks itself. Those picks now
  pass the policy step, `AgentRuntimePolicyService`, applied in
  `AgentRuntimeService.run`: the one choke point that
  `AgentConfigController.startSession` and `SessionsService.agentNext` both
  reach, in-process or via the remote worker (the backend applies it to the
  worker's LLM picks, so the stage runs exactly once; the worker's execute route
  returns the raw executor result). The standalone worker provides the
  shared ranking, taste and cohort classes, so its deterministic orchestrator
  fallback runs the same policy stage. It loads the picked tracks'
  metadata in one batched query, scores them with the shared ranking core in the
  same context the DJ selector builds, then enforces rule 1 (hidden), rule 2
  (fully AI-generated), rule 3 (exploration share, session mode, with the same
  lookups and prior discovery count as the selector), rule 4 (two per artist,
  session mode) and rule 5 (a `reasonCode` plus vocabulary sentences on every
  pick, carried into the accept signal's `metadata.recommendation`). The model's
  order is kept. A model pick by a verified human artist the listener never
  played is labeled `discovery_pick` in place. When rule 3 reserves a discovery
  slot and no model pick qualifies, the model's last pick is swapped for the
  deterministic selector's discovery pick for the same listener, session and
  preferences (skipped if it repeats a pick or breaks the artist cap; price 0,
  the pick's license type kept). A one-track call whose prior discovery count is
  unknown never swaps, so single next-pick calls are not always discovery picks.
  `policy.exploration` on the result reports `reserved`, `served` and
  `injected`. Invented track ids are dropped, and if nothing survives the result
  is the existing no-pick shape with reason `no_policy_eligible_picks`. The model-assisted
  strategy reranks the deterministic shortlist, which already ran the policy.
  The Home feed's other rails (`new_from_artists`, trending, exploration,
  catalog signal) are composed outside `getRecommendations` and pass the same
  policy in their own order (see Home Feed v2 below).

Tests: `backend/src/tests/agent_selector_unification.spec.ts` (policy, session
intent, shared profile/served history on the selector),
`agent_listing_not_a_preference.spec.ts` (rule 6 on prompts and eval),
`agent_runtime_policy.spec.ts` and `agent_runtime_policy.integration.spec.ts`
(policy step for LLM picks, batched metadata load, parity with Home),
`discovery_unification.integration.spec.ts` (Home and the DJ for one seeded
listener) and `agent_catalog_search.integration.spec.ts`.

## True Trending & Top Artists (#1451 WS-4)

Home's "Trending Now" and "Top Artists" rails rank by **measured engagement**,
never upload recency. They read the WS-3 serving tables
(`TrackPopularity` / `ArtistEngagement`: `window` 24h/7d/30d × `genre`
dimension, `""` = overall) through public endpoints:

- `GET /catalog/trending?window&genre&limit` — ranked tracks with score,
  plays, unique listeners, saves.
- `GET /catalog/top-artists?window&genre&limit` — per-artist rollups with
  listeners **unioned** across their tracks, per-genre re-rank for the Home
  genre chips.

Both are fronted by the fail-open Redis cache (120s TTL). Honesty rules:
rows below `DISCOVERY_MIN_AUDIENCE` unique listeners (default 3) are never
written, and an empty result renders an explicit "not enough listening yet"
state on Home — there is no recency fallback.

Until the WS-3 warehouse marts land (#1450), the tables are filled by an
interim in-process aggregation over local `AnalyticsEvent` facts
(`DiscoveryPopularityService.refresh()`: completion-weighted plays +
playlist saves, linear time-decay per window, bounded read) on an
env-driven cadence (`DISCOVERY_POPULARITY_REFRESH_MINUTES`, default 15,
`0` disables). WS-3 replaces only this filler — endpoints, tables, and UI
are already on the final contract.

Tests: `backend/src/tests/discovery-popularity.integration.spec.ts`
(aggregation, threshold exclusion, genre dimension, snapshot replace),
catalog controller unit + HTTP specs, and
`web/src/components/home/PopularityRails.test.tsx` (ranked render, genre
re-rank, honest empty state).

## Home Feed v2 (#1454 WS-7)

Home's personalized surface is a **multi-rail feed** composed (never
re-ranked) from the WS-1 core and WS-4 serving by
`backend/src/modules/recommendations/home-feed.service.ts`, served at
`GET /recommendations/:userId/home-feed` (JWT):

- `because_genre` — "Because you save a lot of \<genre\>": WS-1 items whose
  reasons match the dominant saved genre/mood.
- `new_from_artists` — newest catalog from artists the listener has actually
  played (derived server-side; item history never leaves the backend). Plays
  are looked up under every actor id a producer may write: the raw and
  lowercased user id, and the pseudonymous `user_<hash>` id the browser
  playback routes store (`analyticsActorIdCandidates`). Before #2100 only the
  raw id was queried, so web plays never counted: the rail was always empty and
  a listener with no declared taste stayed on "Catalog signal" however much
  they played. Plays before a taste reset are ignored, and AI DJ session plays
  are ignored while "learn from AI DJ playback" is off.
- `listening_genre` — "Because you've been playing \<genre\>" (#2101): the
  learned profile's top genre when it is not one of the listener's declared
  genres, with at least 5 positive signals behind it and never a genre the
  listener downranked. It sits right after
  `because_genre`, which keeps its declared anchor (ADR-TE-5: declared >
  behavioral), and is the only genre rail for a listener with no declared
  taste. The genre is added to the single `getRecommendations` call as an extra
  preference term (`additionalGenres`), so no second ranking call records
  impressions or exposure. Items carry `listening_pattern`. Design:
  [declared vs. listening taste](../rfc/declared-vs-listening-taste.md).
- `trending_genre` — "Trending in \<genre\>" from the WS-4 serving tables,
  for the declared anchor, else the listening genre.
- `exploration` — a controlled slice of fresh/low-data tracks
  (`DISCOVERY_EXPLORATION_COUNT`, default 4) to escape feedback loops.
  Candidates are the newest public releases, one lead track each, so a release
  fills at most one card. A track is low-data only when fewer than
  `DISCOVERY_MIN_AUDIENCE` distinct listeners played it in the last 30 days,
  counted from the consented analytics ledger, and it has no popularity row
  (#2050). A missing popularity row alone no longer counts, because empty or
  stale serving tables would make every track look unheard.
- `catalog_signal` — cold users only (RFC §8), labeled as exactly that. A
  listener leaves it with one counted play or one declared genre or mood boost;
  the rail links to Settings → Taste Memory (`/settings?section=taste`).

Rules enforced in composition: every explanation is **categorical** (RFC §7 —
never itemized listening history), max 2 items per artist per rail, each
track appears in at most one rail, previously-served items sink to the rail
tail and rendered ids re-enter the served history (impression rotation), and
the old "first 4 catalog releases" fallback is gone — an empty feed says so.

Every rail passes the ADR-TE-2 policy stage (`applyDiscoveryPolicy`, #1456)
through `applyRailPolicy`, keeping the rail's own order: an artist, genre or
mood the listener hid never appears on any rail, fully AI-generated tracks are
removed, and each item carries a `reasonCode` and vocabulary `explanations`
beside its legacy `reasons`. Ranked items keep the ranking core's reason;
`new_from_artists` items are `listening_pattern`, and trending, fresh and
catalog-signal items are `catalog`, since their rail title already says why.
These rails reserve no exploration slot and never label an item a discovery
pick: rule 3 runs in the ranked rail, and the `exploration` rail is the feed's
dedicated fresh-track slice. Taste memory is read once per render and fails
open (no hides applied) when it is unavailable.
The frontend (`web/src/components/home/HomeFeedRails.tsx`) is presentation
only and emits one `recommendation.served` per rail plus
`recommendation.clicked` per action (#1449 measurement base).

Tests: `backend/src/tests/home-feed.integration.spec.ts` (rails, caps,
rotation, cold/warm, hidden artist removed from every rail, exploration
low-data and one-per-release rules),
`home_feed_rail_policy.spec.ts` (rail policy rules),
`recommendations.controller.http.spec.ts` (routing,
guard, shape), `web/src/components/home/HomeFeedRails.test.tsx`.

## Measured vs inferred audio features (#1960)

**Vision alignment (ADR-BM-6):** vision-neutral infrastructure and quality for
Lines 3 and 4. No fee, split or payout changes.

`AgentAudioFeatureService.getOrCreate` builds `agent-audio-features/v2` for each
candidate. Until #1960 every value was inferred from metadata: the tempo is a
hash of title and genre, not a measurement. Since #1960 the service overlays the
measured full-mix features that ingestion stores on the current `original` stem
(`stem-audio-features/v1`, see [Audio features](audio_features.md)). The pure
rules live in `backend/src/modules/agents/measured_track_features.ts`
(`measuredTrackFeatures`), and each field is measured or falls back on its own.

| Field | Measured when | Otherwise |
| --- | --- | --- |
| Tempo | `tempoBpm` is present and `tempoConfidence >= 0.5` (`MEASURED_TEMPO_MIN_CONFIDENCE`; the extractor's confidence is a beat-vs-average onset strength ratio mapped to (0,1), so 0.5 means beats are no stronger than average) | inferred hash tempo |
| Key and Camelot | key confidence `>= 0.1` (`CAMELOT_MIN_KEY_CONFIDENCE`); Camelot is the stored code or derived for older rows | `key` and `camelot` are null |
| Energy | `energyRms` is present: `clamp(0.65 * clamp(energyRms / 0.3) + 0.35 * clamp(onsetDensity / 8))`, rounded to 4 decimals (a missing onset density counts as 0) | genre and title inferred energy |

Measured tempo and energy replace the inferred values everywhere they were
used: `tempoBpm`, `tempoBand`, `energy`, `energyBand`, the feature-vector energy
and tempo dimensions, and the mood and tag bands. The output gains
`featureSources` (`tempo: measured|inferred`, `key: measured|unavailable`,
`energy: measured|inferred`), `tempoConfidence` (only when the tempo is
measured), `key` and `camelot`. `source` becomes `measured_full_mix` when the
tempo or the energy is measured, and `confidence` is raised to the measured
tempo confidence (or 0.5 when only energy is measured) when that is higher. With
no measurement, or only below-threshold values, the output equals the previous
inferred output apart from the new fields (`featureSources` inferred, `key` and
`camelot` null).

**Cache key.** The derived features are cached in
`track.generationMetadata.agentAudioFeatures`. The cache is valid only when
`agentAudioRevision` equals the track's active audio revision and
`agentAudioMeasuredKey` equals the current measured key: a short sha1 over the
original stem id and its measured fields, or `none` when nothing is measured. A
backfill or a new ingestion that changes the measured features therefore
re-derives on the next read. Cached entries without `featureSources` (written
before #1960) are stale and are re-derived.

**Explanation rule.** The ranking core prints a BPM only when the tempo is
measured, rounded to an integer (`124 BPM, high energy`). When the tempo is
inferred the reason shows the energy band alone (`high energy`), because the
inferred number is fabricated. The model-assisted adapter applies the same rule
(`tempoBpm` is null unless measured). Scoring weights are unchanged.

Listeners can see the measured values on the public catalog track API as
`audioFeatures`, described in [Audio features](audio_features.md). The inferred
tempo is never exposed there.

## Recommendation Explanations

Warehouse explanations are treated as untrusted hints. The backend sanitizes
them before use and translates them into listener-safe reason categories:

| Type | Listener-facing meaning |
| --- | --- |
| Taste fit | The track matches learned listening patterns. |
| Session intent fit | The track fits the current mood, vibe, or Session Intent. |
| Novelty/replay fit | The track is fresh enough for the current session based on replay/skip signals. |
| Library/purchase fit | The listener's own saves, playlist adds, or purchases increase confidence. A stem being for sale never does (ADR-TE-2 rule 6). |

Explanations must not expose raw event history, user ids, session ids, wallet
addresses, emails, URLs, exact private counts, or model internals. If warehouse
copy is missing or rejected, recommendations keep their deterministic fallback
copy such as `Learned listening pattern fit` or `Catalog candidate`.

Example materialized shape:

```sql
CREATE OR REPLACE TABLE `${PROJECT_ID}.${DATASET}.user_track_recommendation_scores` AS
SELECT
  user_id,
  track_id,
  recommendation_score,
  confidence,
  rank,
  explanation,
  model_version,
  updated_at
FROM `${PROJECT_ID}.${DATASET}.agent_candidate_scores`;
```

## Sonic Radar: discovery journal (ADR-TE-5)

Status: `partial`. Sonic Radar (`/sonic-radar`) is the listener's discovery
journal: the tracks that resonated. It no longer lists agent purchases, because
the AI DJ does not buy (ADR-TE-1). Design:
[RFC §4.1](../rfc/taste-engine.md#41-sonic-radar-becomes-the-discovery-journal)
and [ADR-TE-5](../strategy/taste-engine-decisions.md).

**Vision alignment (ADR-BM-6):** vision-neutral infrastructure/quality. It is a
read-only listener surface with no money movement, fee or payout.

**Resonance rule** (RFC §3.3). A track resonates for a listener when:

1. an `AgentSignal` `complete` exists with `metadata.outcome.completionRatio >= 0.9`
   (a `complete` with no recorded ratio never qualifies), and
2. within 7 days after that completion the listener replayed it (a later
   `complete` or `replay` signal on the same track) or saved it (a `save` or
   `add_to_playlist` signal, or a `LibraryTrack` row created in that window).

A follow-up that has not happened yet does not count. The earliest qualifying
completion per track is the one shown.

**Resonant discovery.** A resonant track whose artist (the release's artist
profile) the listener had no earlier recorded interaction with. The opening
`accept` signal of the very listen, and other tracks of the same sitting (two
hours before the qualifying completion), do not count as earlier interaction;
otherwise a first listen could never be a discovery. The headline counts
resonant discoveries and distinct new artists over the last 7 days ending now.

**Endpoint.** `GET /agents/discoveries` (JWT required; the listener is always
the authenticated user) with optional `windowDays` (1 to 90, default 28) and
`limit` (1 to 100, default 50). Non-integer values return `400`; numbers are
clamped. Response contract `discovery-journal/v1`:

- `window: { days, from, to }`
- `headline: { resonantDiscoveriesThisWeek, newArtistsThisWeek }`
- `groups[]: { key, sessionId | null, date, items[] }`, grouped by
  `AgentSignal.sessionId` when present, else by the UTC calendar day of the
  qualifying completion; newest first.
- `items[]`: `trackId`, `title`, `artistId`, `artistName` (credited name),
  `releaseId`, `releaseTitle`, artwork fields, `resonatedAt`, `followUp`
  (`replayed` or `saved`), `discovery`, `reason: { code, text }`, and
  `nextAction`.
- `reason` uses the shared categorical vocabulary in
  `backend/src/modules/recommendations/discovery-explanations.ts`. A
  `reasonCode` recorded on the listener's own accept signal wins when it is in
  the vocabulary; otherwise a discovery by a verified human artist is a
  discovery pick and everything else is a listening-pattern fit. Free-text
  agent reasons are never shown. Until the signal recorder persists a
  `reasonCode` (the metadata sanitizer keeps only `score` and `explanation`
  today), the fallback applies.
- `nextAction` is one per artist, on the artist's first item in display order
  and `null` on the rest: the artist's open Shows campaign (active, before its
  deadline, not signal-level) when one exists, else the artist page. A "follow
  the artist" action is not offered because no follow feature exists yet.
- `pending[]` ("Almost there", additive to v1): up to 12 tracks the listener
  played through (a `complete` with `completionRatio >= 0.9`) in the last 7
  days that have not resonated yet, newest completion first. Each carries the
  same track, artist, release and artwork fields as `items[]`, plus
  `completedAt` (the latest qualifying completion), `followUpBy`
  (`completedAt` + 7 days, the last moment a replay or save still makes the
  track resonate) and `discovery`. Tracks already in the listener's library
  (a `LibraryTrack` row at any time), tracks that are not publicly available,
  and tracks whose artist or genre the listener hid in taste memory are left
  out. The list carries no reason and no next action: it is a prompt to save,
  not a recommendation.
- `newFromDiscovered[]` ("New from artists you discovered", additive to v1,
  [#2086](https://github.com/akoita/resonate/issues/2086)): up to 12 tracks,
  at most 2 per artist, newest release first, from releases by journal artists
  (artists with a resonant track in the window) that arrived on Resonate
  (`Release.createdAt`) after the listener's first resonant listen of that
  artist and within the last 60 days. Each carries the track, artist, release
  and artwork fields, `addedAt` and the categorical reason
  `new_from_discovered_artist` ("New from an artist you discovered"). Left
  out: tracks the listener already played (any signal since a taste reset) or
  has in the library, tracks that are not publicly available, fully
  AI-generated tracks (ADR-TE-2 rule 3), and hidden artists or genres. Listings
  and prices are never read, so having stems for sale changes neither
  inclusion nor order (ADR-TE-2 rule 1). Computed on read with bounded queries;
  there is no scheduled job.

**Privacy and consent.** The journal is computed on read from the signed-in
listener's own `AgentSignal` and `LibraryTrack` rows, bounded to the window and
at most 2000 signal rows; it never reads another listener's data. It follows
the taste-memory controls: signals from before a taste reset are ignored (also
when deciding whether an artist is new), and when "AI DJ playback trains my
taste" is off, agent-originated playback (`source = agent_session`, or
`agentOriginated`) is excluded. Only publicly available tracks are listed
(same availability rules as the catalog: published, not withdrawn, not
removed, not restricted).

**No purchase data.** The payload has no price, spend, license or transaction
fields. Purchase history lives in the wallet and library views. The Listener
Pro "where your money went" statement in RFC §4.1 is not built.

**Web.** `web/src/app/sonic-radar/page.tsx` renders the headline, the groups,
the reason and follow-up per track, the single next action per artist, and an
honest empty state with a link to start an AI DJ session. Above the journal, an
"Almost there" section lists `pending[]` with a Save button per track. Saving
adds the track to the library (a `LibraryTrack` row), which makes it resonate,
records the `library.saved` product event like the player does, and refetches
the journal. The User Guide article `sonic-radar` (AI DJ & Sonic Radar)
describes both.

**AI DJ link.** The Sonic Radar line on the AI DJ panel
(`web/src/components/agent/AgentSessionPanel.tsx`) reads the same journal
instead of counting every track the DJ served, and is scoped to the live
session (#2313; it replaced the 28-day "N tracks resonated with you" banner of
#2089). `sonicRadarSessionLine(journal, trackIds)` in
`web/src/lib/sonicRadarSummary.ts` counts only journal items whose track is in
the live set (`useDjSet().trackIds`): "From this session: 2 saved, 1 replayed"
with a Sonic Radar link. A resonant item has one follow-up, so a track is counted
once (saved wins if the journal lists both). When none of the session's tracks
resonated, it shows the "one save away" nudge for the session's own
played-through tracks. With no live set, or nothing from it in the journal, the
panel shows no banner and no empty state. Client-side only; Sonic Radar's own page
is unchanged.

**New from artists you discovered.** At the top of the page, a section lists
`newFromDiscovered[]` with Play and Save on each card; "Almost there" cards
also get Play, since a replay makes a track resonate too. Play queues the
catalog stream without adding the track to the library. The AI DJ panel no longer
mentions new tracks from discovered artists (they stay on Sonic Radar). Notifications or digests for
new releases, scheduled playlists and an artist follow model stay out of scope
([#2086](https://github.com/akoita/resonate/issues/2086)).

**Tests.** `backend/src/tests/discovery_journal.integration.spec.ts` (the
resonance rule, discovery flag, per-listener scoping, consent, next actions,
the pending list and its exclusions, no price keys) and
`backend/src/tests/discovery_journal.controller.http.spec.ts`; on the web,
`web/src/app/sonic-radar/page.test.tsx`, `web/src/lib/sonicRadarSummary.test.ts`
and the banner cases in `web/src/components/agent/AgentSessionPanel.test.tsx`.

## Warehouse Materialization

The baseline warehouse script creates all three MVP tables from `events_clean`
without editing SQL literals:

```bash
cd workers/analytics-dataflow
AGENT_TASTE_MATERIALIZATION_PROJECT_ID="$GCP_PROJECT_ID" \
AGENT_TASTE_BIGQUERY_DATASET="$ANALYTICS_BIGQUERY_DATASET" \
./run-agent-taste-materialization.sh --verify
```

Use `--dry-run` to validate the query before writing tables. The runner passes
BigQuery query parameters for project, dataset, clean table, training table,
score table, and materialization version.

For scheduled execution, use the Dataform template in
`workers/analytics-dataflow/dataform/`. The target production architecture is
Cloud Scheduler triggering Workflows, which invokes the Dataform workflow tagged
`agent_taste` and checks assertions for serving-contract validity and freshness.
The detailed handoff is documented in
`docs/architecture/agent_taste_orchestration.md`.

The realtime `AgentSignal` loop now records privacy-safe
`agent-signal-metadata/v1` context for Session Intent picks and mirrors
playback, loop intent, library saves/removals and playlist additions into
weighted signals as described in [Learning from listening habits](#learning-from-listening-habits-2062). Stop events annotate existing session signals with coarse
`sessionDurationMs`.

## Quality Dashboard

Operators and admins can open `/analytics/agent-quality` or call
`GET /analytics/agent/quality?days=N` to inspect aggregate AI DJ quality
metrics. The report is computed from bounded `analytics_facts` windows and
works with both BigQuery report mode and local warehouse-export fallback.

The report tracks:

- acceptance rate and accepted next picks
- first-pick skip proxy from low-completion first-pick playback outcomes
- session starts, stops, and coarse average duration
- playback completions, saves, playlist adds, purchases, and purchase USD
- breakdowns by Session Intent, recommendation strategy, taste signal source,
  and model/materialization version

The dashboard is aggregate-only. It does not expose raw listener histories,
actor ids, wallet addresses, or per-user drilldowns.

### Habit Mix measurement (#2067)

Status: implemented measurement infrastructure. Vision-neutral under ADR-BM-6,
serving Line 4 (Listener Pro) phase 4 decisions. It does not change fees,
payouts, entitlements or the default session type.

Operators use `GET /analytics/agent/quality`, behind the existing JWT and
operator authorization, to compare `my_mix`, `preset` and `described` in
`sessionSourceBreakdown`. `sessionVariantBreakdown` groups the same measures by
source, experiment, ranker and ordering variant. A parsed session request is
`described`; an explicit My Mix request is `my_mix`; other sessions are
`preset`. These are server-derived categories, without preset names or prompts.

Every returned DJ pick records a `recommendation.generated` impression with
its track, pseudonymous actor, owner session, source, ranker, ordering and
actual exploration designation. This changes DJ generation exposure from one
row per batch to one row per pick. Home generation exposure remains per batch.
The TypeScript warehouse and Python streaming transform preserve identical
dimensions. Dashboard results contain aggregates, never actor/session IDs or
listener histories.

The new measures use attributed playback starts as their denominator:

- Skip rate counts distinct skipped episodes; early skips are positions below
  30 seconds. Completion requires at least 80% played, established by a matched
  heartbeat position or completion ratio. The legacy completed event fires at
  30 seconds and alone does not establish full-track completion.
- Saves and playlist additions each count once per episode. Resonance is their
  union, so saving and adding the same play does not double its rate.
- Session length reports starts in tracks and measured played minutes. Minutes
  use the largest observed outcome position, capped at known track duration;
  unknown durations and silent wall-clock gaps do not contribute minutes.
- Exploration acceptance counts exploration plays completed or saved, divided
  by exploration starts. Playlist addition alone does not count as exploration
  acceptance.

Attribution requires a preceding impression for the same actor, owner session
and track. Outcomes with a playback instance join that episode; ambiguous
legacy outcomes are excluded. Saves and canonical playlist additions can join
a recent same-actor track start within 30 minutes. Home rail attribution is
excluded. Older events without these labels remain in legacy discovery
metrics but cannot become evidence for this comparison. The measurement notes
report dropped or incomplete attribution; these rates describe observed,
consented playback rather than all listening.

#### Experiment arms and promotion

Reuse `DISCOVERY_RANKER_EXPERIMENT`, for example
`habit_v1:my_mix_habits=34,my_mix_lanes=33,single_profile=33`.
Assignment uses the existing stable user bucket and affects explicit My Mix
requests only. `my_mix_habits` uses lanes plus habit ordering; `my_mix_lanes`
uses lanes with neutral ordering; `single_profile` uses the deterministic
single-profile selector without lane quotas. All arms preserve catalog safety,
hidden taste, exploration and diversity. An invalid or absent experiment,
and unrelated variant names, retain existing behavior. Empty lanes fall back
and record the actual `single_profile` ordering instead of claiming habits ran.

`habitMixPromotion` reports evidence only. Compare the randomized
`my_mix_habits`/`habit` arm with `single_profile`/`single_profile` in the same
experiment and `my_mix` source. Both arms need at least 100 attributed sessions
and 500 starts, configured in `backend/src/config/habit_measurement.ts`.
The candidate must have skip rate no higher than control and completion rate
or resonance rate strictly higher. Preset and described source comparisons are
descriptive, since choosing a session source is not randomized. Passing the
rule does not activate a default or Listener Pro; an explicit product decision
and rollout remain required.

#### Offline replay

`backend/scripts/eval_habit_mix.ts` reads a bounded training-mart export and a
catalog fixture, with an explicit day-D cutoff. It rebuilds production listening
lanes from history strictly before D, then evaluates later completions and
saves/playlist additions. The lane-quota batch and genre-only v1 baseline
share the lane-eligible listener cohort and eligible catalog pool,
exclude training-seen tracks, and use shared recall@k and NDCG computation.
Targets absent from the catalog or excluded as fully AI-generated are
reported separately. Supply an eligible catalog snapshot with disclosure metadata;
omitted disclosure stays unspecified under the existing legacy policy. This isolates quota
and metadata fit; it is not an evaluation of semantic retrieval, live consent
availability or habit transition quality.

Run the CLI without production credentials, using the documented arguments in
[the implementation plan](../../.agents/plans/2067-habit-measurement.md).
Validation covers pure replay, aggregation edge cases, real-ledger impressions
and source metrics, warehouse parity, and the authorized HTTP response shape.
There is no listener UI or User Guide change in this slice.

### Discovery measurement (#1455 WS-8, first slice)

Status: `partial`. **Vision alignment (ADR-BM-6):** vision-neutral measurement
infrastructure for Line 4 (discovery quality). It has no payout mechanics, no
fee, and no income share; data is pseudonymous and reported in aggregate only.

`GET /analytics/agent/quality` keeps its existing sections and adds, with the
same admin/operator guard:

- `surfaceBreakdown[]`: per surface `{ surface, impressions, clicks, plays,
  completions, skips, saves, clickThroughRate, skipRate, completionRate,
  saveRate }`. Surfaces are `home:<railId>` (for example `home:because_genre`,
  `home:exploration`) and `dj`.
- `variantBreakdown[]`: the same counts and rates per `{ experimentKey, surface,
  variant }`. A fact with no recorded variant is `unattributed` (reported,
  never compared).
- `variantExposure[]`: `recommendation.generated` counts per `{ experimentKey,
  surface ("home" | "dj"), variant }`: how many times each variant generated
  recommendations, shown next to outcomes as exposures.
- `comparison`: for each `{ experimentKey, surface }`, every non-baseline
  variant against `baseline`: sample sizes (impressions and plays on both
  sides) and rate deltas (variant minus baseline). Descriptive only; no
  significance test is applied, read the sample sizes.
- `resonantDiscoveries: { total, distinctNewArtists, perActiveListener,
  activeListeners, status }` over the requested window. `status` is `ok`,
  `no_data` (no active listeners), `truncated` (a read cap was hit, counts are
  a lower bound) or `unavailable`.

Definitions (fractions, 0 on a zero denominator): `clickThroughRate = clicks /
impressions`, `skipRate = skips / plays` (explicit `playback.skipped`),
`completionRate = completions / plays` (`playback.completed`, the 30 second
rule), `saveRate = saves / plays` (`library.saved`). Home impressions are the
number of items shown in a rail (`recommendation.served` `count`). DJ
impressions are accepted picks; the DJ has no click, so its clicks and
click-through rate are 0.

**Attribution.** Served and clicked events carry `railId`. A Home tile opens a
release page or seeds a DJ session, and the play happens later, so the web
remembers the clicked track's rail and variant for 30 minutes
(`web/src/lib/homeAttribution.ts`, sessionStorage, labels only) and forwards
`railId` and `rankerVariant` on that track's `playback.started|completed|
skipped` and `library.saved` events. `source` stays `web_player`; the rail is a
separate field so the artist dashboard's source breakdown is unchanged. DJ
facts are the ones the existing dashboard already classifies as agent session
facts. Playback and save events are consent-gated telemetry (#1772), so all
rates cover consenting listeners only.

**Resonant discoveries on the dashboard.** The rule is the discovery journal's
(`resonant` = completion at or above 90% plus a replay or save within 7 days;
`discovery` = no earlier interaction with the artist; same consent controls and
public-availability filter), shared through `isDiscoveryListen` and
`findResonance` in `discovery_journal.service.ts`. It needs per-listener
history, which the warehouse facts do not carry, so it is computed in Postgres
by `DiscoveryJournalService.getResonantDiscoveryAggregate`: a bounded read
(at most 5000 completions and 20000 follow-up rows, `truncated` reports a hit)
that returns counts only. Listener ids never leave the service.
`activeListeners` is the number of distinct listeners with at least one
`AgentSignal` in the window.

**Both fact sources agree.** The BigQuery `agentQualityFactsQuery` and the
warehouse-export fallback both keep `recommendation.generated|served|clicked`
and rail- or DJ-attributed `playback.started|skipped`. The new fact dimensions are
`railId`, `rankerVariant`, `experimentKey`, `surface`, `reason` and `itemCount`
(the served `count`); the streaming transform in
`workers/analytics-dataflow/analytics_transform.py` writes the same dimensions
and the parity spec covers them.

**Skip events.** The web emits `playback.skipped` when the listener presses
next before 97% of a track. `POST /analytics/playback/event` previously only
accepted `started` and `heartbeat`, so those skips were rejected with `400`;
it now accepts `skipped` with a short `reason`.

**Variant and holdout mechanism.** `DISCOVERY_RANKER_EXPERIMENT` (see
[environment variables](../deployment/environment.md)) uses one format,
`<experimentKey>:<variantA>=<percent>,<variantB>=<percent>`, for example
`ranker_v2:candidate=10,holdout=5`; the remainder is `baseline`. Unset or
malformed means no experiment: everyone is `baseline`, no experiment key is
recorded, and behavior is unchanged. A listener's bucket is
`sha256(experimentKey + ":" + userId) mod 100`, so assignment is deterministic
and a new key reshuffles everyone. `backend/src/modules/recommendations/
discovery_experiment.ts` is the pure module. The Home feed response carries
`rankerVariant` and `experimentKey`; the web forwards them on
`recommendation.served` and `recommendation.clicked`. Home and the AI DJ record
them on `recommendation.generated` (`surface` is `home` or `dj`). Home variants remain labels only. Explicit My Mix sessions use the arms
described above; other variant names retain existing behavior. The bucket
itself is never stored or reported.

**DJ outcomes per variant (#2005).** The `POST /sessions/agent/next` response
now carries `rankerVariant` (and `experimentKey` when an experiment is
configured) on an accepted pick. It comes from the same
`discoveryVariantForUser` assignment the agent runtime records on the DJ's
`recommendation.generated` event (`djPickVariantFields` in
`backend/src/modules/sessions/dj_pick_variant.ts`), so a listener is never
re-bucketed. The field is additive and labels-only. On an accepted pick the web
(`getAgentNextPick`) remembers the variant for that track for 30 minutes in
sessionStorage (`web/src/lib/discoveryAttribution.ts`, mirroring Home's
helper), and the AI DJ page sent it on `agent.next_pick_requested` (retired from the web app in #2243; the backend still accepts and reports it) so DJ
impressions are counted per variant. `playback.started|completed|skipped` and
`library.saved` for that track then forward `surface: "dj"`, `rankerVariant`
and `experimentKey`. If a track has both a Home rail and a DJ attribution, the
more recent one wins, so a play is counted on one surface. Playback endpoints
accept `surface` only as `dj` (anything else is a `400`) and `experimentKey` as
a short label. The report attributes an outcome fact to `dj` when it carries
`surface: "dj"` or belongs to an agent session; DJ rows therefore group by
variant instead of `unattributed` for plays made after this change. The
BigQuery fact query keeps `playback.started|skipped` with `surface = 'dj'`
alongside rail-attributed ones.

**Operator page (#2005).** `/analytics/agent-quality` renders the discovery
sections below the existing AI DJ quality view
(`web/src/app/analytics/agent-quality/DiscoveryQualitySections.tsx`): resonant
discoveries (total, new artists, per active listener), a per-surface table
(impressions, plays, click, skip, save and complete rates; the DJ shows click
as n/a), and the ranker variant comparison (exposures, impressions / plays
sample size, and variant-minus-baseline deltas in percentage points, plus the
API's descriptive-only note). Each section handles its own states: absent or
`unavailable` data says so, no rows says there is no data, and `truncated`
resonant counts or a full 100-row list show a truncation notice. It is an
operator-only page, so there is no `/help` article.

**Limits and remaining work (tracked under #1455).** DJ plays made before this
change, or from a client that predates it, have no variant and stay
`unattributed`. Home and DJ outcome events both forward `rankerVariant` and
`experimentKey`, so outcome rows join the impression rows that carry the key.
Mapping a variant name to a different ranker, and promotion rules,
are later slices.

The baseline signed feedback includes:

- positive signals from completed plays, saves, playlist adds, purchases, agent
  purchases, agent selections, and repeat/replay behavior
- negative signals from inferred short-play skips
- session-intent context from AI DJ intent/session events when available

After enough feedback volume exists, the optional BigQuery ML template can train
a matrix-factorization model and write comparison scores:

```bash
bq query --use_legacy_sql=false \
  --parameter=target_project:STRING:"$GCP_PROJECT_ID" \
  --parameter=target_dataset:STRING:"$ANALYTICS_BIGQUERY_DATASET" \
  --parameter=training_table:STRING:user_track_signal_training \
  --parameter=model_name:STRING:agent_taste_matrix_factorization \
  --parameter=scores_table:STRING:user_track_recommendation_scores_bqml \
  --parameter=model_version:STRING:bqml-matrix-factorization/v1 \
  < workers/analytics-dataflow/sql/agent_taste_intelligence_bqml.sql
```

The ML template writes `user_track_recommendation_scores_bqml` first. Promote
that table to `user_track_recommendation_scores` only after offline evals show
it beats the baseline.

## Offline ML Evaluation

`npm run eval:recommendations` produces deterministic replay results and a
model-comparison artifact:

```text
eval-results/agent-recommendation-model-comparison.json
eval-results/agent-recommendation-model-comparison.md
```

The comparison ranks the same replay candidates with three variants:

| Variant | Purpose |
| --- | --- |
| `deterministic` | Current selector behavior and fallback quality reference. |
| `warehouse_baseline` | Weighted implicit-feedback baseline table. |
| `bqml` | BigQuery ML challenger table, usually `user_track_recommendation_scores_bqml`. |

The artifact tracks precision, acceptance proxy, skip avoidance, listing
coverage, novelty, diversity, explanation coverage, and overall score. BQML is
recommended for promotion only when it beats the warehouse baseline on the
configured deltas and does not regress coverage thresholds. Otherwise the report
returns `blend_or_shadow_test` or `hold_baseline`.

Warehouse-side comparison uses the same no-promotion posture:

```bash
bq query --use_legacy_sql=false \
  --parameter=target_project:STRING:"$GCP_PROJECT_ID" \
  --parameter=target_dataset:STRING:"$ANALYTICS_BIGQUERY_DATASET" \
  --parameter=training_table:STRING:user_track_signal_training \
  --parameter=baseline_scores_table:STRING:user_track_recommendation_scores \
  --parameter=bqml_scores_table:STRING:user_track_recommendation_scores_bqml \
  --parameter=eval_report_table:STRING:agent_taste_bqml_eval_report \
  --parameter=model_version:STRING:bqml-matrix-factorization/v1 \
  --parameter=evaluation_top_k:INT64:10 \
  --parameter=min_acceptance_proxy_delta:FLOAT64:0.02 \
  --parameter=min_skip_avoidance_delta:FLOAT64:0 \
  --parameter=min_overall_score_delta:FLOAT64:0.01 \
  < workers/analytics-dataflow/sql/agent_taste_intelligence_bqml_eval.sql
```

The comparison table reports baseline value, BQML value, delta, winner, and
threshold status per metric. It is intentionally separate from
`user_track_recommendation_scores`; operators must explicitly promote or blend
after reviewing the artifact.

### Discovery ranker recall@k and NDCG@k (#1455)

The BQML comparison above scores warehouse tables. The discovery ranker itself
(`DiscoveryRankingService`) is TypeScript and cannot be reproduced in SQL, so
its offline evaluation is a backend script that reads a bounded export of the
same `user_track_signal_training` table, runs the real ranker, and scores it
with the pure `recallAtK` and `ndcgAtK` in
`backend/src/modules/recommendations/rankingMetrics.ts`.

Per listener the script holds out the last 30% of their positive tracks by
time, learns genre weights from the earlier signals, ranks the candidate pool
(the catalog tracks seen in the sample, minus tracks already in the listener's
history), and reports recall@k (binary) and NDCG@k (graded by summed positive
signal weight) for the discovery ranker, a popularity baseline and a seeded
random floor. Only the learned-genre signal is reproducible offline, and the
pool is the sample, so the numbers are sampled-ranking metrics: compare
rankers on the same sample, do not read them as production recall.

```bash
# 1. Export a bounded, recent sample of the training table.
bq query --use_legacy_sql=false --format=json --max_rows=200000 \
  "SELECT user_id, track_id, signal_weight, occurred_at
   FROM \`$GCP_PROJECT_ID.$ANALYTICS_BIGQUERY_DATASET.user_track_signal_training\`
   WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
   ORDER BY occurred_at DESC LIMIT 200000" > signals.json

# 2. Evaluate against a catalog database (DATABASE_URL), read-only.
cd backend
npx ts-node --transpile-only scripts/eval_discovery_ranker.ts \
  --signals ../signals.json --k 10 --holdout 0.3 --max-users 500 \
  --out eval-results/discovery-ranker-eval.json
```

The export holds pseudonymous ids: keep it local and out of version control.
The pure parts (`splitSignalsByTime`, `evaluateRanker`) are unit-tested in
`backend/src/tests/discovery_offline_eval.spec.ts`.

## BigQuery AI/ML Follow-Up

Useful next warehouse jobs:

- Generate text and metadata embeddings for tracks with BigQuery
  `AI.GENERATE_EMBEDDING`, then use BigQuery vector search for semantic
  similarity candidate expansion.
- Use the offline comparison artifacts to tune or blend the BigQuery ML matrix
  factorization recommender before promoting `ML.RECOMMEND` output into
  `user_track_recommendation_scores`.
- Use structured Gemini extraction through BigQuery AI for normalized mood,
  instrumentation, remix suitability, and lyrical/theme tags where source data
  exists.
- Promote richer track intelligence into `agentAudioFeatures` after the
  extraction quality is validated.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `AGENT_TASTE_SIGNAL_SOURCE` | Set to `bigquery` to enable warehouse-backed taste scores. Defaults to disabled. |
| `AGENT_TASTE_BIGQUERY_PROJECT_ID` | Optional BigQuery project override for agent taste scores. |
| `AGENT_TASTE_BIGQUERY_DATASET` | Optional BigQuery dataset override. Falls back to analytics warehouse/reporting dataset config. |
| `AGENT_TASTE_BIGQUERY_CLEAN_TABLE` | Clean analytics events table used by the materialization runner. Defaults to `events_clean`. |
| `AGENT_TASTE_BIGQUERY_TRAINING_TABLE` | Training signal table used by verification. Defaults to `user_track_signal_training`. |
| `AGENT_TASTE_BIGQUERY_SCORES_TABLE` | Optional scores table id. Defaults to `user_track_recommendation_scores`. |
| `AGENT_TASTE_MATERIALIZATION_PROJECT_ID` | Optional project override used only by the warehouse materialization runner. |
| `AGENT_TASTE_MATERIALIZATION_VERSION` | Optional version label written to materialized score rows. |
| `AGENT_TASTE_BIGQUERY_MAXIMUM_BYTES_BILLED` | Query cost guard. Defaults lower than dashboard reporting because serving queries are bounded. |
| `AGENT_TASTE_BIGQUERY_QUERY_TIMEOUT_MS` | Query timeout. Defaults to `5000`. |
| `AGENT_TASTE_BIGQUERY_ROW_LIMIT` | Maximum score rows returned per selector call. Defaults to `100`. |
| `AGENT_TASTE_BIGQUERY_API_BASE_URL` | Optional BigQuery API base URL override for tests or private endpoints. |
| `DISCOVERY_RANKER_EXPERIMENT` | Optional ranker variant / holdout experiment, `<key>:<variant>=<pct>,...` (#1455). Unset means everyone is `baseline`. `hybrid_rrf_v1` enables hybrid retrieval for its bucket (#2242). |
| `AGENT_RETRIEVAL_BUDGETS` | Hybrid retrieval candidate budgets, `keyword=20,semantic=20,audio_range=20,lane=20,seed=20,trending=20` (#2242, #2246). |
| `AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT` | Share of the fused candidates that only the trending source may fill; default `20`, `0` = off (#2246). |
| `AGENT_RETRIEVAL_TIMEOUT_MS` | Latency budget of the hybrid retrieval step; default `5000` (#2242). When every source overruns it or errors, the pick falls back to the default retrieval. |
| `AGENT_RETRIEVAL_MAX_CANDIDATES` | Cap on the fused candidate list; default `150` (#2242). |

## Verification

- Unit tests cover disabled fallback, bounded BigQuery query construction,
  clamped scores, and BigQuery failure fallback in
  `backend/src/tests/agent_bigquery_taste_signal.spec.ts`.
- Selector tests cover `bigquery_taste_score` blending without replacing
  deterministic ranking in `backend/src/tests/agent_learning.spec.ts`.
- Offline recommendation eval tests cover deterministic replay artifacts and
  BigQuery ML versus warehouse-baseline promotion decisions in
  `backend/src/tests/agent_recommendation_eval.spec.ts`.
- SQL contract tests cover parameterized materialization, required serving
  columns, expected signal families, BQML comparison output, and runner help output in
  `workers/analytics-dataflow/test_agent_taste_sql.py`.
- Discovery measurement (#1455) is covered by `rankingMetrics.spec.ts`,
  `discovery_experiment.spec.ts`, `analytics_discovery_quality.spec.ts`,
  `analytics_playback_attribution.spec.ts`, `discovery_offline_eval.spec.ts`,
  `dj_pick_variant.spec.ts` (#2005), the quality-route and playback-attribution
  cases in `analytics.controller.http.spec.ts`,
  `discovery_journal_aggregate.integration.spec.ts`, and the web
  `homeAttribution.test.ts`, `homeRecommendationEvents.test.ts`,
  `discoveryAttribution.test.ts` and `DiscoveryQualitySections.test.tsx`.
- Warehouse verification queries live in
  `workers/analytics-dataflow/sql/agent_taste_intelligence_verification.sql` and
  report freshness, coverage, signal mix, and intent-context coverage.
- Dataform orchestration templates and assertions live in
  `workers/analytics-dataflow/dataform/`.
- Feature work that changes the serving table contract must update this page,
  `docs/features/README.md`, and `docs/deployment/environment.md`.

## "Now & Up next" replaces Next AI Pick (#2243)

Vision-neutral quality (ADR-BM-6): no money, payout or fee change. Phase 2
(C2) of `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`.

- `AgentNextPickCard` and its "Next Pick" button are deleted. The button played
  a new pick at once and replaced the queue, which the DJ continuation already
  does on its own, and its idle state was a disabled button. The AI DJ section
  now shows `AgentUpNextCard` (`web/src/components/agent/`): the playing DJ
  track and the next three DJ picks from the player queue (listener-queued
  tracks are not listed), each with artwork, credited artist and one plain
  reason. Idle: one line pointing to the prompt, no button. The score,
  audio-feature and runtime strings are gone.
- **Reasons.** The first sentence of the pick's `explanation` (the shared
  discovery vocabulary, `discovery-explanations.ts`), never the model's free
  `reason`; "Catalog candidate" is not shown. The web remembers it per pick in
  the DJ set (`DjSet.picks`, sessionStorage-mirrored, `web/src/lib/agentDjSet.ts`)
  as picks arrive from a next-pick response (re-plan, continuation, actions).
  A session's first picks arrive through Session History: each pick is stored
  with a bounded note (#2299, the `AgentPickNote` table, one row per pick-log
  `License`, written in the same transaction as the `License` by session start
  and by next-pick; no AgentSignal) of at most two explanation sentences
  (120 characters each, only sentences of the shared vocabulary, so a model's
  free text and a cohort's name are never stored), the reason code, `curatedBy`
  and `requestMatch`. `GET /agents/config/history` returns it as
  `license.recommendation` (`recommendation.explanation`, `curatedBy`) until the
  listener plays the track and a real signal's own fields replace them. The note
  is database state, so the reason shows from any backend instance and after a
  restart; the old per-instance in-memory cache is gone. It lives and dies with
  the `License` (cascade) and is deleted by account erasure and included in the
  personal-data export. Only picks recorded before #2299 have no note, and show
  no reason line. One caption names who chose
  the picks: "Picked by the AI curator" only for an LLM pick that did not fall
  back, otherwise "Picked from your filters" (#2075 rule kept); picks with no
  note read "Picked for this session".
- **Skip** is the player's skip (which records the usual `skipped` playback
  event when analytics consent allows).
- **Not this** writes the existing agent `skip` signal
  (`POST /agents/config/signals`, `recordAgentSignal`; the server enforces the
  playback-training consent), removes the track from the player queue and the
  DJ set (on the playing track it advances the player instead, so that track
  also gets the player's own skip), and requests a refill with the set's
  filters. Every pick is already logged on the session and sent back as
  `recentTrackIds`, so the DJ never offers the track again in that session
  (`agent_up_next_seed.integration.spec.ts`); the web additionally filters
  rejected ids out of its refill.
- **More like this** sends `seedTrackId` on the next-pick request
  (`AgentNextPreferences.seedTrackId`). The sessions service honours it only
  for a track the session already picked, passes it to the runtime for that
  request only (never merged into the session's remembered preferences, never
  published), and the selector adds the seed's stored-embedding neighbours as a
  second semantic source beside the session description
  (`catalog.semantic_search` with `seedTrackId`: stored vector, the same
  `AGENT_SEMANTIC_MIN_SIMILARITY` floor, explicit and AI-promotion filters, the
  seed excluded; no embedding-model call). The curator runtimes force the seed
  onto their semantic searches. The web swaps the not-yet-played DJ picks for
  the neighbours and keeps the seed queued. #2244 generalizes seeds later.
- **Update session with nothing playing.** The Next Pick button was also the way
  to start picks when a live session had none in the player (for example the
  first picks could not play). The prompt's explicit **Update session** now
  does that: with no DJ set for the open session it asks the DJ with the edited
  filters (My Mix included), starts playing the picks, or, when nothing fits,
  says why and shows the "My Mix availability" status on the Now & Up next
  card. Filter edits alone still do nothing until then.
- **Limits.** `POST /sessions/agent/next` is throttled to 30 per minute per
  user. The buttons are disabled while one action is in flight; a 429 shows a
  calm note and the queue keeps playing.
- **Analytics.** `agent.up_next_action` is the per-click event:
  `{ surface, action: skip | not_this | more_like_this, trackId, intent?,
  added? }`, ids only, sent through `recordProductAnalytics` (consent gated),
  subject `agent_session`. `agent.next_pick_requested` keeps its DJ-impression
  meaning with an unchanged payload (`status`, `trackId`, `runtimeStatus`,
  `score`, `intent`, `intentName`, `rankerVariant`, `experimentKey`): the web
  sends it whenever the AI DJ adds picks to the queue after a Not this refill
  or a More like this, so ranker-variant metrics (#2005, #2242) stay comparable.
- The User Guide AI DJ article describes the card; its screenshot is not
  refreshed in this slice.

## Seeded sessions: start from a track, an artist or a playlist (#2244)

Vision-neutral quality (ADR-BM-6): no money, payout or fee change; stored
vectors only, no model call and no external cost. Phase 2 (B3) of
`docs/roadmap/2026-10-ai-dj-quality-and-experience.md`. Builds on hybrid
retrieval (#2242) and the "More like this" seed (#2243).

- **Entry points.** "Start a DJ session from this" on a track (the release
  page track menu), on an artist page and on the listener's own playlist page
  (server playlists only; a local-only playlist has nothing the server can
  read). Each queues the seed in the tab (`web/src/lib/djSeed.ts`, sessionStorage,
  one use) and opens Home's `#ai-dj`; the prompt shows a removable
  **From: <label>** chip. The listener still presses Start session (no
  autoplay surprise). Removing the chip drops the seed; with a live session the
  upcoming picks follow, like any chip edit. A seed replaces My Mix.
- **Session-level seed.** `preferences.seed = { kind: "track" | "artist" |
  "playlist", id, label }` (class-validator DTO `SessionSeedDto`; the
  `/agents/config/session` start route validates inline). Unlike `seedTrackId`
  it is **remembered for the live session** in memory with the other session
  preferences, so every pick keeps it; the web also resends it with each pick,
  and an explicit `seed: null` removes it. The server resolves it first
  (`agent_session_seed_resolver.ts`): the subject must exist (400
  `seed_not_found`), a malformed seed is 400 `seed_invalid`, and the **label is
  replaced by the catalog's own** (track title, artist display name, playlist
  name), never trusted from the client. A seed equal to the one the session
  already holds is not looked up again.
- **Privacy.** A playlist seeds only when the caller **owns it or it is
  public**. Otherwise (someone else's private playlist, or no such playlist,
  answered identically so ids cannot be probed) the request is refused with 403
  `seed_playlist_forbidden`, before anything is written or remembered. The
  playlist source (`catalog.playlist_seed`) checks access again on **every
  retrieval** for the session's user, so a playlist that goes private mid-session
  stops seeding (it fails open: the session carries on unseeded, logged with the
  reason code `playlist_not_accessible`). The seed's id is never published: the
  `session.started` event carries `seedKind` only.
- **How each kind retrieves** (all through the existing `seed` source and its
  budget, `AGENT_RETRIEVAL_BUDGETS` `seed=`; the default path adds the same
  candidates to its union). Every kind keeps the explicit preference, the
  AI-promotion filter (ADR-BM-5), the session exclusions, the six ranking rules
  and the taste policy.
  - *Track:* the neighbours of its stored vector (`catalog.semantic_search`
    with `seedTrackId`); the seed itself is excluded.
  - *Artist:* `catalog.artist_seed` with the artist's display name: their own
    tracks, then the neighbours of the centroid of their stored vectors.
  - *Playlist:* the neighbours of the centroid of the playlist's stored vectors
    (`unitCentroid`, over its most recent 40 tracks), **plus its genre-family
    mix** (tracks of its two most common families from stored descriptors, else
    release-genre families; ranked by similarity to the centroid when vectors
    exist), **plus at most 3 of the playlist's own tracks** (the nearest its
    centroid). A playlist with no stored vectors seeds from the family mix alone.
- **Not a replay.** `PLAYLIST_SEED_OWN_TRACKS = 3` (`tool_registry.ts`): the
  source offers at most three of the playlist's own tracks, and the selector
  removes every other track of the playlist from the candidate pool, whichever
  source found it, so a batch holds at most three of them. The other
  candidates are neighbours and family-mix tracks the playlist does not hold.
- **Session History.** The stored filters snapshot gains `seed: { kind, label }`
  (never an id); the card reads "From playlist: <label>". Kept in step on a
  mid-session change or removal.
- **Analytics.** `agent.session_started` gains `seedKind` (`track`, `artist`,
  `playlist`; no id, no label).
- **Evidence.** `agent_dj_seeded_sessions.integration.spec.ts` (Postgres/pgvector,
  hash embedder over a purpose-built fixture catalog): neighbours, the family
  mix, the cap on own tracks, exclusions, explicit and AI filters, the
  access rule (own, public, private of another listener, missing, anonymous),
  each seed kind through the selector on both retrieval paths, and the session
  plumbing (remembered, cleared with `null`, history, published event, refused
  seed writes nothing). `agent_session_seed.spec.ts` covers the pure parts and
  the pool cap with stubbed tools. The golden runners keep embeddings off by
  design, so the seeded cases live in that integration spec rather than in the
  recall@k table; the table is unchanged.
- **Not in this slice.** The LLM curator prompts do not receive the seed
  (the rule-based top-up that completes every LLM batch does, so a seeded
  session is still seeded); entry points on a public playlist page and on the
  player's action panel; a real-embedding measurement of how close the
  neighbours are.

## Trending as a source (#2246)

Vision-neutral quality (ADR-BM-6): no money, fee or payout change. Popularity is
an engagement signal and never a payout input (ADR-BM-4); ranking is never for
sale (ADR-TE-2): `hasListing` is not read by this source and trending adds no
ranking score. Phase 2 of `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`.
Sprint 39 decision (delegated authority, overridable): trending is a capped
retrieval source, not a ranking boost.

- **What it is.** The sixth `hybrid_rrf_v1` retrieval source (`trending`), so
  it exists only on the hybrid path. The default retrieval path is unchanged:
  making it apply there too would mean a second fusion/cap mechanism, which this
  slice deliberately does not add. Under the variant it runs in parallel with
  the other sources, under the same deadline, and fails open (an error or
  timeout removes only its own candidates).
- **Which families.** With no request, the listener's top genre families by
  positive learned taste (`familyTasteWeights`, the same weights Sounds uses; at
  most 2). No positive taste, no families, no trending: catalog popularity alone
  is not the listener's taste. A family the listener hid is skipped. With a
  request that names genres, the families those genres name (so "World" asks for
  World). A seed-only request has none: the seed steers it. A mood- or
  energy-only request uses the listener's top families.
- **Where the data comes from.** `DiscoveryPopularityService.getTrendingForGenreTerms`
  (`catalog.trending` tool): the same per-genre `getTrendingTracks` read that
  feeds Home's "Trending in <genre>" rail, over the serving tables
  (`TrackPopularity`) only, Redis-fronted. No warehouse scan. The serving table
  is keyed by free-text release genre, so a family is read as the genre keys it
  matches (World reads "African", "Afrobeats", ...), at most 6 keys per family,
  merged by score. The 7-day window is used.
- **Minimum audience, low data.** Rows below `DISCOVERY_MIN_AUDIENCE` unique
  listeners, or older than `DISCOVERY_POPULARITY_SNAPSHOT_MAX_AGE_MINUTES`, are
  never served. When nothing qualifies the source contributes nothing (status
  `ok`, 0 candidates in `retrieval.sources[]`). Recency is never a fallback.
- **The cap.** Tracks only trending found fill at most
  `AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT` (default **20**, `0` = off, max 50)
  of the kept candidate list (`capSourceShare`): with 8 other candidates, 2; with
  none, 0. A track another source also found is that source's own find and is
  neither counted nor cut. What the cap cut is reported as
  `retrieval.capped.trending`; what trending added is `retrieval.onlyFrom.trending`.
  The candidate budget (`trending=` in `AGENT_RETRIEVAL_BUDGETS`, default 20)
  bounds the read before fusion.
- **A request is never displaced.** For a session that asked for something, the
  source only contributes tracks the shared request predicate puts in tier A or B
  (`admitTrendingTrack`, built on `requestTierOf` from #2316), so an off-request
  popular track never enters, not even with "Fill with similar sounds" on:
  padding is the keyword path's job. Tiers still sort A before B before C and
  taste only orders inside a tier, so an on-request trending track adds to the
  matches and cannot push one out of the candidate list. The explicit
  preference, hidden taste and the AI-promotion filter apply as for every
  source (`loadCandidateTracks`).
- **Explanation.** A track trending found says "Trending in <family> this week"
  (`trendingExplanation`, `discovery-explanations.ts`: a closed family label,
  never free text), added to the pick's explanation and whitelisted in the pick
  note vocabulary (`agent_pick_notes.ts`) so Session History and Up next show
  it. No new reason code: ranking still decides why a pick fits, and the
  generic "Catalog candidate" line is dropped when trending explains the pick.
- **Evidence.** `agent_trending_source.spec.ts` (the cap, family choice, tier A/B
  gate, low data, hybrid-only, vocabulary) and
  `agent_trending_source.integration.spec.ts` (Postgres: serving rows through the
  real tools; an off-request chart-topper never enters a World session, with or
  without padding; request matches all stay; the cap; minimum audience; stale
  rows). The golden recall tables are unchanged: the golden catalog has no
  popularity rows, so the source is unavailable there, and the Docker-free twin
  reports it unavailable too.
- **Not in this slice.** Trending on the default (non-hybrid) path; a
  per-listener tuning of the share; a trending reason code with its own
  localized copy; promoting the variant.

## Player queue identity (#2312)

Vision-neutral UX (ADR-BM-6): no money, fee or payout change; presentation of
data the DJ already produces.

- **What `/player` shows.** While the live DJ set (`web/src/lib/agentDjSet.ts`)
  has at least one track in the queue, the Queue Manifest gets a header strip
  (`PlayerDjQueueHeader`): a small DJ orb with a live dot (still under
  `prefers-reduced-motion`), "AI DJ", a one-line request summary and a **Steer**
  link to `/#ai-dj` (the Now & Up next card on Home). Each queued track that
  belongs to the set (`catalogTrackId || id`, the same membership test playback
  attribution uses) gets a DJ glyph whose accessible name and hover text are
  "Picked by your AI DJ: <reason>" (the server-authored sentence the Up next
  card shows; no reason, no suffix). Stopping the session clears the set, which
  removes the header and the marks; so does a queue that no longer holds any of
  the set's tracks.
- **Request summary, never the sentence.** `describeDjSetRequest`
  (`web/src/lib/agentDjRequestSummary.ts`) reads the set's stored preferences
  only: the seed ("From <label>"), else the request's genres, moods, energy and
  tempo, else the session's genres, mood and energy, else the session intent,
  else "Live session"; capped at 60 characters. `requestText` is stripped
  before the set is stored and is ignored by the helper, so no typed sentence is
  stored client-side or shown.
- **`requestMatch` on each pick.** Each track of the next-pick response
  (`POST /sessions/agent/next`, `tracks[]`) gains an optional
  `requestMatch: boolean`: true when the pick satisfies **every** filter the
  session's request sets (genres, including genre-family and stored descriptor
  family matches such as "African" for a "World" request; moods; energy band;
  measured tempo only), false when it misses at least one, and **absent when
  the request has no filters**. Since #2316 (see "Request-first selection") the
  flag means "the pick belongs to the request": true for tier A and B picks, false
  only for a marked pad the listener allowed with "Fill with similar sounds"; the
  coverage gaps still report a missed soft filter. The predicates are the ones request coverage
  counts: `pickMatchesRequest` and `computeRequestCoverage` in
  `agent_session_request.ts` share one per-filter predicate set, so the flag and
  the coverage line cannot disagree (a parity test checks the counts). It is
  computed in the LLM path's policy step and in the rule-based orchestrator
  (`requestMatch` on the pick record), and passes through
  `normalizeAgentRuntimeResult` and `SessionsService.toAgentNextResponse`.
  The rule-based path's coverage facts now include the track's descriptor
  families, as the LLM path's already did, so both paths read the same facts.
- **"Outside your request".** The web keeps the flag on the pick note
  (`DjPickNote.matched`, sessionStorage-mirrored with the other notes); a row
  with `matched === false` shows a muted "Outside your request" mark ("Your AI
  DJ added this to fill the set; it doesn't match your request's filters."),
  making the padding visible. Since #2316 it appears only when the listener turned
  on "Fill with similar sounds" (otherwise the DJ returns a shorter set); the hint
  now says so. No flag, no mark.
- **Help and screenshot.** The User Guide's "Playing music & the Now Playing
  console" article has a "When your queue is an AI DJ set" section and the AI
  DJ article points to it; `player.png` is captured with a mock DJ set
  (`web/scripts/capture-help-screenshots.mjs`).
- **The first batch too.** The session's first picks reach the web through
  Session History, so each pick's stored note (`AgentPickNote`, #2299; shaped
  by `agent_pick_notes.ts`) also keeps `requestMatch` (only when boolean; null
  when the session had no filters), and `historyRecommendation` exposes it on
  the history `recommendation` next to the explanation and `curatedBy`.
  `pickNotesFromLicenses` turns it into `DjPickNote.matched`, so the first rows
  can show "Outside your request" as well. The note is persisted, so the mark
  survives a server restart and a poll on another instance, and it stays after
  the listener plays the pick (the recorded signal has no flag, so the note's
  survives). Only a pick recorded before #2299 shows no mark.

## In-session steering (#2247)

Vision-neutral quality (ADR-BM-6): no fee, split, price or payout is read or
changed, popularity stays out of payouts (ADR-BM-4), and nothing new is stored.
Phase 2 of `docs/roadmap/2026-10-ai-dj-quality-and-experience.md`. What the
listener does during a live AI DJ session now nudges that session's next picks.

- **Signal.** A session-scoped ranking term (`session_steering`,
  `recommendations/session_steering.ts`, pure) of at most **+-15 points**.
  Completes and saves count +; skips count -. "Not this" writes the existing
  `skip` signal (#2243), so it and the player's own skip are the same input.
  `accept`, `replay`, `loop`, `unsave`, `add_to_playlist` and `purchase` do not
  steer. A track counts once per direction (finished and saved is one +).
- **Matching.** An event matches a candidate by **genre family** (5 points,
  from the release genre and the stored descriptor; narrow families win over
  broad ones such as World, so one Afrobeats skip does not lean on all of World;
  a genre no family knows is matched on its own label) and by **credited
  artist** (5 points, the same key as the per-artist cap, so a track with no
  credit matches nobody). One fresh event contributes up to 10 points; the sum
  over events is bounded to +-15 and rounded away from zero.
- **Decay.** Each event **halves after 4 further picks** (`0.5 ^ (picks / 4)`).
  Picks are counted from the session's `AgentPickNote` rows (one per pick,
  `createdAt`) made after the event. A refill that picked 12 tracks therefore
  leaves earlier events at an eighth; a session whose picks carry no note (before
  #2299) does not decay.
- **Nothing is persisted.** The events are read from this session's existing
  `AgentSignal` rows by `DiscoveryPolicyContextService.sessionSteering`: rows
  with the session id (the explicit "Not this" skip) or `metadata.agentSessionId`
  equal to it (playback signals mirrored by analytics never fill the column), at
  most 120 rows and 40 events, listener-scoped. A listener who switched off
  playback learning has no such rows, so the session is not steered (the web
  still removes a rejected track and never re-offers it). A read failure is
  logged as a degraded fallback (`session_steering`) and the pick is ranked as
  before.
- **Inside a tier, never across one.** The term is part of the score, and
  request-first selection (#2316) chooses tier first and score second, so it
  reorders tracks of one tier (A, B or C) and cannot lift a tier C track over a
  tier A track, or sink a tier A one under C, at the full bound. Exploration,
  the per-artist cap and My Mix lane quotas are unchanged. A session with no
  request orders by the same score, so there the term reorders the whole pool.
- **Explanation, only when it changes a pick.** After the policy step the selector
  runs the same pipeline once without the term (only when some candidate was
  steered) and compares batches. A pick that is in the batch only because of the
  term gets "Less like the tracks you skipped" (it took the place of a demoted
  track) or "More like what you saved" (its own points are positive); a pick the
  term lifted to an earlier place with positive points also gets "More like what
  you saved". A demoted pick, or one that only shifted a place, gets no sentence.
  The sentence is first in the pick's explanation, so the Now & Up next card,
  the player mark and Session History show it, and it is in the shared
  vocabulary (`DISCOVERY_EXPLANATION_VARIANTS.steered_away` and `steered_toward`),
  so the persisted pick note keeps it (`agent_pick_notes.ts` takes every variant).
  The primary `reasonCode` is unchanged and the sentence names no track.
- **Wiring.** `sessionId` on `AgentSelectorInput`, set from the orchestrator's
  session by `deterministicSelectorInput` (the rule-based path) and by the LLM
  runtime's top-up and discovery swap. Home, the plain DJ, offline evaluation and
  the golden set pass no session, so their scores are unchanged (a test pins that
  the session link of a signal changes nothing on Home).
- **Limits.** The LLM curator keeps the model's own order for its picks (only the
  rule-based fill-ins are steered, and the model sees the session's recent tracks
  as before); a track both skipped and saved in one session nets out. Nothing is
  tuned against production traffic: the 5-point steps, the +-15 bound and the
  4-pick half-life are the Sprint 39 decision on #2247.
- **Tests.** `session_steering.spec.ts` (bound, decay, family and artist matching,
  de-duplication, Home unchanged, never crosses tiers, sentences in the pick
  note), `agent_session_steering.integration.spec.ts` (real `AgentSignal` rows:
  three skips of a genre shift the next picks away in the same session, saves lift,
  a mirrored playback signal counts, another session or listener does not, decay
  from pick notes, a tier is never crossed, a read failure keeps the pick, Home
  ranks the same). The golden set (`agent_golden_eval.spec.ts`,
  `agent_dj_retrieval_golden.integration.spec.ts`) passes no session and is
  unchanged.
