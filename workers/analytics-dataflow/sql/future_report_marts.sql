-- Future report marts for listener, artist, marketplace, and product insights.
--
-- Usage:
-- 1. In BigQuery, set the default dataset to the analytics dataset or edit
--    target_dataset below.
-- 2. Run after events_clean and analytics_facts are populated by Dataflow or
--    the backend warehouse loader.
-- 3. Dry-run from CI/operator shells with:
--    bq query --use_legacy_sql=false --dry_run < future_report_marts.sql
--
-- These marts intentionally derive from the canonical event layers. They are
-- report inputs, not transactional sources of truth.

DECLARE target_project STRING DEFAULT @@project_id;
DECLARE target_dataset STRING DEFAULT COALESCE(@@dataset_id, 'analytics_dev');
DECLARE clean_table STRING DEFAULT 'events_clean';
DECLARE facts_table STRING DEFAULT 'analytics_facts';

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.listener_session_summary` AS
WITH clean AS (
  SELECT
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name,
    SAFE_CAST(occurredAt AS TIMESTAMP) AS occurred_at,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS occurred_date,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.heartbeatIntervalMs') AS FLOAT64) AS heartbeat_interval_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.durationMs') AS FLOAT64) AS duration_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.positionMs') AS FLOAT64) AS position_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.completionRatio') AS FLOAT64) AS completion_ratio,
    source
  FROM `%s.%s.%s`
  WHERE actorId IS NOT NULL
    AND sessionId IS NOT NULL
    AND eventFamily IN ('playback', 'session', 'playlist', 'search', 'library', 'commerce', 'agent')
),
session_rollup AS (
  SELECT
    actor_id,
    session_id,
    MIN(occurred_at) AS session_started_at,
    MAX(occurred_at) AS session_ended_at,
    MIN(occurred_date) AS session_date,
    COUNT(*) AS events,
    COUNTIF(event_name = 'playback.started') AS playback_starts,
    COUNTIF(event_name = 'playback.completed') AS completed_plays,
    COUNTIF(event_name = 'playback.heartbeat') AS heartbeat_events,
    COUNTIF(event_name IN ('playlist.track_added', 'library.saved')) AS save_or_playlist_events,
    COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
    COUNT(DISTINCT track_id) AS distinct_tracks,
    COUNT(DISTINCT artist_id) AS distinct_artists,
    COUNT(DISTINCT release_id) AS distinct_releases,
    COUNT(DISTINCT source) AS source_count,
    SUM(IF(event_name = 'playback.heartbeat', IFNULL(heartbeat_interval_ms, 0), 0)) / 1000.0 AS heartbeat_seconds,
    SUM(
      IF(
        event_name = 'playback.completed',
        IFNULL(duration_ms * IFNULL(completion_ratio, 1.0), position_ms),
        0
      )
    ) / 1000.0 AS completed_listening_seconds,
    ARRAY_AGG(track_id IGNORE NULLS ORDER BY occurred_at LIMIT 20) AS first_track_sequence
  FROM clean
  GROUP BY actor_id, session_id
)
SELECT
  *,
  TIMESTAMP_DIFF(session_ended_at, session_started_at, SECOND) AS observed_session_seconds,
  GREATEST(heartbeat_seconds, completed_listening_seconds) AS estimated_listening_seconds,
  CURRENT_TIMESTAMP() AS materialized_at
FROM session_rollup
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.listener_daily_activity` AS
WITH clean AS (
  SELECT
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS activity_date,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.heartbeatIntervalMs') AS FLOAT64) AS heartbeat_interval_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.durationMs') AS FLOAT64) AS duration_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.positionMs') AS FLOAT64) AS position_ms,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.completionRatio') AS FLOAT64) AS completion_ratio,
    source
  FROM `%s.%s.%s`
  WHERE actorId IS NOT NULL
),
track_day AS (
  SELECT
    actor_id,
    activity_date,
    track_id,
    COUNTIF(event_name = 'playback.completed') AS completed_plays
  FROM clean
  WHERE track_id IS NOT NULL
  GROUP BY actor_id, activity_date, track_id
),
replays AS (
  SELECT
    actor_id,
    activity_date,
    SUM(GREATEST(completed_plays - 1, 0)) AS repeat_completed_play_events,
    COUNTIF(completed_plays >= 3) AS replayed_tracks
  FROM track_day
  GROUP BY actor_id, activity_date
)
SELECT
  clean.actor_id,
  clean.activity_date,
  COUNT(*) AS total_events,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(DISTINCT track_id) AS distinct_tracks,
  COUNT(DISTINCT artist_id) AS distinct_artists,
  COUNT(DISTINCT release_id) AS distinct_releases,
  COUNTIF(event_name = 'playback.started') AS playback_starts,
  COUNTIF(event_name = 'playback.completed') AS completed_plays,
  COUNTIF(event_name = 'playback.heartbeat') AS heartbeat_events,
  COUNTIF(event_name IN ('playlist.track_added', 'library.saved')) AS save_or_playlist_events,
  COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
  COUNT(DISTINCT source) AS source_count,
  SUM(IF(event_name = 'playback.heartbeat', IFNULL(heartbeat_interval_ms, 0), 0)) / 1000.0 AS heartbeat_seconds,
  SUM(
    IF(
      event_name = 'playback.completed',
      IFNULL(duration_ms * IFNULL(completion_ratio, 1.0), position_ms),
      0
    )
  ) / 1000.0 AS completed_listening_seconds,
  IFNULL(MAX(replays.repeat_completed_play_events), 0) AS repeat_completed_play_events,
  IFNULL(MAX(replays.replayed_tracks), 0) AS replayed_tracks,
  CURRENT_TIMESTAMP() AS materialized_at
FROM clean
LEFT JOIN replays
  ON replays.actor_id = clean.actor_id
 AND replays.activity_date = clean.activity_date
GROUP BY clean.actor_id, clean.activity_date
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.listener_track_affinity` AS
WITH playback AS (
  SELECT
    CAST(actorId AS STRING) AS actor_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name,
    SAFE_CAST(occurredAt AS TIMESTAMP) AS occurred_at,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS occurred_date,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.completionRatio') AS FLOAT64) AS completion_ratio,
    SAFE_CAST(JSON_VALUE(TO_JSON_STRING(payload), '$.heartbeatIntervalMs') AS FLOAT64) AS heartbeat_interval_ms
  FROM `%s.%s.%s`
  WHERE actorId IS NOT NULL
    AND trackId IS NOT NULL
    AND eventFamily IN ('playback', 'playlist', 'library', 'commerce', 'agent')
),
track_day AS (
  SELECT
    actor_id,
    track_id,
    occurred_date,
    COUNTIF(event_name = 'playback.completed') AS completed_plays
  FROM playback
  GROUP BY actor_id, track_id, occurred_date
)
SELECT
  playback.actor_id,
  playback.track_id,
  ANY_VALUE(playback.artist_id) AS artist_id,
  ANY_VALUE(playback.release_id) AS release_id,
  COUNTIF(event_name = 'playback.completed') AS completed_plays,
  COUNTIF(event_name = 'playback.started') AS started_plays,
  COUNTIF(event_name = 'playback.heartbeat') AS heartbeat_events,
  COUNTIF(event_name IN ('playlist.track_added', 'library.saved')) AS save_or_playlist_events,
  COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
  COUNT(DISTINCT playback.occurred_date) AS active_days,
  COUNT(DISTINCT IF(track_day.completed_plays >= 2, track_day.occurred_date, NULL)) AS replay_days,
  MAX(track_day.completed_plays) AS max_completed_plays_in_day,
  AVG(IF(event_name = 'playback.completed', completion_ratio, NULL)) AS avg_completion_ratio,
  SUM(IF(event_name = 'playback.heartbeat', IFNULL(heartbeat_interval_ms, 0), 0)) / 1000.0 AS heartbeat_seconds,
  MIN(occurred_at) AS first_seen_at,
  MAX(occurred_at) AS last_seen_at,
  (
    COUNTIF(event_name = 'playback.completed')
    + COUNTIF(event_name IN ('playlist.track_added', 'library.saved')) * 3
    + COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) * 5
    + COUNTIF(track_day.completed_plays >= 2) * 2
  ) AS affinity_score,
  CURRENT_TIMESTAMP() AS materialized_at
FROM playback
LEFT JOIN track_day
  ON track_day.actor_id = playback.actor_id
 AND track_day.track_id = playback.track_id
 AND track_day.occurred_date = playback.occurred_date
GROUP BY playback.actor_id, playback.track_id
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.listener_replay_bursts` AS
WITH completed AS (
  SELECT
    CAST(actorId AS STRING) AS actor_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    CAST(sessionId AS STRING) AS session_id,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS activity_date,
    SAFE_CAST(occurredAt AS TIMESTAMP) AS occurred_at
  FROM `%s.%s.%s`
  WHERE eventName = 'playback.completed'
    AND actorId IS NOT NULL
    AND trackId IS NOT NULL
),
bursts AS (
  SELECT
    actor_id,
    track_id,
    ANY_VALUE(artist_id) AS artist_id,
    ANY_VALUE(release_id) AS release_id,
    activity_date,
    COUNT(*) AS completed_plays,
    COUNT(DISTINCT session_id) AS sessions,
    MIN(occurred_at) AS first_play_at,
    MAX(occurred_at) AS last_play_at
  FROM completed
  GROUP BY actor_id, track_id, activity_date
)
SELECT
  *,
  TIMESTAMP_DIFF(last_play_at, first_play_at, MINUTE) AS replay_window_minutes,
  SAFE_DIVIDE(completed_plays, 1 + TIMESTAMP_DIFF(last_play_at, first_play_at, HOUR)) AS plays_per_observed_hour,
  completed_plays >= 3 AS is_replay_burst,
  completed_plays >= 10 AS is_extreme_replay_burst,
  CURRENT_TIMESTAMP() AS materialized_at
FROM bursts
WHERE completed_plays >= 2
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.listener_cohort_catalog_rankings` AS
WITH play_events AS (
  SELECT
    CONCAT('cohort_', LPAD(CAST(ABS(MOD(FARM_FINGERPRINT(CAST(actorId AS STRING)), 100)) AS STRING), 2, '0')) AS actor_cohort,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS activity_date,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name
  FROM `%s.%s.%s`
  WHERE actorId IS NOT NULL
    AND eventName IN ('playback.completed', 'library.saved', 'playlist.track_added', 'commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')
),
entities AS (
  SELECT actor_cohort, activity_date, 'track' AS entity_type, track_id AS entity_id, event_name FROM play_events WHERE track_id IS NOT NULL
  UNION ALL
  SELECT actor_cohort, activity_date, 'artist' AS entity_type, artist_id AS entity_id, event_name FROM play_events WHERE artist_id IS NOT NULL
  UNION ALL
  SELECT actor_cohort, activity_date, 'release' AS entity_type, release_id AS entity_id, event_name FROM play_events WHERE release_id IS NOT NULL
),
scored AS (
  SELECT
    actor_cohort,
    activity_date,
    entity_type,
    entity_id,
    COUNTIF(event_name = 'playback.completed') AS completed_plays,
    COUNTIF(event_name IN ('library.saved', 'playlist.track_added')) AS save_or_playlist_events,
    COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
    COUNT(*) AS total_signal_events,
    (
      COUNTIF(event_name = 'playback.completed')
      + COUNTIF(event_name IN ('library.saved', 'playlist.track_added')) * 3
      + COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) * 5
    ) AS signal_score
  FROM entities
  GROUP BY actor_cohort, activity_date, entity_type, entity_id
)
SELECT
  *,
  ROW_NUMBER() OVER (
    PARTITION BY actor_cohort, activity_date, entity_type
    ORDER BY signal_score DESC, total_signal_events DESC, entity_id
  ) AS cohort_rank,
  CURRENT_TIMESTAMP() AS materialized_at
FROM scored
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.artist_catalog_daily_metrics` AS
WITH clean AS (
  SELECT
    CAST(artistId AS STRING) AS artist_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(releaseId AS STRING) AS release_id,
    CAST(actorId AS STRING) AS actor_id,
    eventName AS event_name,
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS metric_date,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    source,
    LOWER(JSON_VALUE(TO_JSON_STRING(payload), '$.route')) AS route,
    JSON_VALUE(TO_JSON_STRING(payload), '$.status') AS status
  FROM `%s.%s.%s`
  WHERE artistId IS NOT NULL
),
daily AS (
  SELECT
    artist_id,
    metric_date,
    COUNTIF(event_name = 'playback.completed') AS completed_plays,
    COUNT(DISTINCT IF(event_name = 'playback.completed', actor_id, NULL)) AS unique_listeners,
    COUNT(DISTINCT IF(event_name = 'playback.completed', track_id, NULL)) AS played_tracks,
    COUNT(DISTINCT IF(event_name = 'playback.completed', release_id, NULL)) AS played_releases,
    COUNTIF(event_name IN ('library.saved', 'playlist.track_added')) AS save_or_playlist_events,
    COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed')) AS purchase_events,
    SUM(IF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'agent.purchase_completed'), IFNULL(canonical_amount_usd, 0), 0)) AS gross_revenue_usd,
    COUNTIF(event_name = 'rights.route_decided' AND route IN ('standard', 'standard_escrow', 'trusted_fast_path')) AS marketplace_ready_routes,
    COUNTIF(event_name = 'rights.route_decided' AND route IN ('limited', 'quarantined', 'blocked')) AS restricted_routes,
    COUNTIF(event_name = 'rights.route_decided' AND route = 'blocked') AS blocked_routes,
    COUNT(DISTINCT source) AS source_count
  FROM clean
  GROUP BY artist_id, metric_date
)
SELECT
  *,
  SAFE_DIVIDE(completed_plays, NULLIF(unique_listeners, 0)) AS plays_per_listener,
  CURRENT_TIMESTAMP() AS materialized_at
FROM daily
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.discovery_playlist_play_funnels` AS
WITH session_events AS (
  SELECT
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS funnel_date,
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    eventName AS event_name,
    eventFamily AS event_family,
    CAST(trackId AS STRING) AS track_id,
    CAST(releaseId AS STRING) AS release_id
  FROM `%s.%s.%s`
  WHERE actorId IS NOT NULL
    AND sessionId IS NOT NULL
    AND eventFamily IN ('search', 'playlist', 'library', 'playback', 'marketplace', 'commerce', 'x402', 'recommendation', 'agent')
),
session_flags AS (
  SELECT
    funnel_date,
    actor_id,
    session_id,
    COUNTIF(event_family = 'search') > 0 AS had_search,
    COUNTIF(event_name IN ('playlist.track_added', 'library.saved')) > 0 AS had_save_or_playlist,
    COUNTIF(event_name = 'playback.started') > 0 AS had_play_start,
    COUNTIF(event_name = 'playback.completed') > 0 AS had_completed_play,
    COUNTIF(event_family IN ('marketplace', 'commerce', 'x402')) > 0 AS had_marketplace_or_commerce,
    COUNT(DISTINCT track_id) AS touched_tracks,
    COUNT(DISTINCT release_id) AS touched_releases
  FROM session_events
  GROUP BY funnel_date, actor_id, session_id
)
SELECT
  funnel_date,
  COUNT(*) AS sessions,
  COUNT(DISTINCT actor_id) AS actors,
  COUNTIF(had_search) AS search_sessions,
  COUNTIF(had_search AND had_play_start) AS search_to_play_sessions,
  COUNTIF(had_search AND had_completed_play) AS search_to_completed_play_sessions,
  COUNTIF(had_save_or_playlist) AS save_or_playlist_sessions,
  COUNTIF(had_save_or_playlist AND had_completed_play) AS playlist_to_completed_play_sessions,
  COUNTIF(had_marketplace_or_commerce) AS marketplace_or_commerce_sessions,
  COUNTIF(had_marketplace_or_commerce AND had_completed_play) AS marketplace_to_completed_play_sessions,
  AVG(touched_tracks) AS avg_touched_tracks,
  AVG(touched_releases) AS avg_touched_releases,
  SAFE_DIVIDE(COUNTIF(had_search AND had_completed_play), NULLIF(COUNTIF(had_search), 0)) AS search_to_completed_play_rate,
  SAFE_DIVIDE(COUNTIF(had_save_or_playlist AND had_completed_play), NULLIF(COUNTIF(had_save_or_playlist), 0)) AS playlist_to_completed_play_rate,
  CURRENT_TIMESTAMP() AS materialized_at
FROM session_flags
GROUP BY funnel_date
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.marketplace_conversion_daily` AS
WITH clean AS (
  SELECT
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS conversion_date,
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name,
    SAFE_CAST(canonicalAmountUsd AS FLOAT64) AS canonical_amount_usd,
    JSON_VALUE(TO_JSON_STRING(payload), '$.listingId') AS listing_id,
    JSON_VALUE(TO_JSON_STRING(payload), '$.licenseType') AS license_type,
    JSON_VALUE(TO_JSON_STRING(payload), '$.paymentAssetSymbol') AS payment_asset_symbol,
    JSON_VALUE(TO_JSON_STRING(payload), '$.rail') AS rail,
    JSON_VALUE(TO_JSON_STRING(payload), '$.status') AS status
  FROM `%s.%s.%s`
  WHERE eventFamily IN ('marketplace', 'commerce', 'payment', 'x402', 'contract', 'agent')
)
SELECT
  conversion_date,
  artist_id,
  license_type,
  payment_asset_symbol,
  rail,
  COUNT(*) AS events,
  COUNT(DISTINCT actor_id) AS actors,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(DISTINCT listing_id) AS listings,
  COUNTIF(event_name IN ('marketplace.listing_viewed', 'marketplace.listing_notify')) AS listing_exposures,
  COUNTIF(event_name IN ('commerce.purchase_intent', 'marketplace.purchase_intent', 'x402.challenge')) AS purchase_intents,
  COUNTIF(event_name IN ('commerce.checkout_started', 'x402.verify_started')) AS checkout_starts,
  COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'contract.stem_sold', 'agent.purchase_completed')) AS purchases,
  COUNTIF(event_name IN ('commerce.purchase_failed', 'payment.failed', 'x402.purchase_failed', 'agent.purchase_failed')) AS purchase_failures,
  SUM(IF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'contract.stem_sold', 'agent.purchase_completed'), IFNULL(canonical_amount_usd, 0), 0)) AS gross_revenue_usd,
  SAFE_DIVIDE(
    COUNTIF(event_name IN ('commerce.settled', 'payment.settled', 'x402.purchase', 'contract.stem_sold', 'agent.purchase_completed')),
    NULLIF(COUNTIF(event_name IN ('commerce.purchase_intent', 'marketplace.purchase_intent', 'x402.challenge')), 0)
  ) AS intent_to_purchase_rate,
  CURRENT_TIMESTAMP() AS materialized_at
FROM clean
GROUP BY conversion_date, artist_id, license_type, payment_asset_symbol, rail
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.artist_upload_funnel_daily` AS
WITH upload_events AS (
  SELECT
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS funnel_date,
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    eventName AS event_name,
    eventFamily AS event_family,
    JSON_VALUE(TO_JSON_STRING(payload), '$.step') AS step,
    JSON_VALUE(TO_JSON_STRING(payload), '$.phase') AS phase,
    JSON_VALUE(TO_JSON_STRING(payload), '$.status') AS status,
    LOWER(JSON_VALUE(TO_JSON_STRING(payload), '$.route')) AS route
  FROM `%s.%s.%s`
  WHERE eventFamily IN ('artist', 'catalog', 'stems', 'ingestion', 'rights', 'release_rights', 'ipnft', 'generation')
)
SELECT
  funnel_date,
  artist_id,
  COUNT(*) AS events,
  COUNT(DISTINCT actor_id) AS actors,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(DISTINCT release_id) AS releases,
  COUNTIF(event_name = 'artist.upload_step_completed') AS upload_steps_completed,
  COUNTIF(event_name = 'stems.uploaded') AS stems_uploaded,
  COUNTIF(event_name = 'stems.processed') AS stems_processed,
  COUNTIF(event_name = 'stems.failed') AS stems_failed,
  COUNTIF(event_name = 'catalog.release_ready') AS releases_ready,
  COUNTIF(event_name = 'rights.route_decided' AND route IN ('standard', 'standard_escrow', 'trusted_fast_path')) AS marketplace_ready_routes,
  COUNTIF(event_name = 'rights.route_decided' AND route IN ('limited', 'quarantined', 'blocked')) AS restricted_routes,
  COUNTIF(status IN ('failed', 'error')) AS failed_status_events,
  ARRAY_AGG(DISTINCT step IGNORE NULLS LIMIT 20) AS observed_steps,
  ARRAY_AGG(DISTINCT phase IGNORE NULLS LIMIT 20) AS observed_phases,
  CURRENT_TIMESTAMP() AS materialized_at
FROM upload_events
GROUP BY funnel_date, artist_id
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.product_event_daily_metrics` AS
WITH clean AS (
  SELECT
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS metric_date,
    eventFamily AS event_family,
    eventName AS event_name,
    producer,
    environment,
    privacyTier AS privacy_tier,
    CAST(actorId AS STRING) AS actor_id,
    CAST(sessionId AS STRING) AS session_id,
    CAST(trackId AS STRING) AS track_id,
    CAST(artistId AS STRING) AS artist_id,
    CAST(releaseId AS STRING) AS release_id,
    source
  FROM `%s.%s.%s`
)
SELECT
  metric_date,
  event_family,
  event_name,
  producer,
  environment,
  privacy_tier,
  source,
  COUNT(*) AS events,
  COUNT(DISTINCT actor_id) AS actors,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(DISTINCT track_id) AS tracks,
  COUNT(DISTINCT artist_id) AS artists,
  COUNT(DISTINCT release_id) AS releases,
  CURRENT_TIMESTAMP() AS materialized_at
FROM clean
GROUP BY metric_date, event_family, event_name, producer, environment, privacy_tier, source
""", target_project, target_dataset, target_project, target_dataset, clean_table);

EXECUTE IMMEDIATE FORMAT("""
CREATE OR REPLACE TABLE `%s.%s.analytics_fact_coverage_daily` AS
WITH clean AS (
  SELECT
    COALESCE(SAFE_CAST(occurredDate AS DATE), DATE(SAFE_CAST(occurredAt AS TIMESTAMP))) AS coverage_date,
    eventFamily AS event_family,
    eventName AS event_name,
    eventId AS event_id,
    actorId,
    sessionId,
    trackId,
    artistId,
    releaseId
  FROM `%s.%s.%s`
),
facts AS (
  SELECT
    eventId AS event_id
  FROM `%s.%s.%s`
)
SELECT
  coverage_date,
  event_family,
  event_name,
  COUNT(*) AS clean_events,
  COUNTIF(facts.event_id IS NOT NULL) AS fact_rows,
  COUNTIF(actorId IS NULL) AS missing_actor_id,
  COUNTIF(sessionId IS NULL) AS missing_session_id,
  COUNTIF(event_family IN ('playback', 'commerce', 'marketplace', 'rights') AND releaseId IS NULL) AS missing_expected_release_id,
  COUNTIF(event_family IN ('playback', 'commerce', 'marketplace') AND trackId IS NULL) AS missing_expected_track_id,
  COUNTIF(event_family IN ('playback', 'commerce', 'marketplace', 'rights') AND artistId IS NULL) AS missing_expected_artist_id,
  SAFE_DIVIDE(COUNTIF(facts.event_id IS NOT NULL), COUNT(*)) AS clean_to_fact_rate,
  CURRENT_TIMESTAMP() AS materialized_at
FROM clean
LEFT JOIN facts USING (event_id)
GROUP BY coverage_date, event_family, event_name
""", target_project, target_dataset, target_project, target_dataset, clean_table, target_project, target_dataset, facts_table);
