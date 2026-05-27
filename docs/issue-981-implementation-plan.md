# Issue #981 Implementation Plan

## Goal

Materialize AI DJ taste scores from existing analytics events into the
`user_track_recommendation_scores` serving contract consumed by
`AgentBigQueryTasteSignalService`.

## First Slice

1. Parameterize the baseline BigQuery SQL so operators do not edit project or
   dataset literals before running it.
2. Add a repeatable `bq` runner that resolves project, dataset, clean-table,
   and score-table values from existing analytics/agent environment variables.
3. Expand the baseline signal set to include playback completion, inferred
   short-play skips, repeat/replay behavior, saves, playlist adds, commerce,
   payment, x402, agent purchases, and agent/session intent context.
4. Add verification queries for score freshness and coverage.
5. Add local tests that validate the SQL contract and parameterized runner
   without requiring BigQuery credentials.

## Non-Goals

- Do not enable BigQuery-backed taste signals by default.
- Do not change the online selector fallback behavior.
- Do not promote BigQuery ML output; that remains #978.
- Do not introduce scheduled infrastructure in this app repo.

## Validation

- `cd workers/analytics-dataflow && python3 -m unittest test_agent_taste_sql.py`
- `cd workers/analytics-dataflow && python3 -m unittest test_analytics_transform.py`
- `cd backend && npx jest --runInBand src/tests/agent_bigquery_taste_signal.spec.ts`
- `git diff --check`
