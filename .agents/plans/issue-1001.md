# Issue #1001 Plan: Taste Cohorts

## Goal

Implement the first safe, opt-in taste cohort slice for the Listener Community
Network. Cohorts should feel explainable and useful without exposing private
listening, wallet, location, or ownership facts about other listeners.

## Feature-Complete Delivery Map

Issue #1001 is not complete until all slices below are either implemented or
explicitly moved to a named follow-up issue with rationale.

### Slice 1: Backend Cohort Contract

Status: `in-progress` in PR #1051.

1. Add backend persistence:
   - `CommunityCohort`
   - `CommunityCohortMembership`
   - indexes for status/type/expiry and user membership lookups
2. Add backend service/controller surface:
   - `GET /community/cohorts/suggestions`
   - `POST /community/cohorts/:cohortId/join`
   - `POST /community/cohorts/:cohortId/leave`
   - `POST /community/cohorts/:cohortId/hide`
3. Enforce privacy and lifecycle rules:
   - suggestions require `allowTasteMatching` for taste/artist/collector/campaign cohorts;
   - city-scene cohorts require `allowCityScenes`;
   - cohorts below minimum size are not suggested;
   - expired/archived cohorts are hidden from suggestions and cannot be joined;
   - explanations use cohort-level labels and counts, not raw per-user facts.
4. Add compact analytics events:
   - `community.cohort_suggested`
   - `community.cohort_joined`
   - `community.cohort_left`
   - `community.cohort_hidden`
5. Update docs:
   - feature catalog
   - Listener Community Network feature page
   - architecture/execution plan status notes
   - security/audit note because this touches privacy and social discovery

### Slice 2: Listener Cohort UI

Status: `not-started`.

Build the listener-facing cohort surface so the backend contract becomes useful
inside the app:

1. Add cohort cards with title, safe explanation, member count label, and status.
2. Add join, leave, and hide controls with loading/error/success states.
3. Add empty, disabled-consent, expired, and all-hidden states.
4. Add entry points from listener/community surfaces, not only direct API use.
5. Add frontend tests for suggestion rendering, join, leave, hide, and hidden
   state persistence.

### Slice 3: Cohort Generation Worker

Status: `not-started`.

Materialize cohorts from safe aggregate signals rather than manual seed data:

1. Define source inputs from taste memory, analytics materializations, catalog
   metadata, campaign/show support, collector behavior, and coarse city-scene
   signals.
2. Read from warehouse/materialized analytics tables for taste and behavioral
   signals, with transactional DB reads only for current consent/profile state
   and durable product entities.
3. Generate candidate cohorts with reason codes and safe explanations.
4. Enforce `minimumSize` before writing any user-visible cohort or membership.
5. Write `CommunityCohort` and `CommunityCohortMembership` rows as the API
   serving layer.
6. Record generation metadata such as source version, materialization version,
   signal window, and generated-at timestamp in cohort metadata.
7. Add tests for minimum-size rejection, consent filtering, safe explanations,
   and deterministic fixtures.

### Slice 4: Cohort Lifecycle And Refresh

Status: `not-started`.

Keep generated cohorts fresh and reversible:

1. Expire stale cohorts automatically.
2. Refresh cohorts on a schedule without resurrecting hidden memberships.
3. Preserve joined/left/hidden user intent across refreshes.
4. Archive cohorts when source signals fall below threshold.
5. Add cleanup jobs and tests for expiry, archival, and refresh behavior.

### Slice 5: Operator Quality And Analytics

Status: `not-started`.

Make the feature observable before broader rollout:

1. Track cohort funnel metrics: suggested, joined, left, hidden, disabled-consent,
   below-threshold rejects, and stale cohorts.
2. Add aggregate quality metrics by cohort type and reason code.
3. Ensure analytics never expose other listener identities, raw listening
   histories, exact private counts, wallet data, or fine location.
4. Document rollback and kill-switch behavior for cohort generation.
5. Add operational validation commands to the finish checklist for this feature.

## Deliberate Deferrals

- No graph database yet.
- Automated cohort generation is deferred only from Slice 1. It remains required
  for #1001 feature completion unless moved to a named follow-up issue.
- Full frontend cohort discovery is deferred only from Slice 1. It remains
  required for #1001 feature completion unless moved to a named follow-up issue.
- No Discord bridge or city-scene public pages.

## Validation

- Backend integration tests for consent-gated suggestions, minimum-size
  filtering, safe explanations, join/leave/hide, expired/archived states, and
  off-chain membership mutability.
- Controller HTTP tests for routes and auth boundaries if the controller shape
  is non-trivial.
- `cd backend && npx tsc --noEmit --pretty false`
- Focused backend lint/type gate.
- `git diff --check`
