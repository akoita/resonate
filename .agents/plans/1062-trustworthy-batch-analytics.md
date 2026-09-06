# Sprint 21 — Trustworthy batch analytics

Approved milestone: GitHub #23. Execute #1062 before #932. Vision-neutral
analytics quality; no fee, payout, or production policy changes.

Route: user explicitly selected gpt-6-astra Light/low, solo. Latest persisted
turn context confirms that route. Standard Maestro preflight rejects changed
historical routing metadata; the user's explicit override governs this task.

## Implementation plan

1. Audit backend ledger export/load and Dataflow transformations. Add shared
   cross-runtime parity coverage for all supported fixture families, identity,
   geo, privacy, malformed/unsupported events, and duplicate delivery.
2. Correct transform drift and local incremental view materialization. Keep
   daily totals derived from unique facts instead of retaining stale snapshots.
3. Add an opt-in BigQuery transactional batch target with bounded input,
   durable event/fact keys, atomic layer writes, and daily views recomputed from
   unique facts. Preserve the existing streaming writer and migration boundary.
4. Document the execution modes, safe serialized loading, switch/rollback,
   limits, and current validation status. Update feature catalog and sprint doc.
5. Run focused backend export/loader and persistence tests, Dataflow tests,
   backend type checking, and diff/security review. Validate BigQuery SQL in a
   disposable staging dataset if credentials allow, without changing live mode.
6. Verify existing staging report behavior for #932; retain any remaining
   deployment-dependent acceptance explicitly until the new branch ships.

## Risks and checks

- Existing insertAll streaming buffers can reject DML: switch only after
  pausing writers and draining buffers; failures must not report success.
- Concurrent first inserts cannot rely on BigQuery uniqueness constraints:
  transactional batch loads must be serialized by the caller/operator.
- No private event data in logs or validation artifacts; use synthetic fixtures
  for disposable cloud tests and normal authentication for browser checks.
- No production launch or always-on Dataflow activation.

## Local outcome

Implementation is ready for publication review. App changes are on
`feat/1062-trustworthy-batch-analytics`; companion configuration is isolated in
`/tmp/resonate-iac-sprint21` on `feat/1062-batch-warehouse-target`. The original
IaC checkout and its unrelated edits were preserved.

Validated:

- Focused backend warehouse/event/batch/parity unit suites passed; the added
  local redaction/view-refresh regression also passed.
- Two real Postgres tests passed: cross-instance advisory locking with release
  after failure, and bounded ledger export preserving coarse geography.
- Fifteen Dataflow transform tests passed, including event-scoped streaming
  view insert IDs that do not collapse distinct events in the same group.
- The opt-in external BigQuery test passed in an isolated dataset copied from
  current staging schemas. Sequential retries and overlapping loads retained
  two unique facts/two plays; injected invalid data rolled back earlier layer
  mutations. Cleanup deleted the temporary dataset.
- Backend TypeScript checking passed. Terraform recursive format checking,
  staging validation, documentation links, and both repo diff checks passed.
- Diff security review covered admin-only maintenance entry points, parameterized
  SQL, identifier/schema validation, load bounds, atomicity, advisory locking,
  credentials, and IAM. No unresolved actionable finding. No dependency or
  workflow permission changes.

Full unrelated suites and dev/prod Terraform validation remain CI checks.
No user-facing UI changed, so the User Guide/screenshots are unchanged.
No live execution-mode change, deployment, issue closure, or publication was
performed. #932 still requires normal authenticated artist-dashboard evidence
against the deployed transactional batch path. Historical warehouse deletion
reconciliation remains an explicit broader #881 limitation, not silently solved.
