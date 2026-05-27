-- Agent Taste Intelligence baseline materialization.
--
-- Usage:
-- 1. Run through ../run-agent-taste-materialization.sh, or pass the required
--    BigQuery query parameters manually:
--      target_project, target_dataset, clean_table, training_table,
--      scores_table, model_version
-- 2. Run this script after events_clean is populated.
-- 3. Point the backend at the generated score table with:
--    AGENT_TASTE_SIGNAL_SOURCE=bigquery
--    AGENT_TASTE_BIGQUERY_SCORES_TABLE=user_track_recommendation_scores
--
-- This baseline intentionally does not require BigQuery ML. It creates stable
-- serving tables that the agent backend can consume while ML training is still
-- being validated.

DECLARE target_project STRING DEFAULT @target_project;
DECLARE target_dataset STRING DEFAULT @target_dataset;
DECLARE clean_table STRING DEFAULT @clean_table;
DECLARE training_table STRING DEFAULT @training_table;
DECLARE scores_table STRING DEFAULT @scores_table;
DECLARE model_version STRING DEFAULT @model_version;

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.track_intelligence_features` AS
WITH track_events AS (
  SELECT
    COALESCE(
      CAST(trackId AS STRING),
      JSON_VALUE(payload, '$.trackId')
    ) AS track_id,
    eventName AS event_name,
    occurredAt AS occurred_at,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    SAFE_CAST(JSON_VALUE(payload, '$.completionRatio') AS FLOAT64) AS completion_ratio,
    SAFE_CAST(JSON_VALUE(payload, '$.durationSeconds') AS FLOAT64) AS duration_seconds,
    SAFE_CAST(JSON_VALUE(payload, '$.listenSeconds') AS FLOAT64) AS listen_seconds,
    SAFE_CAST(JSON_VALUE(payload, '$.heartbeatSeconds') AS FLOAT64) AS heartbeat_seconds,
    SAFE_CAST(JSON_VALUE(payload, '$.positionSeconds') AS FLOAT64) AS position_seconds,
    source
  FROM `%s.%s.%s`
  WHERE COALESCE(CAST(trackId AS STRING), JSON_VALUE(payload, '$.trackId')) IS NOT NULL
)
SELECT
  track_id,
  COUNT(*) AS interaction_events,
  COUNTIF(event_name = 'playback.started') AS playback_start_events,
  COUNTIF(event_name = 'playback.heartbeat') AS heartbeat_events,
  COUNTIF(event_name = 'playback.completed') AS play_events,
  COUNTIF(event_name = 'playback.completed' AND completion_ratio < 0.20) AS inferred_skip_events,
  COUNTIF(event_name IN ('library.saved', 'playlist.track_added')) AS save_events,
  COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
  COUNTIF(event_name IN ('agent.recommendation_selected', 'agent.track_selected', 'agent.selection', 'agent.decision_made')) AS agent_selected_events,
  AVG(IF(event_name = 'playback.completed', completion_ratio, NULL)) AS avg_completion_ratio,
  SUM(
    IF(
      event_name IN ('playback.completed', 'playback.heartbeat'),
      IFNULL(listen_seconds, IFNULL(duration_seconds, IFNULL(heartbeat_seconds, position_seconds))),
      0
    )
  ) AS observed_listen_seconds,
  SUM(IFNULL(canonical_amount_usd, 0)) AS gross_revenue_usd,
  COUNT(DISTINCT source) AS source_count,
  MIN(occurred_at) AS first_seen_at,
  MAX(occurred_at) AS last_seen_at,
  CURRENT_TIMESTAMP() AS materialized_at
FROM track_events
GROUP BY track_id
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.%s` AS
WITH clean AS (
  SELECT
    COALESCE(
      CAST(actorId AS STRING),
      JSON_VALUE(payload, '$.userCohortId'),
      JSON_VALUE(payload, '$.userId'),
      JSON_VALUE(payload, '$.agentId')
    ) AS user_id,
    COALESCE(
      CAST(trackId AS STRING),
      JSON_VALUE(payload, '$.trackId')
    ) AS track_id,
    COALESCE(
      CAST(sessionId AS STRING),
      JSON_VALUE(payload, '$.sessionId'),
      JSON_VALUE(payload, '$.agentSessionId')
    ) AS session_id,
    eventName AS event_name,
    occurredAt AS occurred_at,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    SAFE_CAST(JSON_VALUE(payload, '$.completionRatio') AS FLOAT64) AS completion_ratio,
    COALESCE(
      JSON_VALUE(payload, '$.sessionIntent'),
      JSON_VALUE(payload, '$.intent'),
      JSON_VALUE(payload, '$.preferences.sessionIntent')
    ) AS session_intent,
    COALESCE(
      JSON_VALUE(payload, '$.sessionIntentName'),
      JSON_VALUE(payload, '$.intentName'),
      JSON_VALUE(payload, '$.preferences.sessionIntentName')
    ) AS session_intent_name,
    COALESCE(
      JSON_VALUE(payload, '$.queueStyle'),
      JSON_VALUE(payload, '$.preferences.queueStyle')
    ) AS queue_style,
    payload
  FROM `%s.%s.%s`
),
session_context AS (
  SELECT
    session_id,
    user_id,
    ARRAY_AGG(session_intent IGNORE NULLS ORDER BY occurred_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS session_intent,
    ARRAY_AGG(session_intent_name IGNORE NULLS ORDER BY occurred_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS session_intent_name,
    ARRAY_AGG(queue_style IGNORE NULLS ORDER BY occurred_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS queue_style
  FROM clean
  WHERE session_id IS NOT NULL
    AND user_id IS NOT NULL
    AND event_name IN ('session.started', 'agent.session_started', 'agent.intent_selected')
  GROUP BY session_id, user_id
),
weighted AS (
  SELECT
    clean.user_id,
    clean.track_id,
    clean.session_id,
    clean.event_name,
    clean.occurred_at,
    CASE
      WHEN clean.event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed') THEN 5.0
      WHEN clean.event_name IN ('library.saved', 'playlist.track_added') THEN 3.0
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio >= 0.80 THEN 2.0
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio >= 0.40 THEN 1.0
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio < 0.20 THEN -1.5
      WHEN clean.event_name IN ('agent.recommendation_selected', 'agent.track_selected', 'agent.selection') THEN 1.0
      WHEN clean.event_name = 'agent.decision_made' THEN 0.75
      ELSE 0.0
    END AS signal_weight,
    CASE
      WHEN clean.event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed') THEN 'purchase'
      WHEN clean.event_name IN ('library.saved', 'playlist.track_added') THEN 'save'
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio >= 0.80 THEN 'strong_play'
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio >= 0.40 THEN 'partial_play'
      WHEN clean.event_name = 'playback.completed' AND clean.completion_ratio < 0.20 THEN 'skip'
      WHEN clean.event_name IN ('agent.recommendation_selected', 'agent.track_selected', 'agent.selection', 'agent.decision_made') THEN 'agent_selected'
      ELSE 'neutral'
    END AS signal_type,
    clean.completion_ratio,
    clean.canonical_amount_usd,
    COALESCE(clean.session_intent, session_context.session_intent) AS session_intent,
    COALESCE(clean.session_intent_name, session_context.session_intent_name) AS session_intent_name,
    COALESCE(clean.queue_style, session_context.queue_style) AS queue_style,
    clean.payload
  FROM clean
  LEFT JOIN session_context
    ON session_context.session_id = clean.session_id
   AND session_context.user_id = clean.user_id
  WHERE clean.user_id IS NOT NULL
    AND clean.track_id IS NOT NULL
)
SELECT
  user_id,
  track_id,
  session_id,
  event_name,
  signal_type,
  signal_weight,
  completion_ratio,
  canonical_amount_usd,
  session_intent,
  session_intent_name,
  queue_style,
  occurred_at,
  payload,
  CURRENT_TIMESTAMP() AS materialized_at
FROM weighted
WHERE signal_weight != 0.0
""", target_project, target_dataset, training_table, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.%s` AS
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
    COUNTIF(signal_type = 'skip') AS skip_count,
    GREATEST(COUNTIF(signal_type IN ('strong_play', 'partial_play')) - 1, 0) AS replay_count,
    COUNTIF(signal_type = 'agent_selected') AS agent_selected_count,
    COUNTIF(session_intent IS NOT NULL OR session_intent_name IS NOT NULL OR queue_style IS NOT NULL) AS intent_context_count,
    ARRAY_AGG(DISTINCT session_intent IGNORE NULLS LIMIT 5) AS session_intents,
    ARRAY_AGG(DISTINCT session_intent_name IGNORE NULLS LIMIT 5) AS session_intent_names,
    ARRAY_AGG(DISTINCT queue_style IGNORE NULLS LIMIT 5) AS queue_styles,
    MAX(occurred_at) AS last_signal_at
  FROM `%s.%s.%s`
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
    user_track.skip_count,
    user_track.replay_count,
    user_track.agent_selected_count,
    user_track.intent_context_count,
    user_track.session_intents,
    user_track.session_intent_names,
    user_track.queue_styles,
    user_track.last_signal_at,
    features.interaction_events,
    features.avg_completion_ratio,
    features.gross_revenue_usd,
    (
      user_track.total_signal_weight
      + LEAST(IFNULL(features.interaction_events, 0), 50) * 0.02
      + IFNULL(features.avg_completion_ratio, 0) * 0.5
      + LEAST(user_track.replay_count, 5) * 0.25
      + LEAST(user_track.agent_selected_count, 5) * 0.15
      + LEAST(user_track.intent_context_count, 3) * 0.05
    ) AS raw_score
  FROM user_track
  LEFT JOIN `%s.%s.track_intelligence_features` AS features
    ON features.track_id = user_track.track_id
),
normalized AS (
  SELECT
    *,
    1 / (1 + EXP(-raw_score / 6.0)) AS recommendation_score,
    LEAST(1.0, LOG(1 + signal_count + intent_context_count) / 3.0) AS confidence
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
    'baseline taste score from %%d signal(s): purchases=%%d saves=%%d plays=%%d skips=%%d replays=%%d agent_picks=%%d intents=%%d',
    signal_count,
    purchase_count,
    save_count,
    play_count,
    skip_count,
    replay_count,
    agent_selected_count,
    intent_context_count
  ) AS explanation,
  @model_version AS model_version,
  CURRENT_TIMESTAMP() AS updated_at
FROM normalized
WHERE recommendation_score > 0
""", target_project, target_dataset, scores_table, target_project, target_dataset, training_table, target_project, target_dataset)
USING model_version AS model_version;
