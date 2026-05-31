# Issue #978 Implementation Plan

## Goal

Evaluate BigQuery ML recommendation scores against the current deterministic
selector and warehouse baseline before any BQML table is promoted into the
serving contract.

## Scope

- Add reproducible offline comparison fixtures for deterministic, warehouse
  baseline, and BigQuery ML candidate scores.
- Extend the backend recommendation eval service so it can rank model variants,
  compute promotion metrics, and write JSON plus Markdown artifacts.
- Add a BigQuery SQL comparison template that writes evaluation metrics to a
  staging/comparison table instead of promoting ML output directly.
- Document promotion criteria and the manual-to-managed run flow in Agent Taste
  feature docs and analytics SQL docs.
- Keep the work local-safe: no production secrets, no hardcoded project or
  dataset ids, and no required infrastructure changes.

## Promotion Criteria

BQML can be promoted only when the comparison output shows it beats the
warehouse baseline on acceptance proxy, skip avoidance, listing coverage,
explanation coverage, and overall score without regressing diversity or novelty
below configured thresholds. Otherwise it should remain in staging or be blended
behind the deterministic selector.

## Validation

- `cd backend && npx jest --runInBand src/tests/agent_recommendation_eval.spec.ts`
- `cd workers/analytics-dataflow && python -m unittest test_agent_taste_sql.py`
- `cd backend && npm run lint`
- Security scan review for backend eval-service changes.

## Infrastructure

No `resonate-iac` change is expected for this issue. The new SQL is a manual
operator/backfill comparison path and does not introduce new deployed
environment variables or scheduled resources.
