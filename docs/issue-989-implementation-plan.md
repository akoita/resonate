# Issue #989 Implementation Plan

## Goal

Prepare Agent Taste Intelligence materialization for GCP-native orchestration
with Dataform, while keeping the current manual BigQuery runner available for
operator-triggered backfills and emergency reruns.

## First Slice

1. Add a Dataform-ready workflow template that maps the current baseline into
   dependency-aware actions:
   - `track_intelligence_features`
   - `user_track_signal_training`
   - `user_track_recommendation_scores`
   - score freshness, schema, and bounds assertions
2. Document the target Scheduler -> Workflows -> Dataform execution path and
   the `resonate-iac` handoff requirements.
3. Document the serving split:
   - streaming ingestion for canonical analytics events
   - nearline/batch Dataform materialization for durable taste
   - realtime session memory for immediate AI DJ adaptation
4. Add static tests that keep the Dataform templates aligned with the serving
   table contract and the existing manual SQL runner.

## Non-Goals

- Do not add Terraform resources in this app repository.
- Do not remove the manual `bq` runner.
- Do not enable BigQuery-backed taste signals by default.
- Do not implement realtime `AgentSignal` feedback; that remains a separate
  product/runtime slice.

## Validation

- `cd workers/analytics-dataflow && python3 -m unittest test_agent_taste_sql.py`
- `cd workers/analytics-dataflow && python3 -m unittest test_analytics_transform.py`
- `git diff --check`
