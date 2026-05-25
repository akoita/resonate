---
title: "Agent Taste Intelligence"
status: partial
owner: "@akoita"
---

# Agent Taste Intelligence

## Status

`partial`

The AI DJ and commerce-agent selector can now consume optional BigQuery-backed
user-track taste scores as an additive ranking signal. The existing
deterministic selector remains the default behavior: when BigQuery taste signals
are disabled, unavailable, or missing for a candidate track, recommendations
fall back to catalog, learned genre, listing, embedding, and metadata-derived
audio-feature signals.

This is the serving hook for a broader warehouse learning loop. Training jobs,
BigQuery ML model creation, vector indexes, and scheduled materialization are
planned follow-up work.

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
2. A data job materializes `user_track_recommendation_scores`. The initial SQL
   lives in `workers/analytics-dataflow/sql/agent_taste_intelligence_baseline.sql`.
3. The backend sets `AGENT_TASTE_SIGNAL_SOURCE=bigquery`.
4. During candidate ranking, `AgentSelectorService` asks
   `AgentBigQueryTasteSignalService` for scores for the bounded candidate set.
5. Matching rows add a `bigquery_taste_score` recommendation signal and trace.
6. Missing rows or BigQuery failures return empty scores and keep the
   deterministic selector path intact.

The selector never performs an unbounded warehouse scan during recommendation.
It queries only the current `userId` and the candidate `trackIds` already found
by catalog search.

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

The baseline warehouse script creates all three MVP tables from `events_clean`:

```bash
bq query --use_legacy_sql=false \
  < workers/analytics-dataflow/sql/agent_taste_intelligence_baseline.sql
```

Edit `target_project` and `target_dataset` at the top of the script before
running it in a deployed environment.

After enough feedback volume exists, the optional BigQuery ML template can train
a matrix-factorization model and write comparison scores:

```bash
bq query --use_legacy_sql=false \
  < workers/analytics-dataflow/sql/agent_taste_intelligence_bqml.sql
```

The ML template writes `user_track_recommendation_scores_bqml` first. Promote
that table to `user_track_recommendation_scores` only after offline evals show
it beats the baseline.

## BigQuery AI/ML Follow-Up

Useful next warehouse jobs:

- Generate text and metadata embeddings for tracks with BigQuery
  `AI.GENERATE_EMBEDDING`, then use BigQuery vector search for semantic
  similarity candidate expansion.
- Train a BigQuery ML matrix factorization recommender from implicit feedback
  such as play completion, replay, saves, skips, and purchases, then materialize
  `ML.RECOMMEND` output into `user_track_recommendation_scores`.
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
| `AGENT_TASTE_BIGQUERY_SCORES_TABLE` | Optional scores table id. Defaults to `user_track_recommendation_scores`. |
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
- Feature work that changes the serving table contract must update this page,
  `docs/features/README.md`, and `docs/deployment/environment.md`.
