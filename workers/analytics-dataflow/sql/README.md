# Analytics Warehouse SQL

This directory contains post-Dataflow BigQuery SQL for derived analytics tables.
The streaming Dataflow processor writes the canonical raw, clean, fact, view,
and quarantine layers. SQL here materializes downstream feature tables that are
too product-specific to belong in the generic stream transform.

## Agent Taste Intelligence

Run order:

1. `agent_taste_intelligence_baseline.sql`
2. Optional, after enough feedback exists: `agent_taste_intelligence_bqml.sql`

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
