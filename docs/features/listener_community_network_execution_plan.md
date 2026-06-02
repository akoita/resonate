---
title: "Listener Community Network Execution Plan"
status: draft
owner: "@akoita"
depends_on:
  - listener_community_network
  - analytics_event_ledger
  - analytics_consent_retention_policy
  - resonate_shows
  - agent-commerce-runtime
---

# Listener Community Network Execution Plan

## Goal

Ship the first Resonate-native community layer without building a generic social
network. The first release should prove that music-specific identity, artist
rooms, holder privileges, and campaign/show coordination increase retention,
artist revenue, and listener belonging.

## MVP Promise

For listeners:

> Show who you support, unlock artist spaces and benefits, and meet people
> through shared taste, ownership, campaigns, and city scenes only when you opt
> in.

For artists:

> Give your supporters a native home on Resonate, with rooms, roles, holder
> access, campaign conversion, show demand, and privacy-safe fan signals.

## Delivery Slices

### Slice 1: Community Profile And Visibility

Purpose:

- establish listener social identity before chat or network effects;
- let users opt into showing badges, marketplace ownership, and support proofs;
- create a permission layer for later rooms and benefits.

User stories:

- As a listener, I can decide whether my community profile is private,
  community-visible, follower-visible, or public.
- As a listener, I can choose whether to show owned stem NFTs, collectibles,
  campaign support, show attendance, playlists, and badges.
- As a listener, I can hide wallet addresses while still using ownership-based
  benefits.
- As an artist, I can see aggregate supporter counts without receiving private
  ownership data the listener did not expose.

Backend scope:

- `CommunityProfile`
- `CommunityVisibilitySettings`
- public profile reads with privacy redaction;
- future profile badge reads;
- future marketplace ownership summary reads;
- private benefit eligibility distinct from public profile display.

Frontend scope:

- profile showcase settings;
- public profile showcase contract;
- hidden/private states;
- future marketplace item display cards;
- future badge display cards.

Analytics:

- `community.profile_visibility_updated`
- `community.profile_showcase_viewed`
- `community.ownership_display_updated`

Tests:

- profile visibility integration tests;
- ownership hidden-but-benefit-active tests;
- frontend profile settings tests.

### Slice 2: Badges, Roles, And Holder Benefits

Purpose:

- turn marketplace items and support actions into platform utility;
- create artist and listener value without relying on speculation.

User stories:

- As a collector, I can display a stem NFT or collectible on my profile.
- As a collector, I can unlock a holder-only artist room or perk without making
  my wallet address public.
- As an artist, I can configure simple holder benefits such as room access,
  merch discount, early ticket access, or drop priority.
- As a listener, I can earn non-financial badges for early listening, curation,
  remixing, campaign support, and show attendance.

Backend scope:

- `CommunityBadge`
- `CommunityRole`
- `CommunityBenefitRule`
- `CommunityBenefitRedemption`
- ownership-based eligibility service;
- policy checks for benefit visibility and redemption.

Frontend scope:

- holder benefit cards;
- badge shelf;
- access-gated room state;
- benefit redemption state.

Analytics:

- `community.role_granted`
- `community.benefit_unlocked`
- `community.benefit_redeemed`
- `community.badge_displayed`

Tests:

- eligibility tests for item ownership;
- private ownership benefit tests;
- duplicate redemption prevention;
- frontend gated state tests.

### Slice 3: Artist Community Tab

Purpose:

- give artists a Resonate-native home for fans;
- start with structured rooms instead of open-ended global social features.

User stories:

- As an artist, I can enable a community tab on my artist page.
- As an artist, I can post announcements.
- As a listener, I can join public artist discussion if the room is open.
- As a holder, I can join holder-only discussion if I own the required item.
- As an artist/team member, I can remove messages and manage room access.

Backend scope:

- `CommunityRoom`
- `CommunityMembership`
- `CommunityMessage`
- artist/team permissions;
- room access policy;
- moderation report model.

Frontend scope:

- artist community tab;
- announcement list;
- public room;
- holder-only room;
- join/leave controls;
- report and delete controls.

Analytics:

- `community.room_joined`
- `community.message_created`
- `community.message_reported`
- `community.room_access_denied`

Tests:

- room membership integration tests;
- holder-only access tests;
- artist moderation tests;
- frontend artist tab happy path.

### Slice 4: Shows And Campaign Rooms

Purpose:

- connect community directly to an existing Resonate wedge;
- prove that community improves pledge conversion and live demand formation.

User stories:

- As a campaign backer, I can join a campaign supporter room.
- As a fan in a city, I can join the city demand group for a show campaign.
- As an artist/operator, I can post campaign updates to backers.
- As a listener, I can receive badges or perks for supporting a campaign.

Backend scope:

- campaign-backed room creation;
- campaign pledge role source;
- city scene membership source;
- campaign update message type.

Frontend scope:

- campaign room on Shows detail;
- city demand room entry point;
- supporter badge;
- milestone updates.

Analytics:

- `community.campaign_room_joined`
- `community.show_city_interest_joined`
- `community.campaign_referral_created`
- `community.campaign_update_viewed`

Tests:

- pledge-to-room access tests;
- city demand membership tests;
- campaign conversion event tests;
- Shows detail room tests.

### Slice 5: Taste Cohorts

Status: `partial`

Purpose:

- activate listener-to-listener discovery only after privacy, moderation, and
  profile primitives exist.

User stories:

- As a listener, I can opt into taste-based matching.
- As a listener, I can see why a cohort was suggested.
- As a listener, I can leave a cohort and disable future suggestions.
- As a platform operator, I can prevent cohorts below a minimum size from
  exposing sensitive inferences.

Backend scope:

- `CommunityCohort`
- `CommunityCohortMembership`
- explainable cohort reason generator;
- minimum-size and expiry rules;
- consent checks.

Implementation notes:

- The first backend contract is implemented through off-chain
  `CommunityCohort` and `CommunityCohortMembership` records.
- `GET /community/cohorts/suggestions` returns only cohorts with an existing
  suggested/joined membership for the authenticated listener.
- Taste, artist-affinity, collector, and campaign cohorts require
  `allowTasteMatching`; city-scene cohorts require `allowCityScenes`.
- Cohorts below `minimumSize`, expired cohorts, archived cohorts, hidden
  memberships, and disabled-consent cohorts are not exposed.
- Suggested explanations are cohort-level strings and are sanitized before
  returning to users. Payloads do not expose other listener identities, raw
  listening history, wallet data, ownership data, or private location facts.
- Listeners can join, leave, and hide suggested cohorts. Membership remains
  off-chain and mutable/deletable.
- Cohort generation can be triggered by admins through
  `POST /admin/community/cohorts/generate`; lifecycle refresh and operator
  quality metrics remain follow-up work.

Feature-complete delivery map:

- Backend cohort contract: `implemented` in #1001/#1051. Adds persistence,
  consent gates, minimum-size filtering, lifecycle actions, safe explanations,
  and cohort analytics events.
- Listener cohort UI: `implemented` in #1052. Adds `/settings` cohort cards,
  safe explanations, join/leave/hide controls, empty/loading/disabled-consent
  states, API client coverage, and frontend tests.
- Cohort generation worker: `implemented` in #1054. Materializes cohorts from
  safe transactional library/taste, artist-affinity, campaign/show, collector,
  and coarse city-scene signals. The worker uses transactional reads for current
  consent and product state, enforces `minimumSize` through persisted
  `visibleMemberCount`, preserves hidden memberships, marks no-longer-eligible
  visible memberships `stale`, avoids duplicate memberships on repeated runs,
  and writes `CommunityCohort` /
  `CommunityCohortMembership` records for serving. Future warehouse/materialized
  analytics inputs can extend the candidate sources without changing the
  listener-facing contract.
- Cohort lifecycle and refresh: `not-started`. Expire stale cohorts, refresh
  memberships without resurrecting hidden user intent, archive below-threshold
  cohorts, and test expiry/refresh cleanup.
- Operator quality and analytics: `not-started`. Track aggregate suggestion,
  join, leave, hide, disabled-consent, below-threshold, stale-cohort, cohort
  type, and reason-code metrics without exposing raw listener histories,
  private identities, exact sensitive counts, wallet data, or fine location.

Completion rule:

- #1001 should remain open or be replaced by explicit follow-up issues until
  every slice above is either implemented or intentionally deferred with
  owner-visible rationale.

Frontend scope:

- suggested cohort cards;
- match explanation;
- join/leave controls;
- empty and expired states.

Analytics:

- `community.cohort_suggested`
- `community.cohort_joined`
- `community.cohort_left`
- `community.cohort_hidden`

Tests:

- consent-gated suggestion tests;
- minimum cohort-size tests;
- explanation sanitization tests;
- frontend cohort flow tests.

### Slice 6: Discord Bridge

Purpose:

- respect existing artist community behavior;
- let Resonate become the music-aware source of roles, benefits, and actions.

User stories:

- As an artist, I can link my official Discord server.
- As an artist, I can mirror Resonate announcements to Discord.
- As an artist, I can map Resonate holder/supporter roles to Discord roles.
- As a listener, I can discover the official Discord from the artist page
  without losing Resonate-native benefits.

Backend scope:

- artist Discord connection record;
- outbound announcement webhook;
- role sync job;
- audit log.

Frontend scope:

- artist Discord settings;
- public Discord link;
- role sync status;
- failure/retry states.

Analytics:

- `community.discord_bridge_connected`
- `community.discord_announcement_mirrored`
- `community.discord_role_sync_completed`
- `community.discord_role_sync_failed`

Tests:

- webhook validation tests;
- role mapping tests;
- retry and audit tests;
- frontend settings tests.

## Proposed Data Model

### `CommunityProfile`

| Field | Purpose |
| --- | --- |
| `id` | Stable profile id. |
| `userId` | Owning user. |
| `displayName` | Community display name. |
| `bio` | Optional short bio. |
| `profileVisibility` | `private`, `community`, `followers`, `public`. |
| `createdAt`, `updatedAt` | Audit timestamps. |

### `CommunityVisibilitySettings`

| Field | Purpose |
| --- | --- |
| `userId` | Owning user. |
| `showTasteBadges` | Whether taste badges can appear. |
| `showOwnedItems` | Whether marketplace items can appear. |
| `showCampaignSupport` | Whether campaign support can appear. |
| `showShowAttendance` | Whether show attendance can appear. |
| `showPlaylists` | Whether playlists can appear. |
| `showWalletAddress` | Defaults false. |
| `allowTasteMatching` | Whether taste cohorts can be suggested. |
| `allowCityScenes` | Whether coarse location can be used for city scenes. |

### `CommunityBadge`

| Field | Purpose |
| --- | --- |
| `id` | Badge id. |
| `userId` | Badge recipient. |
| `badgeType` | `early_listener`, `supporter`, `collector`, `attendee`, `curator`, `remixer`, `ambassador`, `moderator`. |
| `sourceType` | `track`, `release`, `artist`, `marketplace_item`, `campaign`, `show`, `playlist`, `remix`, `manual`. |
| `sourceId` | Source object id. |
| `visibility` | Badge visibility override. |
| `grantedAt` | Grant timestamp. |

### `CommunityRoom`

| Field | Purpose |
| --- | --- |
| `id` | Room id. |
| `roomType` | `artist_public`, `artist_holder`, `campaign`, `show_city`, `cohort`, `remix`, `announcement`. |
| `ownerType` | `artist`, `campaign`, `show`, `cohort`, `platform`. |
| `ownerId` | Owner object id. |
| `accessPolicy` | Structured access rule. |
| `status` | `active`, `paused`, `archived`. |
| `createdAt`, `updatedAt` | Audit timestamps. |

### `CommunityMembership`

| Field | Purpose |
| --- | --- |
| `id` | Membership id. |
| `roomId` | Room. |
| `userId` | Member. |
| `role` | `member`, `holder`, `artist_team`, `moderator`, `admin`. |
| `sourceType` | `manual`, `ownership`, `campaign_pledge`, `show_attendance`, `artist_team`, `cohort`. |
| `status` | `active`, `left`, `removed`, `banned`. |
| `joinedAt` | Join timestamp. |

### `CommunityBenefitRule`

| Field | Purpose |
| --- | --- |
| `id` | Rule id. |
| `artistId` | Owning artist when artist-scoped. |
| `benefitType` | `room_access`, `discount`, `early_access`, `fee_discount`, `drop_priority`, `ticket_priority`, `remix_eligibility`. |
| `eligibilityPolicy` | Ownership, badge, campaign, or role policy. |
| `redemptionPolicy` | Single-use, recurring, limited capacity, or time window. |
| `status` | `draft`, `active`, `paused`, `expired`. |

### `CommunityModerationReport`

| Field | Purpose |
| --- | --- |
| `id` | Report id. |
| `roomId` | Room. |
| `messageId` | Reported message where relevant. |
| `reporterUserId` | Reporter. |
| `reason` | Abuse category. |
| `status` | `open`, `reviewed`, `actioned`, `dismissed`. |
| `createdAt`, `resolvedAt` | Audit timestamps. |

## API Sketch

```text
GET    /community/profile/me
PATCH  /community/profile/me
GET    /community/profile/:userId

GET    /community/badges/me
GET    /community/benefits/me
POST   /community/benefits/:benefitId/redeem

GET    /community/artists/:artistId/rooms
GET    /community/artists/:artistId/rooms/me
POST   /community/artists/:artistId/rooms/enable
POST   /community/rooms/:roomId/join
POST   /community/rooms/:roomId/leave
GET    /community/rooms/:roomId/messages
POST   /community/rooms/:roomId/messages
POST   /community/messages/:messageId/report
DELETE /community/messages/:messageId
POST   /community/rooms/:roomId/members/:userId/moderate
PATCH  /community/rooms/:roomId/status

GET    /shows/campaigns/:campaignId/community
POST   /shows/campaigns/:campaignId/community/join

GET    /community/cohorts/suggestions
POST   /community/cohorts/:cohortId/join
POST   /community/cohorts/:cohortId/leave

GET    /artists/:artistId/community/discord
PUT    /artists/:artistId/community/discord
POST   /artists/:artistId/community/discord/sync
```

## Access Policy Examples

```json
{
  "type": "ownership",
  "anyOf": [
    {
      "assetType": "stem_nft",
      "artistId": "artist_123"
    },
    {
      "assetType": "collectible_moment",
      "releaseId": "release_456"
    }
  ]
}
```

```json
{
  "type": "campaign_support",
  "campaignId": "campaign_123",
  "minStatus": "confirmed"
}
```

```json
{
  "type": "compound",
  "allOf": [
    {
      "type": "badge",
      "badgeType": "collector"
    },
    {
      "type": "artist_follow",
      "artistId": "artist_123"
    }
  ]
}
```

## Blockchain Boundary

The implementation should use blockchain as a credential and settlement layer,
not as the community database.

### Contract Or Indexer Inputs

- marketplace item ownership;
- stem NFT ownership;
- collectible moment ownership;
- Shows campaign pledge state;
- escrow refund and release state;
- royalty/payment settlement state;
- artist/drop/campaign authority proofs;
- optional attendance or supporter proofs.

### Off-Chain Community State

- profile display settings;
- room membership;
- messages;
- reactions;
- moderation reports and actions;
- cohort membership;
- city scene membership;
- role grants;
- benefit rules and redemption records unless settlement requires a contract;
- analytics and recommendation features.

### Service Boundary

Use a dedicated eligibility service for community access checks:

```text
contract/indexer ownership or escrow state
  -> eligibility service
  -> off-chain role, badge, or benefit eligibility
  -> privacy/display service
  -> room access, profile showcase, or benefit redemption
```

The service should distinguish:

- `eligible`: the user qualifies for access or a benefit;
- `displayable`: the user chose to show the proof publicly;
- `redeemable`: the benefit can be consumed now;
- `settlement_required`: redemption needs an on-chain transaction;
- `private`: the user qualifies but does not expose the underlying asset.

### Test Requirements

- verify that private ownership can unlock access without public profile
  display;
- verify that hidden wallet addresses do not block holder benefits;
- verify that room membership can be revoked off-chain even if the user still
  owns an asset, for moderation and safety reasons;
- verify that contract/indexer downtime fails closed for new grants but does
  not expose private data;
- verify that economic redemptions use contract settlement only when required.

## Privacy Requirements

- Public profile display is opt-in.
- Ownership display is separate from ownership-based eligibility.
- Wallet address display defaults to false.
- Taste matching is opt-in.
- City scenes use declared or coarse geography, not raw GPS.
- Cohort suggestions must explain match reasons without exposing private facts
  about other users.
- Artist analytics should aggregate community signals with minimum thresholds.
- Moderation and abuse systems can access necessary safety context under
  operator policy, but normal artist views should not expose private listener
  settings.

## Moderation Requirements

Minimum launch requirements:

- report message;
- remove message;
- leave room;
- ban from room;
- pause room;
- artist/team moderation role;
- platform admin override;
- audit log for destructive moderation actions.

AI-assisted moderation can triage and summarize, but final enforcement should
remain explicit product or human policy until confidence and appeal flows are
defined.

## Milestone Plan

| Milestone | Deliverable | Exit Criteria |
| --- | --- | --- |
| M0 | Product and data design | Feature doc, RFC, execution plan, data model, event list reviewed. |
| M1 | Profile and visibility | Users can configure profile visibility and show/hide badges and marketplace items. |
| M2 | Badge and benefit engine | Ownership and support proofs can unlock benefits without public wallet exposure. |
| M3 | Artist rooms | Artist community tab supports announcements, public room, holder room, and moderation. |
| M4 | Shows campaign rooms | Campaign backers and city supporters can coordinate from Shows pages. |
| M5 | Taste cohorts | Opt-in cohorts suggest explainable listener groups with privacy thresholds. |
| M6 | Discord bridge | Artists can link Discord, mirror announcements, and sync roles. |

## Launch Metrics

Primary:

- profile opt-in rate;
- ownership display opt-in rate;
- artist community enablement rate;
- holder room join rate;
- benefit redemption rate;
- campaign pledge conversion lift from community participants;
- D7/D30 retention lift for community participants.

Safety:

- reports per active room;
- moderation action time;
- hidden ownership rate;
- blocked access attempts;
- cohort opt-out rate.

Artist value:

- room active days per month;
- announcement views;
- holder conversion;
- campaign update engagement;
- city demand joins;
- incremental marketplace revenue from holder benefits.

## Issue Breakdown

Suggested implementation issues:

1. Add community profile and visibility models.
2. Add profile showcase API with privacy enforcement.
3. Add marketplace ownership summary for profile display.
4. Add badge grant/read service.
5. Add holder benefit rule and redemption service.
6. Add artist community room models and membership service.
7. Add community message and moderation APIs.
8. Add artist community tab UI.
9. Add holder-only room access UI.
10. Add Shows campaign room integration.
11. Add community analytics events.
12. Add taste cohort opt-in and suggestions.
13. Add Discord bridge settings and webhook support.

## References

- Feature: [Listener Community Network](listener_community_network.md)
- RFC: [Listener Community Network](../rfc/listener-community-network.md)
- Architecture:
  [Listener Community Network Architecture](../architecture/listener_community_network.md)
- Feature: [Resonate Shows](resonate_shows.md)
- Feature: [Analytics Event Ledger](analytics_event_ledger.md)
- Feature: [Analytics Consent And Retention Policy](analytics_consent_retention_policy.md)
