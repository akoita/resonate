# Vision Sprint 20: Trustworthy player action telemetry

**Status:** in progress; local implementation complete, staging verification pending.
**Milestone:** [22](https://github.com/akoita/resonate/milestone/22).
**Scope:** [#1732](https://github.com/akoita/resonate/issues/1732) only.
**Window:** no due date; capacity has not been agreed.

## Goal

Reconcile player action events across frontend, backend, and analytics schemas
so authenticated listening activity is accepted and recorded once.

This is vision-neutral analytics quality (`vision:keep`); ADR-BM-6 revenue
flows, prices, and payouts remain unchanged. Sprint 19 has no unfinished
assigned issues; #1732 is a separately tracked defect discovered during its
staging verification. No prerequisite is declared for this issue.

## Implementation and validation

1. Accept both player action event names in the backend controller; require a
   track subject, validate bounded action keys/statuses, and strip free text.
2. Preserve one event identity on retries, scoped to actor, session, and track.
3. Register versioned schemas and shared warehouse fixtures; retain action
   dimensions in the backend export and Dataflow transform.
4. Run focused HTTP, instrumentation, schema, and warehouse tests, the Dataflow
   transform tests, backend type checking, and a diff security review.
5. After publication and deployment, verify a real authenticated staging
   impression succeeds and is not duplicated. Keep #1732 open until this passes.

## Exit criteria

- Both events pass authenticated HTTP contract coverage; malformed payloads
  and unauthenticated requests are rejected.
- Accepted payloads contain only action keys/statuses and the fixed source;
  actor identity comes from authentication.
- Retry tests prove one ledger event without collapsing distinct actors,
  tracks, sessions, event kinds, or new deliberate actions.
- Shared fixtures pass both warehouse transforms with zero added listening
  or revenue counts.
- Real staging evidence records the deployed revision, accepted impression,
  and absence of duplicates for unchanged action-panel state.

## Boundaries

The observable product outcome is reliable measurement of existing player
actions. The work serves product decisions, developer diagnostics, and a known
defect; no new-feature investigation is included in this small milestone.

Release Access, production billing, migration/release evidence, and production
go-live remain outside this milestone. Publication and deployment are separate
steps; no live verification or milestone completion is claimed by local tests.

## Local verification

- Backend: `npm test -- --runTestsByPath src/tests/analytics.controller.http.spec.ts src/tests/analytics_event.spec.ts src/tests/analytics_warehouse.spec.ts src/tests/analytics_instrumentation.spec.ts`
  passed 79 tests across four suites. The HTTP retry test uses real
  instrumentation and an in-memory event store; it is not a Postgres or
  staging persistence check.
- Dataflow: `python -m unittest test_analytics_transform.py` passed 14 tests
  from `workers/analytics-dataflow`.
- Backend `npm run lint` (TypeScript checking), documentation link checks,
  and `git diff --check` passed.
- Diff security review covered authentication, payload filtering, actor-scoped
  event identity, and downstream fact handling; no actionable finding.
- Broad integration and frontend suites are deferred to CI; the browser
  producer and database schema are unchanged.
