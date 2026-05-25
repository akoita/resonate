# Analytics Warehouse SQL

This directory contains post-Dataflow BigQuery SQL for derived analytics tables.
The streaming Dataflow processor writes the canonical raw, clean, fact, view,
and quarantine layers. SQL here materializes downstream feature tables that are
too product-specific to belong in the generic stream transform.

## Future Report Marts

Run `future_report_marts.sql` after `events_clean` and `analytics_facts` are
populated. The script creates report-ready marts for product and annual-summary
work:

| Table | Purpose |
| --- | --- |
| `listener_session_summary` | Session duration, heartbeat-derived listening time, saves/playlists, purchases, and first track sequence per pseudonymous listener session. |
| `listener_daily_activity` | Daily listener activity, distinct tracks/artists/releases, listening seconds, purchases, and repeat-play indicators. |
| `listener_track_affinity` | Per-listener track affinity signals from plays, saves, purchases, replay days, and completion ratios. |
| `listener_replay_bursts` | Repeat bursts and extreme replay candidates for passion, abuse, or recommendation analysis. |
| `listener_cohort_catalog_rankings` | Top tracks, artists, and releases by stable pseudonymous listener cohort. |
| `artist_catalog_daily_metrics` | Artist-owned catalog plays, unique listeners, revenue, saves, and content-protection route health. |
| `discovery_playlist_play_funnels` | Search-to-play, playlist-to-play, and marketplace-to-play session conversion. |
| `marketplace_conversion_daily` | Listing exposure, purchase intent, checkout, purchase, failure, and revenue conversion by day and dimensions. |
| `artist_upload_funnel_daily` | Upload, stem processing, release-ready, and rights-route funnel health for artists. |
| `product_event_daily_metrics` | General event-family/event-name adoption and coverage metrics for product analytics. |
| `analytics_fact_coverage_daily` | Clean-to-fact coverage and missing key identifier signals for warehouse quality checks. |

Dry-run example:

```bash
bq query --use_legacy_sql=false --dry_run < workers/analytics-dataflow/sql/future_report_marts.sql
```

## Agent Taste Intelligence

Run order:

1. `future_report_marts.sql` for broad report marts.
2. `agent_taste_intelligence_baseline.sql` for recommendation-serving taste
   scores.
3. Optional, after enough feedback exists: `agent_taste_intelligence_bqml.sql`

The baseline script creates:

| Table | Purpose |
| --- | --- |
| `track_intelligence_features` | Track-level interaction features from `events_clean`. |
| `user_track_signal_training` | Event-level implicit-feedback rows with signed weights. |
| `user_track_recommendation_scores` | Serving table consumed by `AgentBigQueryTasteSignalService`. |

The BQML script creates a matrix-factorization model and writes
`user_track_recommendation_scores_bqml`. Promote it to
`user_track_recommendation_scores` only after offline recommendation evals
approve the output.

The backend serving query is intentionally bounded by one `userId` and the
candidate `trackIds` already found by catalog search. These SQL jobs can be
scheduled independently without changing the recommendation API contract.
