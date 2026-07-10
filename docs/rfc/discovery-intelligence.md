# RFC: Discovery Intelligence — analytics-backed recommendations, trending & top artists across Home and AI DJ

- **Status:** proposed
- **Date:** 2026-07-10
- **Owner:** platform
- **Tracking epic:** [#1447](https://github.com/akoita/resonate/issues/1447) (children #1448–#1456)
- **Extends:** epic [#977](https://github.com/akoita/resonate/issues/977) (Analytics-powered AI DJ taste intelligence — all six children shipped)
- **Related docs:** `docs/features/agent_taste_intelligence.md`, `docs/features/mood_vibe_discovery.md`, `docs/features/analytics_event_ledger.md`, `docs/architecture/agent_learning_loop.md`, `docs/rfc/business-model.md`
- **Revenue line & phase (required statement):** serves **Line 4 — Listener Pro** (discovery quality is the Listener Pro differentiator per `docs/strategy/issue-triage-2026-07.md`) and amplifies **Line 3 — marketplace take-rate** (better picks → more AI DJ stem purchases). The signal/warehouse groundwork is vision-neutral infra. Per ADR-BM-6, Listener Pro activates at phase 4; this RFC sequences foundation work now and ML activation to be ready before that gate.

## 1. Problem — the audit

Resonate's most visible discovery surfaces are not backed by the analytics and
learning machinery the platform already has. Three surfaces, audited 2026-07-10:

### 1.1 Home "Recommended for You" (`GET /recommendations/:userId`)

`backend/src/modules/recommendations/recommendations.service.ts:51-196` is a
hand-rolled substring scorer, not a recommender:

- Candidate pool = the **50 newest published tracks** (`take: 50, orderBy createdAt desc`, L68-88). Nothing older is ever recommendable.
- Scoring = additive keyword matches: genre substring +50, mood substring +35, "has any genre" +5, cohort hint +12, recently-served −100 (L91-142). No play counts, no behavioral signals, no popularity, no similarity.
- Preferences and recently-served state live in **in-memory per-process Maps** (L22-24) — lost on restart, wrong under multi-instance Cloud Run.
- With no preferences the strategy is literally `recent_first` (newest tracks). The UI's "Catalog signal" badge (`web/src/app/page.tsx:1484`) is the code admitting it had **no personalization reason at all**; the frontend additionally falls back to "first 4 catalog releases" when the API returns nothing (L1460-1470).
- The `energy` param is accepted and ignored. There is no caching.

### 1.2 Home "Top Artists" (Pioneer Network) and "Trending"

- "Top Artists" = credited artists of the **48 most recently published releases, sorted by newest release date, first 8** (`web/src/app/page.tsx:418-423`, `web/src/lib/catalogDisplay.ts:137-183`). No plays, no engagement, no followers. The displayed names are seed data.
- No per-genre/per-category top-artists capability exists anywhere (no backend endpoint, no query).
- The "trending" rail is a client-side recency filter over the same 48 releases.

### 1.3 AI DJ — the real engine, disconnected and half-lit

The AI DJ (`backend/src/modules/agents/*`) is genuinely implemented:

- **Learning loop is real and DB-backed:** every accept/skip/complete/save/replay/playlist-add/purchase writes an `AgentSignal` row with calibrated weights (accept 1, skip −1, complete 1.5, save 3, replay 2, playlist-add 3, purchase 5 — `agent_learning.service.ts:6-14`); taste profiles are computed from up to 500 signals and persisted to `AgentConfig.learnedTasteProfile` (L346, L387).
- **Selector is a real multi-signal ranker** (`agent_selector.service.ts:196-322`): taste match, learned genre weights, embedding similarity, warehouse taste score, cohort context, energy match, recency penalty.
- **Optional LLM curation** via Google ADK/Gemini with deterministic fallback; **real ERC-4337 on-chain stem purchases**; flag-gated ERC-8004 identity.

But:

- The home feed **does not use any of it** — two disconnected code paths share only the taste-memory hide/downrank multipliers.
- The selector's best inputs are **dormant by default**: BigQuery taste scores only when `ANALYTICS_REPORT_SOURCE=bigquery`; the "embeddings" are a **16-dim hashed bag-of-words placeholder** (`embeddings/embedding.service.ts:4-31`), not a learned model; the Gemini reranker is opt-in and off.
- Signal capture has holes: **no explicit skip event** (skip is derived as completionRatio < 0.3); analytics auto-mirrors only `library.saved` and `playlist.track_added` into `AgentSignal` (`analytics_instrumentation.service.ts:253-256`) — plays/completions/skips reach the learning loop only if a client explicitly POSTs them; home recommendation impressions/clicks are not captured at all.

### 1.4 Why this matters

Discovery is the product's front door and the Listener Pro differentiator. A
"Recommended for You" that shows two tracks by the same artist labeled "Catalog
signal", and a "Top Artists" rail ranked by upload recency, undercut the
platform's credibility with exactly the users it needs to convert. Meanwhile
~80% of the hard infrastructure for a real recommender already exists and is
idle.

## 2. What already exists (substrate inventory)

The #977 epic delivered an end-to-end path that this RFC lights up and extends:

| Layer | Asset | State |
| --- | --- | --- |
| Event capture | Analytics envelope + catalog (`playback.started/heartbeat/completed`, `library.saved`, `playlist.track_added`, `search.*`, `commerce.settled`, `agent.*`, `recommendation.generated`) with privacy tiers, consent, geo | **Live** |
| Event transport | Postgres append-only ledger + Pub/Sub topic + DLQ | **Live** |
| Warehouse | Dataflow Flex Template (Beam) → BigQuery `events_raw/clean/facts/views/quarantine`, day-partitioned, deduped | **Live (staging)** |
| Feature/scores marts | Dataform `track_intelligence_features`, `user_track_signal_training`, `user_track_recommendation_scores` + assertions; **BQML matrix-factorization template** (`user_track_recommendation_scores_bqml` + eval) | **Built, template-stage** |
| Serving read | `AgentBigQueryTasteSignalService` reads `user_track_recommendation_scores` (bounded, consent-gated) | **Built, off by default** |
| Behavioral store | `AgentSignal` (weighted actions) + `learnedTasteProfile` | **Live** |
| Vector store | pgvector installed, `TrackEmbedding vector(16)` | **Placeholder embeddings** |
| Cache | Memorystore Redis (allkeys-lru) | **Provisioned, unused for discovery** |
| ML platform | `roles/aiplatform.user` already granted to the Cloud Run SA (Vertex/Gemini callable); no Vertex resources provisioned | **Greenfield** |
| Quality metrics | Agent recommendation quality dashboard (`GET /analytics/agent/quality`) | **Live (DJ only)** |

## 3. How leading services structure this (benchmark)

Spotify/YouTube-Music-class recommenders share a four-stage shape; the point is
the shape, not the exact models:

1. **Candidate generation** from several independent sources: collaborative filtering ("users like you played…"), content similarity (embeddings — audio + metadata), popularity/trending (windowed, decayed), freshness (new releases), and social/curatorial signals. Each source is cheap and recall-oriented.
2. **Ranking** — one model scores the merged candidates with user features (taste vector, recent history), item features (audio/metadata/popularity), and context (time, device, session intent).
3. **Re-ranking / policy** — diversity (artist/genre caps), exploration slice (a controlled % of fresh/low-data items to escape feedback loops), business rules, impression rotation, explanations.
4. **Feedback loop** — implicit signals (completion, skip-within-30s, save, replay, add, purchase) flow back with clear positive/negative labels; offline eval (recall@k/NDCG) gates model promotion; online metrics (skip rate, save rate, session length) decide winners.

Cold-start is handled by stages 1's content and popularity sources — a new
track with zero plays is recommendable via embedding similarity; a new user
gets popularity + onboarding preferences until signals accumulate.

Resonate can match this shape with what it has: BQML/Dataform for stage-1 CF +
popularity, real embeddings for stage-1 content similarity, the existing
selector generalized as stage 2-3, and the analytics ledger as stage 4. Where
Resonate can be **better** than incumbents: signals include real purchases
(strongest preference signal there is), licensing posture, session intents, and
consent-first taste controls that users can inspect and reset — explainability
incumbents don't offer.

## 4. Target architecture

```
                       ┌────────────────────────────────────────────┐
 capture   ledger      │ BigQuery warehouse (events_clean, facts)   │
 web/player ─► Postgres│                                            │
   events    + Pub/Sub ├─ Dataform marts (scheduled):               │
             ─► Dataflow  • user_track_recommendation_scores (CF/BQML)
                       │  • track_popularity (windowed, decayed)    │
                       │  • artist_engagement (by genre, windowed)  │
                       └──────────────┬─────────────────────────────┘
                                      │ batch export (bounded)
                                      ▼
                        Postgres serving tables + Redis cache
                                      │
                                      ▼
                    ┌──────────────────────────────────┐
                    │ DiscoveryRankingService (NestJS)  │
                    │ candidates: CF ∪ content-embed ∪  │
                    │ popularity ∪ fresh ∪ cohort       │
                    │ rank: weighted signals + learned  │
                    │ taste (+ optional model rerank)   │
                    │ policy: diversity, exploration,   │
                    │ consent/taste-memory, explanations│
                    └───────┬───────────────┬──────────┘
                            ▼               ▼
                   Home surfaces         AI DJ selector
                   (Recommended, rails,  (session intents as
                   Trending, Top Artists) ranking context)
```

Design rules carried over from #977 (still binding): deterministic fallback
always works with zero warehouse/ML availability; **no unbounded warehouse
scans online** (serving reads hit Postgres/Redis exports); explanations are
bounded and never expose raw listener history; all personalization respects
consent gating and taste-memory controls.

## 5. Workstreams

Sequenced so every slice ships user-visible value and nothing depends on a
half-built layer. WS-1..3 are the foundation; WS-4..5 light up ML; WS-6..8
are product surface and measurement; WS-9 unifies the DJ.

- **WS-1 — Unified discovery ranking service.** Extract the AgentSelector scoring core into a shared `DiscoveryRankingService`; route `GET /recommendations/:userId` through it; persist preferences/served-history (Postgres + Redis) replacing in-memory Maps; widen the candidate pool (popularity + fresh + CF + embedding sources, not "50 newest"). Home feed immediately inherits learned taste, cohort and warehouse signals.
- **WS-2 — Signal completeness.** Explicit `playback.skipped` event; auto-mirror playback started/completed/skip into `AgentSignal` (today only save/playlist-add mirror); emit `recommendation.served` / `recommendation.clicked` impressions for home surfaces; consent-gated as today.
- **WS-3 — Popularity & engagement marts.** Dataform models `track_popularity` and `artist_engagement` (completion-weighted plays, unique listeners, saves, purchases; 24h/7d/30d windows; time-decay; genre dimension) + assertions; bounded export job to Postgres serving tables with Redis cache.
- **WS-4 — True Trending + Top Artists by category.** `GET /catalog/top-artists?genre&window` and trending endpoints backed by WS-3; replace the recency-based home rails; per-genre top artists using the existing chip row; honest empty/low-data states (thresholds before a chart position is claimed).
- **WS-5 — Real content embeddings.** Replace the 16-dim hash with a proper embedding model (Vertex/Gemini text embeddings over title/genre/mood/artist metadata first; audio-feature vectors later), pgvector HNSW index, backfill + on-ingest embedding; powers similar-tracks, cold-start, and the ranker's semantic signal.
- **WS-6 — Activate collaborative filtering.** Productionize the existing BQML matrix-factorization path in staging: scheduled Dataform+BQML runs, the #978 eval gate as a standing promotion check, scores exported to serving; home + DJ consume them by default (with fallback). Cost-bounded cadence (staging daily, prod per ADR cost discipline).
- **WS-7 — Home discovery UX v2.** Multi-rail personalized home ("Because you saved X", "Trending in <genre>", "New from artists you play"), real explanations from ranking reasons, exploration slice, impression rotation; design bar per approved home-hero reference.
- **WS-8 — Measurement & experimentation.** Offline recall@k/NDCG on `user_track_signal_training`; online skip/save/completion per surface; extend the agent quality dashboard to home surfaces; a minimal holdout/A-B mechanism to compare ranker variants before promotion.
- **WS-9 — AI DJ unification.** DJ selector consumes the shared ranking core with session intents as context; one taste profile drives both surfaces; DJ pick explanations reuse the shared explanation vocabulary.

Dependency sketch: WS-1 ∥ WS-2 ∥ WS-3 → WS-4 (needs WS-3), WS-6 (needs WS-2 for labels, WS-3 export path), WS-5 independent → WS-7 (needs WS-1+WS-4), WS-8 (needs WS-2), WS-9 (needs WS-1).

## 6. Business-model conformance

- Serves **Line 4 (Listener Pro)** — discovery quality is the stated Listener Pro differentiator — and amplifies **Line 3** (marketplace conversion through better DJ picks). Warehouse/signal plumbing is vision-neutral infra.
- **Red lines (ADR-BM-4) untouched:** no payout mechanics change; recommendations create no pro-rata pool and no listener-side yield. Popularity marts are engagement analytics, not payout inputs — stream fraud stays unprofitable.
- Costs are bounded by design: batch marts on a schedule (#1062 cost discipline), bounded exports, Redis serving, no online BigQuery, no GPU serving. BQML training cadence is a tunable dial.

## 7. Privacy & consent

Existing machinery applies unchanged: privacy tiers + consent basis on every
event; `shouldTrainAgentPlayback` gates signal writes;
`canUseTasteForSocialMatching` gates warehouse-score reads; taste-memory
hide/downrank/reset controls apply to every surface the unified ranker feeds
(they already wrap both paths today). New impressions events are
pseudonymous-tier. Explanations stay categorical ("Because you save a lot of
Afrobeat"), never itemized history. Popularity/top-artist aggregates enforce
minimum-audience thresholds so small-N charts can't identify listeners.

## 8. Success criteria

- Zero surfaces labeled from recency while claiming personalization/rank: "Catalog signal" appears only for genuinely cold users; Top Artists reflects engagement, with genre filter.
- Home feed skip-rate down and save-rate up vs. the heuristic baseline (measured via WS-8; targets set after 2 weeks of baseline capture).
- New track with zero plays is reachable via similarity/exploration (cold-start works); new user gets popularity+preferences, not "newest 50".
- DJ and home agree: same taste profile, same explanation vocabulary.
- Deterministic path still serves correct (if less personal) results with BigQuery, Redis, and Gemini all unavailable.

## 9. Non-goals

- Replacing the deterministic fallback (inherited from #977).
- Real-time audio mixing / remix generation (#323 stays closed; separate doctrine).
- Editorial/human curation tooling (curator staking module is out of scope).
- On-chain recommendation attestations.
- Social feed ranking (Listener Community Network epic #996 owns that).

## 10. Risks

- **Sparse data:** staging has few users; CF quality will be weak until real traffic exists. Mitigation: content+popularity carry early ranking; CF promotes only past the #978 eval gate.
- **Cost creep:** warehouse queries and embedding calls are metered. Mitigation: batch cadence dials, bounded exports, Redis, per-mart cost notes in Dataform configs.
- **Feedback loops:** ranking by engagement amplifies the already-popular. Mitigation: exploration slice + diversity caps in WS-7 policy stage from day one.
- **Two-surface drift:** if WS-9 slips, home and DJ diverge again. Mitigation: WS-1 lands the shared core first; WS-9 is a refactor onto it, not a rewrite.
