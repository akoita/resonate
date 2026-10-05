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
> activity, Next AI Pick and session history; signed out they see the presets
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
> live feed and as `requestCoverage` on Next AI Pick, which requested filters
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
> Mood presets use the shared upload vocabulary: Pulse Raid (Trap, Drum &
> Bass, EDM), Liquid Sky (Soul, Jazz, Trip-Hop; Chill mood), Static Calm
> (Ambient, New Age, Classical), and Neural Flow (Lo-Fi). The upload options
> live in `web/src/lib/catalogVocabulary.ts`; preset tests check that every
> genre and mood belongs to that vocabulary.

> **Next AI Pick keeps going on a small catalog (#2056).** Vision-neutral
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
> `AGENT_TRACK_LIMIT` tracks (default 5), and when the player reaches the last
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
  (seed-track neighbours), golden-eval cases for World → African and
  Rap → explicit rap, and tuning the similarity floor against real embeddings.
- Tests: `genre_families.spec.ts`, `agent_semantic_selector.spec.ts`,
  `agent_curator_session_controls.spec.ts`, `agent_explicit_preference.spec.ts`,
  `agent_semantic_retrieval.integration.spec.ts`,
  `agent_config_allow_explicit.integration.spec.ts`,
  `sessions.integration.spec.ts`, `discovery_ranking_session_request.spec.ts`,
  `agent_session_request.spec.ts`.

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
(default 5), but the same R&B & Soul request returned 2 tracks, then 5 twenty
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
  as before. The DJ does not write to the served history.
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

**AI DJ link.** The Sonic Radar banner on the AI DJ panel
(`web/src/components/agent/AgentSessionPanel.tsx`) reads the same journal
instead of counting every track the DJ served, so it never promises tracks
Sonic Radar will not show. It shows how many tracks resonated in the window
(and new artists this week); when none did, how many played-through tracks are
one save away; and otherwise how a track gets into Sonic Radar. The copy
helpers live in `web/src/lib/sonicRadarSummary.ts`.

**New from artists you discovered.** At the top of the page, a section lists
`newFromDiscovered[]` with Play and Save on each card; "Almost there" cards
also get Play, since a replay makes a track resonate too. Play queues the
catalog stream without adding the track to the library. The AI DJ banner adds
the count of new tracks from discovered artists. Notifications or digests for
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
helper), and the AI DJ page sends it on `agent.next_pick_requested` so DJ
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
| `DISCOVERY_RANKER_EXPERIMENT` | Optional ranker variant / holdout experiment, `<key>:<variant>=<pct>,...` (#1455). Unset means everyone is `baseline`. |

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
