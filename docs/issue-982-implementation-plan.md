# Issue #982 Implementation Plan

## Goal

Add an aggregate AI DJ recommendation quality report so operators can see
whether analytics-powered taste intelligence is improving or hurting session
outcomes.

## Scope

1. Add a backend analytics report endpoint for AI DJ quality metrics.
   - Source from existing analytics facts/export layers so it works with both
     BigQuery report mode and local development fallback.
   - Keep the report aggregate-only: no raw listener histories, actor ids, wallet
     addresses, or per-user rows.
   - Include session starts, next-pick requests, intent selections, acceptance,
     first-pick skip/completion proxies, saves, playlist adds, purchases,
     session duration, and version/freshness context when present.

2. Add a frontend analytics surface.
   - Reuse the existing analytics visual language and day-window control.
   - Show KPI cards, trend/freshness metadata, intent/preset outcomes, strategy
     and taste-source breakdowns, and model/materialization version coverage.

3. Update feature documentation.
   - Document the report route, source tables, privacy boundary, and how to
     validate it locally.
   - Update the Agent Taste Intelligence roadmap/status entry.

4. Verify with focused tests.
   - Backend unit/HTTP tests for aggregate calculations and authorization.
   - Frontend render tests for loading, empty, and populated states.

## Non-Goals

- No model promotion logic.
- No new BigQuery dataset or Scheduler/Dataform infrastructure.
- No raw user-level drilldown.
