# Issue #492 Plan

Branch: `feat/492-release-rights-upgrade-flow`
Issue: [#492](https://github.com/akoita/resonate/issues/492)

## Goal

Turn the current passive `LIMITED_MONITORING` / `NEEDS_PROOF_OF_CONTROL` restriction into a production workflow where a creator can submit a rights-upgrade request for a release, ops can review it, and the release route can be promoted or kept restricted with visible status.

## Current State

- Release pages already surface the current rights route, flags, and content-protection signals.
- `#471` added typed rights evidence bundles and release/dispute evidence storage.
- Marketplace mint/list actions are correctly blocked when the route disallows them.
- There is no creator-facing CTA or review lifecycle for "unlock marketplace rights".
- There is no release-scoped review entity or ops decision endpoint yet.

## Proposed Scope

### 1. Backend review model

- Add a first-class release rights-upgrade request model to Prisma.
- Suggested fields:
  - `id`
  - `releaseId`
  - `artistId`
  - `requestedByAddress`
  - `status`
  - `requestedRoute`
  - `currentRouteAtSubmission`
  - `summary`
  - `decisionReason`
  - `reviewedBy`
  - `reviewedAt`
  - `createdAt`
  - `updatedAt`
- Statuses:
  - `submitted`
  - `under_review`
  - `more_evidence_requested`
  - `approved_standard_escrow`
  - `approved_trusted_fast_path`
  - `denied`

### 2. Backend creator submission flow

- Add an authenticated release-scoped submission endpoint, likely under `metadata` or a dedicated rights controller.
- Validate:
  - caller owns the release
  - release route is currently restricted
  - a duplicate open request does not already exist
- Reuse the typed evidence bundle system from `#471`:
  - create a release-scoped request record
  - attach release evidence bundle(s) with creator role
  - persist summary and requested outcome

### 3. Backend review actions

- Add admin/ops endpoints to:
  - list pending rights-upgrade requests
  - inspect a single request with linked release + evidence
  - mark under review
  - request more evidence
  - approve to `STANDARD_ESCROW`
  - approve to `TRUSTED_FAST_PATH`
  - deny / keep restricted
- Approval should update the release rights route and related flags/reason through a safe service path rather than an ad hoc DB write.

### 4. Release page UX

- Add an `Unlock Marketplace Rights` CTA when:
  - the user owns the release
  - the route is restricted for marketplace actions
- Add a modal / stepper that:
  - explains why the release is restricted
  - explains what evidence is accepted
  - collects a structured release-scoped submission
- Reuse the typed evidence input patterns from the dispute flow where possible, but frame them for creator proof-of-control instead of reporter claims.

### 5. Visible review status

- Show request/review status in:
  - the rights route banner
  - the content-protection section
  - the NFT marketplace section
- Example user-facing states:
  - `Submitted`
  - `Under Review`
  - `More Evidence Needed`
  - `Approved: Standard Escrow`
  - `Approved: Trusted Fast Path`
  - `Denied`

### 6. Ops UI

- Start with a lightweight admin queue, likely extending the current disputes/admin surfaces or adding a focused release-rights review view.
- Must show:
  - release identity
  - current route and flags
  - creator human-verification status
  - typed evidence bundle(s)
  - recommended route options
  - reviewer notes / decision input

## Implementation Order

1. Prisma schema + migration for release rights-upgrade requests
2. backend submission + fetch endpoints
3. backend review decision endpoints and route-update service path
4. release-page creator CTA + submission modal
5. release-page review-status display
6. lightweight ops/admin review queue
7. targeted tests for submission, authorization, approval, and route updates

## Key Risks

- We should not let creator submission directly override routes without review.
- Review actions must avoid silently dropping existing restrictive flags that still matter.
- The creator evidence flow must be authenticated and bound to release ownership.
- We should avoid conflating:
  - human verification
  - provenance / attestation
  - proof-of-control submission
  - final rights review outcome

## Validation Plan

- Creator on `LIMITED_MONITORING` sees an `Unlock Marketplace Rights` CTA.
- Creator submits a structured request with typed evidence.
- Request becomes visible in the release UI as `Submitted` / `Under Review`.
- Admin can approve to `STANDARD_ESCROW` or `TRUSTED_FAST_PATH`.
- Approval enables marketplace mint/list actions without a re-upload.
- Denial keeps restrictions in place and shows a reason.
- Existing restricted releases remain streamable/readable as before.

## Out Of Scope For This Issue

- automatic rights approval based purely on human verification
- external catalog-provider integrations beyond current trusted-source logic
- full jury / dispute redesign
- payout release automation beyond route/state changes already governed elsewhere
