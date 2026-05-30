---
title: "Agent Taste Intelligence"
status: partial
owner: "@akoita"
issues: [977, 978, 979, 980, 981, 982, 983, 989]
---

# Agent Taste Intelligence

## Status

`partial`

The AI DJ and commerce-agent selector can now consume optional BigQuery-backed
user-track taste scores as an additive ranking signal, and the analytics
Dataflow output has a repeatable baseline materialization path for those scores.
The existing deterministic selector remains the default behavior: when BigQuery
taste signals are disabled, unavailable, or missing for a candidate track,
recommendations fall back to catalog, learned genre, listing, embedding, and
metadata-derived audio-feature signals.

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
| Agents | Score candidate tracks with collaborative taste fit before deciding what to recommend or buy. |
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

The selector never performs an unbounded warehouse scan during recommendation.
It queries only the current `userId` and the candidate `trackIds` already found
by catalog search.

Listener governance controls live in
[Listener Taste Memory Controls](listener_taste_memory_controls.md). Hidden and
downranked signals are applied before recommendation reasons are returned, reset
markers exclude older `AgentSignal` rows from learned profiles, and future
social/cohort use of private taste data is disabled unless the listener opts in.

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

## Recommendation Explanations

Warehouse explanations are treated as untrusted hints. The backend sanitizes
them before use and translates them into listener-safe reason categories:

| Type | Listener-facing meaning |
| --- | --- |
| Taste fit | The track matches learned listening patterns. |
| Session intent fit | The track fits the current mood, vibe, or Session Intent. |
| Novelty/replay fit | The track is fresh enough for the current session based on replay/skip signals. |
| Commerce/listing fit | Saves, playlist adds, purchases, or purchasable stems increase confidence. |

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
available playback completions plus library saves into `complete` and `save`
signals. Stop events annotate existing session signals with coarse
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
- Warehouse verification queries live in
  `workers/analytics-dataflow/sql/agent_taste_intelligence_verification.sql` and
  report freshness, coverage, signal mix, and intent-context coverage.
- Dataform orchestration templates and assertions live in
  `workers/analytics-dataflow/dataform/`.
- Feature work that changes the serving table contract must update this page,
  `docs/features/README.md`, and `docs/deployment/environment.md`.
