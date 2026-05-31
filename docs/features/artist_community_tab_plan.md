---
title: "Artist Community Tab Plan"
status: partial
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/999"
follow_up:
  - "https://github.com/akoita/resonate/issues/1037"
---

# Artist Community Tab Plan

## Purpose

The artist community tab turns the profile, visibility, and holder-benefit
foundations into an artist-facing community surface. The first slice focuses on
off-chain rooms, membership, messages, holder access, and moderation basics.

## Slice 1: Backend Room Foundation

Status: `implemented`

Deliverables:

- Add `CommunityRoom`, `CommunityMembership`, `CommunityMessage`, and
  `CommunityModerationReport` persistence.
- Support artist public rooms and artist holder rooms.
- Add an artist-owned enable endpoint that creates the default public and
  holder rooms.
- Add room join/leave.
- Add message list/create with `message` and `announcement` message types.
- Add message report and delete.
- Add member remove/ban and room `active`, `paused`, and `archived` state.
- Use `CommunityEligibilityService` for holder-room access.
- Keep all messages, memberships, and moderation state off-chain and removable.

## Slice 2: Listener And Artist UI

Status: `implemented`

Deliverables:

- Add an artist community tab to the artist-facing page.
- Show public rooms and locked holder rooms with safe explanation copy.
- Let eligible holders join from the UI.
- Let artists post announcements.
- Add basic message list, report, delete, and moderation controls.

Implementation notes:

- `/artist/:id` exposes a Discography/Community tab switch.
- Public visitors can see rooms and safe locked-state copy.
- Authenticated reads use `GET /community/artists/:artistId/rooms/me` so the UI
  can show current membership and private holder eligibility without leaking
  wallet holdings.
- The message surface is intentionally off-chain and removable.
- Backend room, message, benefit redemption, and moderation actions emit compact
  `community.*` analytics events through the domain event bridge. Message bodies,
  report free text, and private wallet holdings are excluded from analytics
  payloads.

## Slice 3: Governance And Analytics

Status: `partial`

Deliverables:

- Add governed analytics events for room joins, messages, reports, bans,
  deletes, and room status updates. `implemented`
- Add operator/admin moderation dashboards. `planned` in
  [#1037](https://github.com/akoita/resonate/issues/1037)
- Add retention and consent-aware data handling notes. `planned` in
  [#1037](https://github.com/akoita/resonate/issues/1037)

Implementation notes:

- #999 completed the artist/community room acceptance criteria and closed the
  first product surface.
- #999 also implemented compact `community.*` analytics bridge coverage for
  room, message, benefit, and moderation events.
- The broader governance surface is intentionally tracked separately in
  [#1037](https://github.com/akoita/resonate/issues/1037) instead of being
  hidden inside this closed issue.

## Verification

Slices 1 and 2 should prove:

- artists can enable public and holder rooms;
- listeners can join public artist rooms;
- non-holders are denied holder rooms with a safe explanation;
- holders can join holder rooms through private eligibility;
- announcements are restricted to the artist owner/operator path;
- messages are removable and reportable;
- member moderation can remove or ban members;
- room status can be paused or archived.
