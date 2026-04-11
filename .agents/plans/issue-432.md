# Issue 432 Plan

## Goal

Start Sprint 4 by defining a safe, incremental DAO-jury implementation for complex
content disputes that fits the existing `DisputeResolution` flow without trying to
ship full Kleros integration in one step.

## Scope

- Extend the on-chain dispute model so an admin-reviewed dispute can be escalated
  into jury arbitration instead of being resolved only by the owner.
- Introduce a first-party DAO jury path before external Kleros wiring:
  juror eligibility, jury selection, voting, and finalization.
- Add backend support for jury-duty notifications, dispute escalation metadata, and
  vote aggregation/read APIs needed by the UI.
- Add frontend juror-facing views for assigned cases and a visible arbitration
  timeline inside the dispute experience.

## Working Assumptions

- The practical first milestone is a Resonate-native DAO jury, not direct Kleros
  integration. The issue text allows either path, and the RFC explicitly calls the
  DAO jury simpler to implement first.
- Existing Phase 3 dispute plumbing should remain intact: filed -> evidence ->
  under review -> resolved/appealed. Jury arbitration should layer onto that flow
  rather than replace it outright.
- This sprint is too large for one blind implementation pass. The safest delivery
  sequence is contract and data model first, then backend orchestration, then UI.
- Jury selection should use an auditable pseudo-random mechanism available in the
  current stack; if stronger randomness is needed later, that can be a follow-up.

## Planned Changes

1. Audit current dispute, reward, and appeal contracts plus RFC constraints, then
   define the minimum arbitration state machine that can coexist with
   `DisputeResolution`.
2. Add contract-level arbitration primitives:
   escalation entrypoint, juror pool/eligibility, juror assignment, vote casting,
   supermajority resolution, and juror incentive/slash accounting.
3. Update contract tests to cover escalation, jury assignment, voting outcomes,
   integration with existing dispute outcomes, and appeal behavior.
4. Add backend persistence/APIs for arbitration status, assigned jurors, vote
   summaries, and notification triggers.
5. Add frontend juror dashboard and dispute timeline updates for arbitration state.
6. Verify end-to-end behavior across contracts, backend, and web surfaces before
   opening a PR.

## Verification

- `cd contracts && forge test`
- Targeted backend tests for new arbitration/dispute flows
- Targeted web tests or lint/build validation for new dispute UI surfaces

## Risks

- The contract/API boundary may need to move if vote aggregation is partly on-chain
  and partly indexed off-chain.
- Juror randomness and incentive design can create security gaps if rushed.
- Kleros-specific abstractions should not leak into the first DAO-jury milestone
  unless there is a clear adapter boundary.
