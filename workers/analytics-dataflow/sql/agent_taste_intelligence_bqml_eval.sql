-- Offline comparison template for Agent Taste BigQuery ML promotion.
--
-- Run after agent_taste_intelligence_baseline.sql and
-- agent_taste_intelligence_bqml.sql. This writes a staging comparison table
-- and does not promote user_track_recommendation_scores_bqml into the serving
-- table. The backend replay fixtures cover deterministic selector, listing,
-- novelty, diversity, and explanation behavior; this warehouse query compares
-- baseline and BQML scores against implicit-feedback labels available in
-- user_track_signal_training.

DECLARE target_project STRING DEFAULT @target_project;
DECLARE target_dataset STRING DEFAULT @target_dataset;
DECLARE training_table STRING DEFAULT @training_table;
DECLARE baseline_scores_table STRING DEFAULT @baseline_scores_table;
DECLARE bqml_scores_table STRING DEFAULT @bqml_scores_table;
DECLARE eval_report_table STRING DEFAULT @eval_report_table;
DECLARE model_version STRING DEFAULT @model_version;
DECLARE evaluation_top_k INT64 DEFAULT @evaluation_top_k;
DECLARE min_acceptance_proxy_delta FLOAT64 DEFAULT @min_acceptance_proxy_delta;
DECLARE min_skip_avoidance_delta FLOAT64 DEFAULT @min_skip_avoidance_delta;
DECLARE min_overall_score_delta FLOAT64 DEFAULT @min_overall_score_delta;

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.%s` AS
WITH labels AS (
  SELECT
    user_id,
    track_id,
    SUM(IF(signal_weight > 0, signal_weight, 0)) AS positive_weight,
    ABS(SUM(IF(signal_weight < 0, signal_weight, 0))) AS negative_weight,
    COUNTIF(signal_weight > 0) AS positive_signal_count,
    COUNTIF(signal_weight < 0) AS negative_signal_count,
    COUNTIF(signal_type IN ('skip', 'short_play_skip')) > 0 AS skipped
  FROM `%s.%s.%s`
  GROUP BY user_id, track_id
),
baseline_ranked AS (
  SELECT
    'warehouse_baseline' AS variant,
    user_id,
    track_id,
    recommendation_score,
    confidence,
    explanation,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY recommendation_score DESC, confidence DESC, track_id ASC
    ) AS eval_rank
  FROM `%s.%s.%s`
),
bqml_ranked AS (
  SELECT
    'bqml' AS variant,
    user_id,
    track_id,
    recommendation_score,
    confidence,
    explanation,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY recommendation_score DESC, confidence DESC, track_id ASC
    ) AS eval_rank
  FROM `%s.%s.%s`
),
ranked_candidates AS (
  SELECT * FROM baseline_ranked WHERE eval_rank <= @evaluation_top_k
  UNION ALL
  SELECT * FROM bqml_ranked WHERE eval_rank <= @evaluation_top_k
),
scored_candidates AS (
  SELECT
    ranked_candidates.variant,
    ranked_candidates.user_id,
    ranked_candidates.track_id,
    ranked_candidates.recommendation_score,
    ranked_candidates.confidence,
    ranked_candidates.explanation,
    ranked_candidates.eval_rank,
    IFNULL(labels.positive_weight, 0) AS positive_weight,
    IFNULL(labels.negative_weight, 0) AS negative_weight,
    IFNULL(labels.positive_signal_count, 0) AS positive_signal_count,
    IFNULL(labels.negative_signal_count, 0) AS negative_signal_count,
    IFNULL(labels.skipped, FALSE) AS skipped
  FROM ranked_candidates
  LEFT JOIN labels
    ON labels.user_id = ranked_candidates.user_id
   AND labels.track_id = ranked_candidates.track_id
),
variant_metrics AS (
  SELECT
    variant,
    COUNT(*) AS scored_rows,
    COUNT(DISTINCT user_id) AS evaluated_users,
    AVG(IF(positive_weight > negative_weight AND positive_signal_count > 0, 1.0, 0.0)) AS precision_at_k,
    AVG(IF(positive_signal_count > 0 AND NOT skipped, 1.0, 0.0)) AS acceptance_proxy,
    AVG(IF(skipped OR negative_weight > positive_weight, 0.0, 1.0)) AS skip_avoidance,
    AVG(IF(explanation IS NOT NULL AND TRIM(explanation) != '', 1.0, 0.0)) AS explanation_coverage,
    AVG(recommendation_score) AS average_recommendation_score
  FROM scored_candidates
  GROUP BY variant
),
weighted_metrics AS (
  SELECT
    variant,
    scored_rows,
    evaluated_users,
    precision_at_k,
    acceptance_proxy,
    skip_avoidance,
    explanation_coverage,
    average_recommendation_score,
    (
      precision_at_k * 0.35 +
      acceptance_proxy * 0.25 +
      skip_avoidance * 0.25 +
      explanation_coverage * 0.15
    ) AS overall_score
  FROM variant_metrics
),
metric_rows AS (
  SELECT variant, 'precision_at_k' AS metric_name, precision_at_k AS metric_value FROM weighted_metrics
  UNION ALL SELECT variant, 'acceptance_proxy', acceptance_proxy FROM weighted_metrics
  UNION ALL SELECT variant, 'skip_avoidance', skip_avoidance FROM weighted_metrics
  UNION ALL SELECT variant, 'explanation_coverage', explanation_coverage FROM weighted_metrics
  UNION ALL SELECT variant, 'average_recommendation_score', average_recommendation_score FROM weighted_metrics
  UNION ALL SELECT variant, 'overall_score', overall_score FROM weighted_metrics
  UNION ALL SELECT variant, 'scored_rows', CAST(scored_rows AS FLOAT64) FROM weighted_metrics
  UNION ALL SELECT variant, 'evaluated_users', CAST(evaluated_users AS FLOAT64) FROM weighted_metrics
),
comparison AS (
  SELECT
    metric_name,
    MAX(IF(variant = 'warehouse_baseline', metric_value, NULL)) AS baseline_value,
    MAX(IF(variant = 'bqml', metric_value, NULL)) AS bqml_value
  FROM metric_rows
  GROUP BY metric_name
)
SELECT
  metric_name,
  baseline_value,
  bqml_value,
  bqml_value - baseline_value AS delta,
  CASE
    WHEN bqml_value > baseline_value THEN 'bqml'
    WHEN baseline_value > bqml_value THEN 'warehouse_baseline'
    ELSE 'tie'
  END AS winner,
  CASE metric_name
    WHEN 'acceptance_proxy' THEN bqml_value - baseline_value >= @min_acceptance_proxy_delta
    WHEN 'skip_avoidance' THEN bqml_value - baseline_value >= @min_skip_avoidance_delta
    WHEN 'overall_score' THEN bqml_value - baseline_value >= @min_overall_score_delta
    ELSE NULL
  END AS meets_promotion_threshold,
  @evaluation_top_k AS evaluation_top_k,
  @model_version AS model_version,
  CURRENT_TIMESTAMP() AS evaluated_at
FROM comparison
ORDER BY
  CASE metric_name
    WHEN 'overall_score' THEN 1
    WHEN 'acceptance_proxy' THEN 2
    WHEN 'skip_avoidance' THEN 3
    WHEN 'precision_at_k' THEN 4
    WHEN 'explanation_coverage' THEN 5
    WHEN 'average_recommendation_score' THEN 6
    WHEN 'scored_rows' THEN 7
    WHEN 'evaluated_users' THEN 8
    ELSE 99
  END
""",
target_project,
target_dataset,
eval_report_table,
target_project,
target_dataset,
training_table,
target_project,
target_dataset,
baseline_scores_table,
target_project,
target_dataset,
bqml_scores_table)
USING
  evaluation_top_k AS evaluation_top_k,
  min_acceptance_proxy_delta AS min_acceptance_proxy_delta,
  min_skip_avoidance_delta AS min_skip_avoidance_delta,
  min_overall_score_delta AS min_overall_score_delta,
  model_version AS model_version;
