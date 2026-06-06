# Issue #1072 Implementation Plan

## Goal

Make joined listener cohorts an additive, privacy-safe discovery signal for
recommendations and AI DJ picks. A listener who has joined eligible cohorts
should see better-ranked suggestions and safe explanations such as "From your
Alternative listeners cohort" without exposing other listeners, exact cohort
membership, wallets, or raw listening histories.

## Current Baseline

- `CommunityCohortService` already gates visible cohorts by authenticated user,
  membership status, cohort status, expiry, minimum visible size, and
  `CommunityVisibilitySettings` consent.
- Cohort membership already supports `suggested`, `joined`, `left`, and
  `hidden`, with events for suggested, joined, left, and hidden actions.
- Cohort detail already exposes safe labels, bucketed counts, redaction copy,
  and actions that point listeners toward marketplace and AI DJ surfaces.
- `RecommendationsService` currently ranks catalog tracks from explicit
  preferences, taste memory policy, recent track avoidance, and catalog
  recency, then emits `recommendation.generated`.
- `AgentSelectorService` already adds explainable AI DJ ranking signals from
  query matches, learned genre weights, optional BigQuery taste scores, audio
  features, listings, and recent track penalties.
- Frontend AI DJ cards already render explanation pills from backend pick
  payloads. Listener cohort UI already renders safe cohort copy and joined room
  states.
- Feature docs already describe listener taste memory, agent taste
  intelligence, and the Listener Community Network, but they do not yet define
  cohort-influenced discovery as a runtime capability.

## First Slice

1. Add a backend cohort-discovery context selector:
   - return only joined memberships for the authenticated listener;
   - require active/suggested, unexpired cohorts that meet minimum visible size;
   - require current listener consent for the cohort type;
   - exclude hidden, left, archived, expired, below-threshold, stale, and
     consent-disabled cohorts;
   - expose only bounded context: cohort id, type, safe title, safe reason code,
     safe explanation label, and small query/scoring hints derived from cohort
     metadata.
2. Wire cohort context into `RecommendationsService`:
   - add modest additive boosts for candidate tracks that match safe cohort
     hints such as genre, mood, artist affinity, scene, collector, or campaign
     labels;
   - keep explicit preferences and taste memory policy stronger than cohort
     context so cohorts do not become filter bubbles;
   - include safe item-level reasons when cohort context influenced a selected
     recommendation.
3. Wire cohort context into AI DJ selection:
   - pass cohort context into `AgentSelectorService` for authenticated AI DJ
     picks;
   - add explainable ranking signals with bounded weights;
   - add listener-facing explanation strings that name the cohort label without
     raw membership details.
4. Add analytics/event coverage:
   - extend recommendation and AI DJ generation events with safe cohort
     influence metadata such as count, cohort types, reason codes, and selected
     cohort ids when needed for aggregate attribution;
   - avoid emitting other listener identities, exact raw membership, wallets, or
     raw listening history;
   - document how downstream batch/streaming analytics can enrich reporting
     without being required for the core serving path.
5. Update frontend explanation rendering where needed:
   - show cohort-influenced recommendation or AI DJ explanation pills using
     safe text from the backend;
   - avoid new UI controls unless current taste/social matching controls prove
     insufficient.
6. Update docs:
   - `docs/features/listener_community_network.md`;
   - `docs/features/agent_taste_intelligence.md` or
     `docs/features/agent-commerce-runtime.md` if AI DJ/runtime behavior needs
     catalog coverage;
   - `docs/features/README.md`;
   - `docs/architecture/analytics_event_taxonomy_v1.md` for event metadata;
   - mention `docs/engineering/change_impact_checklist.md` sections in PR
     summary for privacy, analytics, API contracts, and feature docs.

## Non-Goals

- Do not require Dataflow, BigQuery, or warehouse materializations for runtime
  recommendations or AI DJ picks.
- Do not expose member lists, exact private counts, wallet addresses, raw
  listening history, raw cohort eligibility facts, or other listener identities.
- Do not make cohorts a hard filter for recommendations.
- Do not add a graph database or public social graph surface.
- Do not add new consent controls unless the existing taste/social matching and
  city-scene controls cannot express the needed boundary.
- Do not implement cohort generation or lifecycle refresh; those remain covered
  by the parent cohort work and related follow-ups.

## Implementation Notes

- Prefer adding a reusable method to `CommunityCohortService`, for example
  `getDiscoveryContextForUser(userId)`, so recommendation and AI DJ paths share
  the same privacy gates.
- Keep context DTOs separate from cohort detail DTOs. Discovery context should
  be smaller than detail responses and should not carry member counts unless an
  aggregate analytics use case needs a bucketed label.
- Treat cohort context as optional. If no safe joined cohorts exist, behavior
  should match today's recommendation and AI DJ behavior.
- Use fixed, bounded weights for cohort signals and cap the number of cohort
  explanations attached to a track or pick.
- Reuse existing safe explanation sanitization and reason-code validation, or
  extract the helpers if they need to be shared by tests.
- Make event payload changes additive and versioned only if current consumers
  require a new version.

## Validation

Backend:

- Integration tests proving joined eligible cohorts can influence
  recommendations and AI DJ picks for the authenticated listener.
- Tests proving suggested-only, left, hidden, archived, expired,
  below-threshold, and consent-disabled cohorts cannot influence discovery.
- Tests proving safe explanations do not include other listener identities,
  wallet addresses, raw membership details, or raw listening history.
- Analytics tests proving cohort influence metadata is emitted only in safe
  aggregate form.
- Existing recommendation and agent selector tests updated for unchanged
  behavior when no eligible cohort context exists.

Frontend:

- Component/API-helper tests for cohort-influenced explanation rendering on
  recommendation and AI DJ surfaces touched by the slice.
- Regression tests proving explanations remain hidden or neutral when backend
  payloads do not include cohort context.

Docs and checks:

- Feature catalog and feature pages updated in the same branch.
- Analytics taxonomy docs updated for new/extended event fields.
- `cd backend && npm run test`
- Focused integration tests through `cd backend && npm run test:integration`
  or targeted Jest invocation for the changed files.
- `cd web && npm run lint` and focused frontend tests for changed components.
- `git diff --check`
