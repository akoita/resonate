---
title: "Shows Campaign Rooms Plan"
status: in-progress
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/1000"
parent_epic: "https://github.com/akoita/resonate/issues/996"
---

# Shows Campaign Rooms Plan

## Purpose

Shows campaign rooms connect the community layer to fan-funded live campaigns.
The goal is to turn a pledge into a living supporter space: backers can gather,
artists and operators can post campaign updates, fans can signal city demand,
and analytics can connect community participation to campaign conversion.

This plan intentionally splits #1000 into small, reviewable slices. Each slice
must be marked `implemented`, `partial`, `deferred`, or `planned` before #1000
is closed.

## Current Foundation

Implemented foundations available before this issue:

- `ShowCampaign`, `ShowCampaignTier`, `ShowPledge`, and `ShowCampaignEvent`
  persist campaign, tier, pledge, and lifecycle state.
- Confirmed pledges use `ShowPledge.status = confirmed` and
  `confirmationStatus = confirmed`.
- `CommunityRoom`, `CommunityMembership`, `CommunityMessage`, and
  `CommunityModerationReport` persist off-chain community state.
- `CommunityEligibilityService` already supports a private
  `campaign_support` policy against `ShowPledge` without exposing wallet
  holdings or support details.
- `CommunityRoomsService` handles join/leave, messages, announcements, report,
  delete, member moderation, room status, and compact `community.*` events.

## Slice 1: Supporter Room MVP

Status: `implemented`

Purpose:

- prove the core loop: support a campaign, unlock its supporter room, read or
  post in that room, and let artists/operators post campaign updates.

Deliverables:

- Add campaign-backed community room creation/read for Shows campaigns.
- Use `ownerType = show_campaign`, `ownerId = campaign.id`, and room types such
  as `show_campaign_supporter` so campaign rooms do not collide with artist
  rooms.
- Gate supporter-room join through `campaign_support` eligibility with
  `minStatus = confirmed`.
- Add `campaign_update` as an allowed community message type for campaign
  rooms.
- Let campaign artists/operators create campaign update messages.
- Let confirmed backers join the supporter room and read/write normal messages.
- Emit compact analytics for supporter-room join and campaign update creation.
- Add backend API and frontend API helpers for:
  - `GET /shows/campaigns/:campaignId/community`
  - `POST /shows/campaigns/:campaignId/community/join`
- Add artist/operator update API:
  - `POST /shows/campaigns/:campaignId/community/updates`
- Add a minimal Shows detail entry point that explains locked, joinable, joined,
  and unavailable states.

Implementation notes:

- Supporter rooms are created read-time for active escrow campaigns with
  `roomType = show_campaign_supporter`, `ownerType = show_campaign`, and
  `ownerId = campaign.id`.
- Join access uses the existing private `campaign_support` eligibility policy
  with `minStatus = confirmed`.
- Confirmed supporters join with membership role `supporter` and source
  `campaign_support`.
- Campaign update messages use `messageType = campaign_update`; message bodies
  stay out of analytics payloads.
- Shows detail pages now expose a supporter-room panel with connected, locked,
  joinable, joined, update, and message states.

Out of scope for Slice 1:

- city demand groups;
- supporter badge/profile display;
- Discord bridge;
- full operator/admin moderation dashboard;
- automatic room creation for every historical campaign without a read-time
  backfill path.

## Slice 2: City Demand Groups

Status: `implemented`

Deliverables:

- Add city demand room or membership source for campaign city/region interest.
- Allow fans to join the city demand group without requiring a confirmed pledge.
- Keep location coarse and user-controlled; do not expose raw IP, GPS, or exact
  address data.
- Emit `community.show_city_interest_joined`.
- Add UI states for joining city demand from Shows detail.

Implementation notes:

- Shows campaign community reads now include an open `show_city_demand` room
  when the campaign is in a demand-forming lifecycle.
- City demand rooms use `ownerType = show_campaign` and `ownerId = campaign.id`
  so demand membership stays tied to the campaign without new schema.
- Fan-created `signal` campaigns can expose city demand before escrow
  activation, while supporter rooms remain active-escrow-only.
- Joining city demand grants an active membership with role `city_member` and
  source `city_interest`; it does not require a pledge or wallet ownership
  proof.
- Analytics emits `community.show_city_interest_joined` with campaign id/slug,
  room id/type, artist id, and coarse city/country only.
- Shows detail community UI now separates the open city demand action from the
  private supporter room action.

## Slice 3: Supporter Badges And Roles

Status: `planned`

Deliverables:

- Grant or derive campaign supporter roles from confirmed pledges.
- Prepare profile-visible campaign support badges behind existing listener
  visibility controls.
- Revoke or adjust roles when pledge/campaign state moves to refund, failed,
  or released states according to policy.
- Document badge visibility, privacy boundaries, and revocation behavior.

## Slice 4: Campaign Conversion Analytics

Status: `planned`

Deliverables:

- Bridge campaign room join, city interest join, campaign update view, and
  campaign/community conversion events into the analytics ledger.
- Keep payloads compact: campaign id/slug/status, room id/type, pledge id where
  relevant, coarse campaign geo, and actor/subject references.
- Exclude message bodies, report free text, wallet holdings, private support
  history, raw location, and transaction metadata not already approved for
  analytics.
- Update analytics taxonomy and feature docs.

## Slice 5: Lifecycle Reconciliation

Status: `planned`

Deliverables:

- Define how memberships and roles change when pledges become refunded, failed,
  released, or campaign state changes to cancelled/refund/refunded/released.
- Add idempotent reconciliation behavior or read-time access checks so revoked
  support cannot keep granting sensitive access.
- Add tests for active, confirmed, refunded, failed, cancelled, and released
  campaign/pledge combinations.

## Initial PR Scope

The first PR for #1000 implements Slice 1 only. It should be small enough to
validate locally with:

- focused backend controller/service tests for campaign room read/join/access;
- focused community eligibility tests for confirmed pledge access;
- focused analytics event tests for campaign room join/update;
- focused frontend tests for Shows detail campaign room states;
- `git diff --check`;
- package lint/type checks only where touched.

## Acceptance Mapping

| #1000 Acceptance Criteria | Planned Slice |
| --- | --- |
| Confirmed campaign backers can join the campaign supporter room. | Slice 1 |
| Fans can join a city demand group for a show campaign. | Slice 2 |
| Artists/operators can post campaign updates to campaign rooms. | Slice 1 |
| Campaign support can grant badges or roles. | Slice 3 |
| Community participation events connect to campaign/show analytics. | Slices 1 and 4 |
| Access is revoked or adjusted when campaign/pledge state requires it. | Slice 5 |

## References

- [Listener Community Network](listener_community_network.md)
- [Listener Community Network Execution Plan](listener_community_network_execution_plan.md)
- [Listener Community Network Architecture](../architecture/listener_community_network.md)
- [Resonate Shows](resonate_shows.md)
