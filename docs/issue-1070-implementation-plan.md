# Issue #1070 Implementation Plan

## Goal

Add opt-in cohort member visibility without weakening the current cohort
privacy model. A listener viewing an eligible cohort should be able to see a
small list of public/community-visible member profile summaries only when each
shown member has explicitly made their profile visible in the relevant
community context. Private, hidden, left, removed, consent-disabled, and
below-threshold members must remain aggregate-only.

## Current Baseline

- `CommunityCohortService` already gates cohort suggestions and detail by
  authenticated listener, membership status, cohort lifecycle, expiry, minimum
  visible size, and `CommunityVisibilitySettings` consent.
- `CommunityCohortMembership` already tracks `suggested`, `joined`, `left`,
  and `hidden` states, but it does not have a separate member-list visibility
  preference.
- `CommunityProfile` already has `profileVisibility` with `private`,
  `community`, `followers`, and `public` values.
- `CommunityVisibilitySettings` already controls taste matching and city-scene
  matching, plus profile showcase sections, but it does not yet expose a
  cohort-member-list control.
- `GET /community/cohorts/:cohortId` currently returns only privacy-safe cohort
  detail, bucketed counts, redactions, and music-native actions. The current
  architecture doc explicitly says member lists are not included; #1070 changes
  that contract only for explicitly opted-in profile summaries.
- `ListenerCohortsPanel` already renders cohort suggestions, detail, join,
  leave, hide, and cohort-room entry, so it is the likely UI surface for the
  visibility explanation and member-preview list.

## Proposed First Slice

1. Extend the backend cohort-detail response with a bounded member visibility
   block:
   - include visible member profile summaries only on
     `GET /community/cohorts/:cohortId`;
   - keep the route authenticated and behind the same cohort visibility gates
     as the existing detail response;
   - return at most a small fixed number of visible members;
   - include only safe profile fields: public user id for public profile-link
     routing, display name, avatar URL, profile visibility, and joined
     cohort-member status if needed for copy. Community-visible contextual
     summaries should not expose stable user identifiers;
   - do not include wallet address, email, raw listening history, raw cohort
     metadata, exact private member counts, or private eligibility facts.
2. Define member visibility rules by reusing existing settings first:
   - `profileVisibility = public` can appear to eligible cohort viewers;
   - `profileVisibility = community` can appear to authenticated eligible
     cohort viewers;
   - `profileVisibility = private` and `followers` do not appear in the first
     slice unless an existing follower/community graph rule is already
     available and safe to reuse;
   - the member must have current cohort consent for the cohort type
     (`allowTasteMatching` or `allowCityScenes`);
   - the member's cohort membership must be explicitly joined and not hidden,
     left, removed, stale, expired, or invalidated by consent changes. Generated
     suggested-only memberships remain anonymous until the listener joins.
3. Add anonymous aggregate copy without small-count leakage:
   - keep exact `visibleMemberCount` out of detail responses;
   - keep using bucketed count labels for total eligible cohort size;
   - return an anonymous remainder label such as "More listeners are private"
     only in bucketed/coarse terms;
   - avoid exposing a precise count of hidden/private members, especially for
     cohorts near the minimum-size threshold.
4. Add listener controls and copy in the settings/community UI:
   - explain whether the current listener can appear in joined cohort member
     previews based on their profile visibility and matching consent;
   - link or point to the existing Community Profile settings instead of adding
     a duplicate control if the current fields are sufficient;
   - show member previews only in cohort detail, with a private/anonymous empty
     state when no members opted in;
   - ensure leave, hide, or disabling matching removes the listener from member
     visibility.
5. Update docs:
   - `docs/features/listener_community_network.md`;
   - `docs/features/README.md`;
   - `docs/architecture/listener_community_network.md`;
   - PR summary should mention the change-impact checklist areas for privacy,
     API contracts, frontend UX, docs, and validation.

## Non-Goals

- Do not create cohort chat, rooms, or follower graph behavior in this issue;
  cohort rooms were handled separately and member visibility should remain
  independent from room access.
- Do not expose public search, global member directories, or social graph
  recommendations.
- Do not expose private members, exact private member counts, wallet addresses,
  emails, raw listening history, raw eligibility facts, or raw cohort metadata.
- Do not add a database migration unless existing profile visibility plus
  matching consent cannot express the acceptance criteria safely.
- Do not change admin/operator cohort quality surfaces to reveal member lists;
  keep them aggregate unless moderation or governance context explicitly
  requires a separate, privacy-reviewed flow.

## Implementation Notes

- Prefer implementing visible-member selection inside
  `CommunityCohortService`, next to `getCohortDetail`, so it shares the
  existing fail-closed cohort gates.
- Keep the visible-member DTO separate from public profile DTOs. Cohort member
  previews are contextual summaries, not full public profiles.
- If product review requires a distinct opt-in beyond `profileVisibility`, add
  a boolean to `CommunityVisibilitySettings` rather than storing visibility on
  individual `CommunityCohortMembership` rows. That keeps leave/hide/consent
  invalidation straightforward and avoids stale per-cohort preferences.
- Use deterministic ordering that does not reveal sensitive recency. Good
  options are profile update time or cohort membership update time with a small
  cap; avoid exposing exact joined order as product copy.
- Keep schema changes additive. Existing clients should tolerate a missing or
  empty member visibility block.

## Validation

Backend:

- Integration tests for mixed public, community-visible, private, followers,
  disabled-consent, left, hidden, and removed members in the same cohort.
- Tests proving private members never appear in the visible member list.
- Tests proving `public` and `community` profiles appear only when the viewer
  can access the cohort and the member still has current cohort consent.
- Tests proving disabling taste/city matching, leaving, or hiding removes a
  member from visible previews.
- Regression tests proving detail responses do not leak emails, wallets, raw
  listening history, raw metadata, exact minimum-size/private counts, or raw
  member totals.
- Controller HTTP tests for the additive response shape if the route contract
  changes enough to merit HTTP-level coverage.

Frontend:

- Component tests for cohort detail with mixed visible and anonymous/private
  members.
- Component tests for no-visible-member empty state and current-listener
  visibility copy.
- API type coverage for the new member visibility block.
- Focused responsive check in the settings cohort detail panel so member
  previews do not crowd membership controls or room entry.

Docs and checks:

- Feature and architecture docs updated in the same branch.
- `cd backend && npm run test`
- Targeted backend integration test invocation for the changed community cohort
  tests.
- `cd web && npm run lint` and focused frontend tests for changed components.
- `git diff --check`
