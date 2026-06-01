# Issue #1001 Plan: Taste Cohorts

## Goal

Implement the first safe, opt-in taste cohort slice for the Listener Community
Network. Cohorts should feel explainable and useful without exposing private
listening, wallet, location, or ownership facts about other listeners.

## First Slice Scope

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

## Deliberate Deferrals

- No graph database yet.
- No automated cohort generation job in this slice; seed/test-created cohorts
  are enough to prove contracts, privacy gates, and user actions.
- No full frontend cohort discovery UI until the backend contract is stable.
  A follow-up can add cards/settings entry points.
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

