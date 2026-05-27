-- Verification queries for Agent Taste Intelligence materialization.
--
-- Pass query parameters:
--   target_project, target_dataset, scores_table, training_table

DECLARE target_project STRING DEFAULT @target_project;
DECLARE target_dataset STRING DEFAULT @target_dataset;
DECLARE scores_table STRING DEFAULT @scores_table;
DECLARE training_table STRING DEFAULT @training_table;

EXECUTE IMMEDIATE FORMAT("""
SELECT
  'score_freshness_coverage' AS check_name,
  COUNT(*) AS score_rows,
  COUNT(DISTINCT user_id) AS users_with_scores,
  COUNT(DISTINCT track_id) AS tracks_with_scores,
  COUNTIF(confidence >= 0.5) AS high_confidence_rows,
  MIN(recommendation_score) AS min_recommendation_score,
  MAX(recommendation_score) AS max_recommendation_score,
  MAX(updated_at) AS newest_score_at,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(updated_at), HOUR) AS newest_score_age_hours
FROM `%s.%s.%s`
""", target_project, target_dataset, scores_table);

EXECUTE IMMEDIATE FORMAT("""
SELECT
  signal_type,
  COUNT(*) AS training_rows,
  COUNT(DISTINCT user_id) AS users,
  COUNT(DISTINCT track_id) AS tracks,
  SUM(signal_weight) AS total_signal_weight,
  MAX(occurred_at) AS newest_event_at,
  MAX(materialized_at) AS newest_materialized_at
FROM `%s.%s.%s`
GROUP BY signal_type
ORDER BY training_rows DESC, signal_type ASC
""", target_project, target_dataset, training_table);

EXECUTE IMMEDIATE FORMAT("""
SELECT
  IFNULL(session_intent_name, session_intent) AS session_intent,
  queue_style,
  COUNT(*) AS training_rows,
  COUNT(DISTINCT user_id) AS users,
  COUNT(DISTINCT track_id) AS tracks
FROM `%s.%s.%s`
WHERE session_intent IS NOT NULL
   OR session_intent_name IS NOT NULL
   OR queue_style IS NOT NULL
GROUP BY session_intent, queue_style
ORDER BY training_rows DESC
LIMIT 50
""", target_project, target_dataset, training_table);
