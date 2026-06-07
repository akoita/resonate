---
title: "Issue #1002 Implementation Plan: Discord Bridge"
status: in-progress
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/1002"
---

# Issue #1002 Implementation Plan: Discord Bridge

## Goal

Add an artist-controlled Discord bridge that lets artists publish an official
Discord link, mirror Resonate announcements through an authorized webhook, and
prepare role mirroring from Resonate eligibility without bypassing privacy
settings.

## Product Boundary

Implemented behavior should be explicit and opt-in:

- Artists can connect, test, update, and disconnect their official Discord
  webhook/server metadata.
- Public artist community surfaces can show the official Discord invite/link
  only after the artist enables public display.
- Artist/team announcements can mirror to Discord only when mirroring is
  enabled for that artist connection.
- Role sync uses server-side Resonate eligibility and community roles. It must
  not trust client-submitted ownership, supporter, or holder claims.
- Failures stay visible to the artist and retryable. Private wallet,
  ownership, cohort, room membership, and raw eligibility details must not be
  exposed in public DTOs or Discord messages.

## Proposed Backend Slice

1. Add Discord bridge persistence:
   - artist connection row with provider/server/channel/webhook metadata,
     public-link settings, mirror settings, status, last test/sync state, and
     timestamps;
   - role mapping rows for Resonate role policy to Discord role ID;
   - sync/audit attempt rows for webhook mirror and role sync attempts.

2. Add a `CommunityDiscordBridgeService`:
   - assert artist ownership/operator access using existing artist ownership
     conventions;
   - validate webhook URL shape without hardcoded environment-specific values;
   - test webhook by sending a bounded diagnostic message;
   - mirror announcement messages created in artist rooms;
   - compute role sync candidates from existing eligibility/role data, not from
     browser claims;
   - record retryable failure state and bounded error reasons.

3. Add community controller endpoints:
   - authenticated artist connection read/write/disconnect/test;
   - authenticated role mapping read/write;
   - authenticated retry endpoint for failed mirror/sync attempts;
   - public artist Discord summary endpoint or inclusion in existing artist room
     DTOs when public display is enabled.

4. Publish analytics/domain events listed in the community network plan:
   - `community.discord_bridge_connected`
   - `community.discord_announcement_mirrored`
   - `community.discord_role_sync_completed`
   - `community.discord_role_sync_failed`

## Proposed Frontend Slice

1. Add artist Discord settings controls near existing artist/community
   management surfaces:
   - connected, failed, disconnected, and testing states;
   - webhook URL / invite URL inputs;
   - public display toggle;
   - announcement mirror toggle;
   - test and disconnect actions.

2. Show public official Discord link on artist community surfaces when enabled.

3. Show role-sync status and retry affordance without exposing member-level
   private eligibility details.

## Validation Plan

- Backend integration tests for connect/disconnect/test webhook, public DTO
  redaction, announcement mirror success/failure, retry state, and role mapping
  using server-side eligibility.
- Frontend tests for connected, disconnected, failed, and public-link states.
- Feature docs update in `docs/features/listener_community_network.md` and
  `docs/features/README.md`.
- Architecture docs update in `docs/architecture/listener_community_network.md`
  if models/endpoints/events are added.
- Security best-practices scan for backend/frontend changes.

## Deferrals To Track If Not Shipped In This PR

- Real Discord OAuth bot installation and Discord API role assignment may be
  deferred behind a follow-up if the first slice uses webhook-only
  announcement mirroring plus dry-run role sync.
- Per-member role assignment should remain deferred until Discord account
  linking and explicit listener consent are defined.
- Operator dashboards for aggregate Discord bridge health can be deferred if
  artist-facing retry/failure visibility ships first.
