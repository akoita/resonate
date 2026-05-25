-- Agent Taste Intelligence baseline materialization.
--
-- Usage:
-- 1. Replace the defaults below or pass edited values in the BigQuery console.
-- 2. Run this script after analytics_facts/events_clean are populated.
-- 3. Point the backend at the generated score table with:
--    AGENT_TASTE_SIGNAL_SOURCE=bigquery
--    AGENT_TASTE_BIGQUERY_SCORES_TABLE=user_track_recommendation_scores
--
-- This baseline intentionally does not require BigQuery ML. It creates stable
-- serving tables that the agent backend can consume while ML training is still
-- being validated.

DECLARE target_project STRING DEFAULT 'resonate-project';
DECLARE target_dataset STRING DEFAULT 'analytics_dev';
DECLARE clean_table STRING DEFAULT 'events_clean';

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.track_intelligence_features` AS
WITH track_events AS (
  SELECT
    CAST(trackId AS STRING) AS track_id,
    eventName AS event_name,
    occurredAt AS occurred_at,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.completionRatio') AS FLOAT64) AS completion_ratio,
    source
  FROM `%s.%s.%s`
  WHERE trackId IS NOT NULL
)
SELECT
  track_id,
  COUNT(*) AS interaction_events,
  COUNTIF(event_name = 'playback.completed') AS play_events,
  COUNTIF(event_name = 'library.saved') AS save_events,
  COUNTIF(event_name = 'commerce.settled') AS purchase_events,
  COUNTIF(event_name = 'agent.recommendation_selected') AS agent_selected_events,
  AVG(IF(event_name = 'playback.completed', completion_ratio, NULL)) AS avg_completion_ratio,
  SUM(IFNULL(canonical_amount_usd, 0)) AS gross_revenue_usd,
  COUNT(DISTINCT source) AS source_count,
  MIN(occurred_at) AS first_seen_at,
  MAX(occurred_at) AS last_seen_at,
  CURRENT_TIMESTAMP() AS materialized_at
FROM track_events
GROUP BY track_id
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.user_track_signal_training` AS
WITH clean AS (
  SELECT
    COALESCE(
      CAST(actorId AS STRING),
      JSON_VALUE(TO_JSON_STRING(payload), '$.userCohortId'),
      JSON_VALUE(TO_JSON_STRING(payload), '$.userId'),
      JSON_VALUE(TO_JSON_STRING(payload), '$.agentId')
    ) AS user_id,
    CAST(trackId AS STRING) AS track_id,
    eventName AS event_name,
    occurredAt AS occurred_at,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.completionRatio') AS FLOAT64) AS completion_ratio,
    payload
  FROM `%s.%s.%s`
  WHERE trackId IS NOT NULL
),
weighted AS (
  SELECT
    user_id,
    track_id,
    event_name,
    occurred_at,
    CASE
      WHEN event_name = 'commerce.settled' THEN 5.0
      WHEN event_name = 'library.saved' THEN 3.0
      WHEN event_name = 'playback.completed' AND completion_ratio >= 0.80 THEN 2.0
      WHEN event_name = 'playback.completed' AND completion_ratio >= 0.40 THEN 1.0
      WHEN event_name = 'playback.completed' AND completion_ratio < 0.20 THEN -1.0
      WHEN event_name = 'agent.recommendation_selected' THEN 1.0
      ELSE 0.0
    END AS signal_weight,
    CASE
      WHEN event_name = 'commerce.settled' THEN 'purchase'
      WHEN event_name = 'library.saved' THEN 'save'
      WHEN event_name = 'playback.completed' AND completion_ratio >= 0.80 THEN 'strong_play'
      WHEN event_name = 'playback.completed' AND completion_ratio >= 0.40 THEN 'partial_play'
      WHEN event_name = 'playback.completed' AND completion_ratio < 0.20 THEN 'short_play'
      WHEN event_name = 'agent.recommendation_selected' THEN 'agent_selected'
      ELSE 'neutral'
    END AS signal_type,
    completion_ratio,
    canonical_amount_usd,
    payload
  FROM clean
  WHERE user_id IS NOT NULL
)
SELECT
  user_id,
  track_id,
  event_name,
  signal_type,
  signal_weight,
  completion_ratio,
  canonical_amount_usd,
  occurred_at,
  payload,
  CURRENT_TIMESTAMP() AS materialized_at
FROM weighted
WHERE signal_weight != 0.0
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.user_track_recommendation_scores` AS
WITH user_track AS (
  SELECT
    user_id,
    track_id,
    SUM(signal_weight) AS total_signal_weight,
    SUM(IF(signal_weight > 0, signal_weight, 0)) AS positive_signal_weight,
    ABS(SUM(IF(signal_weight < 0, signal_weight, 0))) AS negative_signal_weight,
    COUNT(*) AS signal_count,
    COUNTIF(signal_type = 'purchase') AS purchase_count,
    COUNTIF(signal_type = 'save') AS save_count,
    COUNTIF(signal_type IN ('strong_play', 'partial_play')) AS play_count,
    MAX(occurred_at) AS last_signal_at
  FROM `%s.%s.user_track_signal_training`
  GROUP BY user_id, track_id
),
scored AS (
  SELECT
    user_track.user_id,
    user_track.track_id,
    user_track.total_signal_weight,
    user_track.positive_signal_weight,
    user_track.negative_signal_weight,
    user_track.signal_count,
    user_track.purchase_count,
    user_track.save_count,
    user_track.play_count,
    user_track.last_signal_at,
    features.interaction_events,
    features.avg_completion_ratio,
    features.gross_revenue_usd,
    (
      user_track.total_signal_weight
      + LEAST(IFNULL(features.interaction_events, 0), 50) * 0.02
      + IFNULL(features.avg_completion_ratio, 0) * 0.5
    ) AS raw_score
  FROM user_track
  LEFT JOIN `%s.%s.track_intelligence_features` AS features
    ON features.track_id = user_track.track_id
),
normalized AS (
  SELECT
    *,
    1 / (1 + EXP(-raw_score / 6.0)) AS recommendation_score,
    LEAST(1.0, LOG(1 + signal_count) / 3.0) AS confidence
  FROM scored
)
SELECT
  user_id,
  track_id,
  recommendation_score,
  confidence,
  ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY recommendation_score DESC, confidence DESC, last_signal_at DESC
  ) AS rank,
  FORMAT(
    'baseline taste score from %%d signal(s): purchases=%%d saves=%%d plays=%%d',
    signal_count,
    purchase_count,
    save_count,
    play_count
  ) AS explanation,
  'baseline-weighted-signals/v1' AS model_version,
  CURRENT_TIMESTAMP() AS updated_at
FROM normalized
WHERE recommendation_score > 0
""", target_project, target_dataset, target_project, target_dataset, target_project, target_dataset);
