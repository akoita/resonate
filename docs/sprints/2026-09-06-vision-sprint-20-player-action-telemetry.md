# Vision Sprint 20: Trustworthy player action telemetry

**Status:** closed; authenticated staging exit verified on 2026-09-06.
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
- Broad integration and frontend validation ran in PR/release CI and passed;
  the browser producer and database schema are unchanged.

## Staging outcome

PR [#1734](https://github.com/akoita/resonate/pull/1734) merged as
`864e26fdd51f6a4264a2112b5e8509c907197d07`. The milestone was initially closed
with verification outstanding; the real staging checks subsequently passed.

- [Release publication](https://github.com/akoita/resonate/actions/runs/33999597442)
  published immutable backend/frontend images for that exact source after
  all release CI gates passed.
- [Staging deployment](https://github.com/akoita/resonate-iac/actions/runs/34000263221)
  rolled out backend revision `resonate-staging-backend-00007-9mf` and frontend
  revision `resonate-staging-frontend-00005-v5h`. Their image digests matched
  the retained release manifest; `/api/version` reported `864e26fdd51f`.
- A listener authenticated through the normal nonce/signature flow. The live
  browser emitted one `player.action_impression` with HTTP 201 across unchanged
  action state and a viewport resize. Replaying its client event retained
  `evt_08d81c603b3e051530c2c2c79dace167` without increasing the live ledger count.
- Clicking **Add to playlist** emitted `player.action_selected` with HTTP 201
  (`evt_3401855e645e61fdf44541d8bcce4eba`). No playlist was created or changed.
  Unauthenticated and malformed-action probes returned 401 and 400 respectively.

The staging project had no active Dataflow job to update. Publishing its
updated template exposed an independent certificate-identity mismatch in
[run 33999598703](https://github.com/akoita/resonate/actions/runs/33999598703),
addressed by [PR #1735](https://github.com/akoita/resonate/pull/1735). This does
not change the verified browser-to-ledger result or imply streaming-pipeline
activation. The next milestone has not been selected.
