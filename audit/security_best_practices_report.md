# Security Best Practices Report

## Executive Summary

This review covers the Agent Taste offline BigQuery ML evaluation changes in
#978, including backend replay comparison artifacts, BigQuery comparison SQL,
and documentation for promotion gates. No Critical, High, Medium, or Low
findings were identified; the changes are offline/operator tooling only and do
not expose new runtime endpoints, secrets, or per-user product UI surfaces.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None.

## Informational Notes

### SBPR-001: Offline Eval Artifacts Stay Local And Reproducible

**File:** `backend/src/modules/agents/agent_recommendation_eval.service.ts`

The new model-comparison path ranks deterministic, warehouse-baseline, and BQML
fixtures in-process and writes JSON/Markdown artifacts under `eval-results/`.
It does not require production credentials and does not add any network calls.

### SBPR-002: BigQuery Comparison SQL Uses Query Parameters

**File:** `workers/analytics-dataflow/sql/agent_taste_intelligence_bqml_eval.sql`

The comparison template declares project, dataset, source table, destination
table, version, top-k, and promotion thresholds as BigQuery parameters. It keeps
BQML output in a staging comparison table and does not promote it into the
serving table automatically.

### SBPR-003: Promotion Decision Is Explicit

**File:** `docs/features/agent_taste_intelligence.md`

The feature documentation now requires review of both backend replay artifacts
and the warehouse comparison table before promoting or blending the BQML
challenger into `user_track_recommendation_scores`.

### SBPR-004: No Infrastructure Or Secret Surface Added

**File:** `docs/issue-978-implementation-plan.md`

The implementation plan records that no `resonate-iac` changes are required for
this issue. The new SQL is a manual operator/backfill comparison path and does
not introduce new deployed environment variables or scheduled resources.

## Review Commands

```bash
rg '(SECRET|PRIVATE_KEY|API_KEY|TOKEN|PASSWORD|BEGIN [A-Z ]*PRIVATE KEY|AIza|sk-|xoxb-|ghp_|github_pat_)' backend/src/modules/agents/agent_recommendation_eval.service.ts backend/src/tests/agent_recommendation_eval.spec.ts workers/analytics-dataflow/sql/agent_taste_intelligence_bqml_eval.sql docs/issue-978-implementation-plan.md docs/features/agent_taste_intelligence.md workers/analytics-dataflow/sql/README.md docs/features/README.md
rg '\$queryRaw|\$executeRaw|queryRaw|executeRaw|eval\(|new Function|dangerouslySetInnerHTML|innerHTML|document\.cookie|localStorage\.setItem' backend/src/modules/agents/agent_recommendation_eval.service.ts backend/src/tests/agent_recommendation_eval.spec.ts workers/analytics-dataflow/sql/agent_taste_intelligence_bqml_eval.sql docs/issue-978-implementation-plan.md docs/features/agent_taste_intelligence.md workers/analytics-dataflow/sql/README.md docs/features/README.md
```
