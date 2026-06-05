# Issue #1071 Implementation Plan

## Goal

Add lightweight cohort-scoped rooms for joined listener cohorts. A listener who
has joined an eligible, active cohort should be able to open a privacy-safe room
for that cohort, read and post messages, and use the existing report/delete and
admin moderation flows without exposing other cohort members or turning cohorts
into a generic public social feed.

## Current Baseline

- `CommunityRoom` already supports `roomType = cohort` and `ownerType = cohort`
  in the architecture and database shape through generic string fields.
- `CommunityCohortService` already enforces cohort visibility, minimum-size,
  expiry, consent, and membership-status gates for suggestions and detail.
- `CommunityRoomsService` already supports generic room join/leave, message
  list/create, report, delete, member moderation, room pause/archive, and the
  `/admin/community/moderation` queue from #1037.
- `ListenerCohortsPanel` already renders cohort suggestions/detail with
  privacy copy and next-action cards, but room access is currently only a
  conceptual follow-up.
- Feature and architecture docs describe cohort rooms as planned but do not yet
  define the runtime lifecycle or API contract.

## First Slice

1. Add a backend cohort-room contract:
   - route: `GET /community/cohorts/:cohortId/room`;
   - route: `POST /community/cohorts/:cohortId/room/join`;
   - returns a cohort-scoped room DTO, the authenticated listener's membership
     when present, access state, safe empty-state copy, and privacy/redaction
     metadata.
2. Reuse existing `CommunityRoom` and `CommunityMembership` tables:
   - `roomType = cohort`;
   - `ownerType = cohort`;
   - `ownerId = cohort.id`;
   - `accessPolicyJson` records a non-authoritative policy summary for operator
     inspection only.
3. Enforce cohort access server-side:
   - cohort must be active or suggested, unexpired, and at or above minimum
     visible member threshold;
   - listener must still have consent for the cohort type;
   - listener must have a `CommunityCohortMembership.status = joined`;
   - suggested, left, hidden, stale, stale_joined, archived, expired, and
     below-threshold states must not expose an open room.
4. Reuse existing room primitives after access is established:
   - joined members can join/read/write the cohort room;
   - suggested but not joined users cannot post;
   - reports, message deletion, and admin moderation continue through existing
     message/report endpoints and the #1037 admin queue.
5. Add frontend cohort-room entry:
   - show an "Open cohort room" action only for joined cohorts when the backend
     says the room is available;
   - show safe locked/empty states for unavailable rooms;
   - use the existing community message UI primitives where practical, or a
     small cohort-room panel if there is no reusable generic room component.
6. Update docs:
   - `docs/features/listener_community_network.md`;
   - `docs/architecture/listener_community_network.md`;
   - `docs/features/README.md` only if catalog status text needs adjustment.

## Non-Goals

- Do not add Discord mirroring.
- Do not expose public member lists or individual cohort participants.
- Do not build generic cohort discovery/search.
- Do not move cohort state on-chain.
- Do not add client-submitted eligibility or ownership claims.
- Do not add a new database migration unless the implementation proves the
  existing room/membership schema cannot represent the first slice safely.

## Implementation Notes

- Prefer adding a small cohort-room method to `CommunityCohortService` or a
  delegated method that shares its existing `requireActionableMembership`
  visibility logic.
- Keep cohort-room access stricter than cohort detail: detail can be visible to
  suggested or joined members, but the room should require joined membership.
- Keep room DTOs bounded. Do not include member lists, wallet addresses, raw
  cohort metadata, raw listening history, or private eligibility details.
- Use existing `CommunityRoomsService` access checks where possible. If cohort
  access needs a new branch, keep it explicit and covered by integration tests.
- Prefer safe disabled reasons such as "Join this cohort before opening the
  room" or "This cohort is not currently open for chat" rather than policy
  internals.

## Validation

Backend:

- Integration tests for joined cohort members opening, joining, reading, and
  posting in a cohort room.
- Tests proving suggested, left, hidden, stale, archived, expired,
  below-threshold, and consent-disabled users cannot expose or post in rooms.
- Tests proving reports for cohort-room messages appear in the moderation queue
  without exposing private cohort member details.
- Controller HTTP tests for the new cohort-room routes.

Frontend:

- API helper tests for cohort-room read/join.
- Component tests for joined room entry, locked states, empty states, and report
  or delete affordances if a message panel is included in the first slice.
- Responsive check for the settings cohort detail panel so room entry does not
  crowd existing membership controls.

Docs:

- Feature and architecture docs describe the room lifecycle, privacy boundary,
  moderation dependency on #1037, and out-of-scope member list/Discord behavior.
