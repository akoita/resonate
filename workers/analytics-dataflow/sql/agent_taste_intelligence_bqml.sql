-- BigQuery ML matrix-factorization template for Agent Taste Intelligence.
--
-- Run the baseline script first. This script trains from
-- user_track_signal_training and materializes ML recommendations into the same
-- serving contract consumed by the backend:
-- user_track_recommendation_scores(user_id, track_id, recommendation_score, ...)
--
-- Keep this disabled until there is enough implicit feedback volume and a
-- reviewed training cadence/cost budget.

DECLARE target_project STRING DEFAULT 'resonate-project';
DECLARE target_dataset STRING DEFAULT 'analytics_dev';
DECLARE training_table STRING DEFAULT 'user_track_signal_training';
DECLARE model_name STRING DEFAULT 'agent_taste_matrix_factorization';

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE MODEL `%s.%s.%s`
OPTIONS(
  model_type = 'matrix_factorization',
  user_col = 'user_id',
  item_col = 'track_id',
  rating_col = 'implicit_rating',
  feedback_type = 'implicit',
  l2_reg = 0.2,
  num_factors = 32,
  max_iterations = 20
) AS
SELECT
  user_id,
  track_id,
  LEAST(1.0, GREATEST(0.0, SUM(signal_weight) / 10.0)) AS implicit_rating
FROM `%s.%s.%s`
WHERE signal_weight > 0
GROUP BY user_id, track_id
HAVING implicit_rating > 0
""", target_project, target_dataset, model_name, target_project, target_dataset, training_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.user_track_recommendation_scores_bqml` AS
WITH recommendations AS (
  SELECT
    CAST(user_id AS STRING) AS user_id,
    CAST(track_id AS STRING) AS track_id,
    SAFE_CAST(predicted_rating AS FLOAT64) AS predicted_rating
  FROM ML.RECOMMEND(MODEL `%s.%s.%s`)
),
bounded AS (
  SELECT
    user_id,
    track_id,
    predicted_rating,
    CUME_DIST() OVER (
      PARTITION BY user_id
      ORDER BY predicted_rating ASC
    ) AS recommendation_score
  FROM recommendations
)
SELECT
  user_id,
  track_id,
  recommendation_score,
  LEAST(1.0, GREATEST(0.1, recommendation_score)) AS confidence,
  ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY recommendation_score DESC, predicted_rating DESC
  ) AS rank,
  FORMAT('BigQuery ML matrix-factorization predicted rating %.4f', predicted_rating) AS explanation,
  'bqml-matrix-factorization/v1' AS model_version,
  CURRENT_TIMESTAMP() AS updated_at
FROM bounded
WHERE recommendation_score > 0
""", target_project, target_dataset, target_project, target_dataset, model_name);

-- Promote after offline evals approve the ML output:
--
-- CREATE OR REPLACE TABLE `${PROJECT_ID}.${DATASET}.user_track_recommendation_scores` AS
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.user_track_recommendation_scores_bqml`;
