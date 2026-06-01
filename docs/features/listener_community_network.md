---
title: "Listener Community Network"
status: in-progress
owner: "@akoita"
depends_on:
  - agent_taste_intelligence
  - geo_analytics_demand_dimension
  - resonate_shows
  - punchline_drops_mvp
  - remix_studio
  - agent-commerce-runtime
---

# Listener Community Network

## Status

`in-progress`

The Listener Community Network is a planned first-class social layer for
Resonate. The first implementation slice is underway: listeners can create and
govern a privacy-first community profile foundation before chat, rooms,
benefits, or matching launch. The design goal is to make listener community
emerge from music behavior instead of forcing users into a generic social
network.

The deeper product strategy is documented in
[Listener Community Network RFC](../rfc/listener-community-network.md). The
build breakdown is documented in
[Listener Community Network Execution Plan](listener_community_network_execution_plan.md).
The technical service boundary is documented in
[Listener Community Network Architecture](../architecture/listener_community_network.md).

## Audience

- Listeners who want to discover people with similar taste, local scenes, and
  artist communities.
- Artists who want direct fan relationships, demand signals, and durable
  community surfaces outside generic social platforms.
- Collectors and supporters who want to show marketplace items, stems, badges,
  and campaign participation on their profile.
- Promoters, venues, and artist teams who need city-level demand and fan
  coordination for Shows.
- Backend, frontend, analytics, protocol, and agent developers building the
  graph, privacy, reputation, incentives, and moderation layers.

## Value

The community layer should benefit both listeners and artists.

For listeners, it creates:

- human connection around shared music taste;
- local cultural belonging through city and scene groups;
- status for support, curation, attendance, remixing, and collecting;
- access to artist rooms, holder benefits, drops, campaigns, and shows;
- optional material benefits such as discounts, early access, rewards, or
  platform privileges.

For artists, it creates:

- direct fan relationships not fully mediated by Discord, Instagram, TikTok,
  YouTube, or streaming-platform algorithms;
- higher retention around releases, drops, campaigns, and Shows;
- better signals about cities, scenes, collectors, and supporter intent;
- new conversion paths from listening to collecting, funding, attendance,
  remixing, and advocacy;
- a structured community surface that remains music-native.

The product thesis:

> Resonate should turn passive listeners into active cultural participants, and
> turn isolated artist audiences into community-supported creative economies.

## Product Principles

1. **Emergent, not forced.** Do not require users to join a social network before
   they feel a reason. Trigger social moments from listening, support, locality,
   release activity, campaigns, shows, remixing, and collecting.
2. **Music-native social objects.** The social object should be a track, stem,
   release, artist, campaign, show, collectible, playlist, remix, or local scene,
   not a blank post composer.
3. **Mutual value.** Every mechanism should improve listener connection,
   artist revenue, discovery quality, cultural contribution, or real-world
   coordination.
4. **Multiple paths to status.** Paid ownership can grant privileges, but status
   must also come from non-financial contribution: curation, attendance,
   helpfulness, remixing, moderation, and early discovery.
5. **Privacy by default.** Listening, location, ownership, and wallet-adjacent
   signals are sensitive. Profile and community visibility must be opt-in and
   layered.
6. **Discord bridge before Discord replacement.** The MVP should let artists keep
   using Discord while Resonate becomes the richer music-aware system of record.

## Planned Core Loops

### Taste Cohorts

Listeners can opt into small groups formed by shared taste, artist affinity,
subgenre, release activity, collector behavior, or listening recency.

Examples:

- "You and 18 listeners are early fans of this artist."
- "Five people in Lyon saved this release this week."
- "This listener also collects stems from your top three artists."

### City Scenes

City and region groups connect the community layer to
[Geo Analytics Demand Dimension](geo_analytics_demand_dimension.md) and
[Resonate Shows](resonate_shows.md).

Examples:

- local artist rooms;
- show demand maps;
- city-specific campaign channels;
- local listening parties;
- post-show memories, badges, and follow-up drops.

### Artist Rooms

Each artist can have a structured community surface with:

- announcements;
- release discussion;
- supporter and collector rooms;
- campaign rooms;
- show city rooms;
- polls and questions;
- listening parties;
- remix and creator channels.

The MVP should be simpler than Discord, but more aware of Resonate-specific
objects such as tracks, stems, campaigns, shows, purchases, licenses, and
collector status.

### Campaign Missions

[Resonate Shows](resonate_shows.md), future release campaigns, and other
fan-funded initiatives should create temporary social missions.

Planned mechanics:

- supporter room for each campaign;
- milestone unlocks;
- referral and advocacy attribution;
- fan questions and artist updates;
- city-level coordination;
- proof of support badges;
- post-campaign transition into show, release, or collector communities.

### Marketplace Identity And Privileges

Marketplace items, especially stem-formatted NFTs and collectible drops, can
become visible cultural credentials when the listener opts in.

Listeners should be able to show:

- owned stems;
- owned punchline or moment collectibles;
- edition number and collection set progress;
- artist-supported badges;
- campaign backing proofs;
- show attendance proofs;
- remix rights or remix participation where applicable.

Ownership can unlock:

- artist room access;
- holder-only chat channels;
- early access to drops or tickets;
- merch or platform discounts;
- reduced marketplace fees where policy allows;
- collector badges;
- voting in non-financial community decisions;
- remix challenge eligibility;
- private listening parties;
- artist airdrops or rewards.

The default language should be "proof of support" and "holder benefits," not
"investment status." This reduces speculation pressure and keeps cultural
belonging central.

### Reputation

Reputation should combine financial and non-financial contribution.

Potential reputation dimensions:

- early listener;
- supporter;
- collector;
- curator;
- local ambassador;
- show attendee;
- remix contributor;
- helpful community member;
- trusted moderator;
- campaign advocate.

Avoid a single global score. Use contextual badges and roles so users can be
recognized without turning community into a leaderboard.

## Planned Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Listener profile showcase | in-progress | `/settings` exposes profile identity and visibility controls; public profile reads redact hidden/private sections. Confirmed Shows pledge support can appear on public profiles only when `showCampaignSupport` is enabled; private supporter badges/roles remain eligibility proofs. Display of owned marketplace items, attendance, playlists, remixes, and broader roles remains follow-up work. |
| Artist community tab | implemented | `/artist/:id` exposes the Community tab with public and holder rooms, safe holder lock copy, join/leave controls, messages, artist announcements, reports, deletion, and basic message-author moderation actions. Release-defined public artists with ready or published official catalog releases auto-provision default public and holder rooms on first room read, so public artist identity is not tied to the uploader or manager profile. Broader operator/admin governance remains tracked in [#1037](https://github.com/akoita/resonate/issues/1037). |
| Taste cohort suggestions | partial | Backend cohort contracts are implemented for opt-in, off-chain suggested groups. `GET /community/cohorts/suggestions` only returns cohorts assigned to the authenticated listener and gated by `allowTasteMatching` or `allowCityScenes`; `POST /community/cohorts/:cohortId/join`, `/leave`, and `/hide` update mutable membership state. Minimum-size, expiry/archive, and safe-explanation filters prevent exposing other listener identities, raw listening history, wallet data, ownership data, or private location facts. Cohort generation jobs and frontend cards remain follow-up work. |
| City scene pages | planned | Local scene surfaces tied to declared coarse location and privacy-safe aggregate demand. |
| Campaign rooms | implemented | Shows detail pages expose campaign community rooms: any authenticated fan can join an open `show_city_demand` group for coarse city interest, confirmed backers can unlock a private `show_campaign_supporter` room, artists/operators can post campaign updates, and compact campaign/community analytics now cover joins, city demand, campaign update creation/views, badge grants, and role grants. Confirmed or released pledge support derives private supporter badges/roles for eligibility and can appear as campaign-support cards on public profiles only by listener opt-in. Refund-only, refunded, failed, and cancelled lifecycle states revoke private supporter proofs, remove stale private room access on read, and stop public support cards from displaying. See [#1048](https://github.com/akoita/resonate/issues/1048) and the [Shows Campaign Rooms Plan](shows_campaign_rooms_plan.md). |
| Holder benefit engine | in-progress | Backend foundation for private badge, role, ownership, campaign-support, and redemption eligibility is being built in [#998](https://github.com/akoita/resonate/issues/998). |
| Discord bridge | planned | Artist-controlled connection for announcements, role mirroring, community links, or migration paths. |
| Moderation console | planned | Artist/team tools plus platform safety workflows, AI summaries, and abuse reports. |

## Data And Privacy

The social graph should never assume that every listener wants public identity.
Visibility controls should support:

- private;
- artist-visible;
- community-visible;
- follower-visible;
- public.

Sensitive signals include:

- listening history;
- inferred taste;
- city or region;
- wallet addresses;
- marketplace ownership;
- spending, pledge, and campaign behavior;
- attendance;
- social messages.

Privacy requirements:

- listening activity opt-in before social matching;
- coarse location by default, no raw GPS requirement for community formation;
- profile ownership display opt-in;
- wallet address hidden unless explicitly exposed;
- private support allowed even when benefits are active;
- explainable matching copy that states why a cohort or user was suggested.

## Current Implementation

The M1 profile foundation provides:

- `CommunityProfile` persistence with display name, short bio, optional avatar
  URL, and `private`, `community`, `followers`, or `public` profile visibility;
- `CommunityVisibilitySettings` persistence with opt-in flags for taste badges,
  owned items, campaign support, show attendance, playlists, wallet address,
  future taste matching, and future city/scene matching;
- authenticated self-profile APIs:
  - `GET /community/profile/me`
  - `PATCH /community/profile/me`
- public profile read:
  - `GET /community/profile/:userId`
- `/settings` Community Profile controls for identity, profile visibility, and
  showcase flags;
- public profile route:
  - `/community/profile/:userId`

Public profile reads currently expose only profiles with
`profileVisibility = public`. Wallet address and future showcase sections are
redacted unless the listener explicitly enables each section. Ownership-based
eligibility for future benefits remains separate from public ownership display.

The active M2 holder-benefits slice is tracked in
[Community Badges, Roles, And Holder Benefits Plan](community_holder_benefits_plan.md).
It adds private badge, role, benefit-rule, and redemption foundations before
public artist-room or listener benefit UI is exposed.

The M3 artist-community slice is tracked in
[Artist Community Tab Plan](artist_community_tab_plan.md). The backend substrate
for off-chain rooms, membership, messages, reports, and moderation is
implemented. The artist page now exposes a Community tab that reads public rooms,
uses authenticated room reads for membership-aware state, lets artists enable
rooms and post announcements, lets listeners join/leave rooms, and exposes
message report/delete plus basic member remove/ban controls from visible
message authors. Operator/admin governance, moderation dashboards, and
retention/consent notes are explicit follow-up work in
[#1037](https://github.com/akoita/resonate/issues/1037).

## Blockchain Boundary

The community layer should use blockchain where it improves trust,
portability, ownership, or settlement. It should not put normal social behavior
on-chain.

On-chain or contract-backed surfaces:

- stem NFT and collectible ownership proofs;
- marketplace purchase and royalty settlement;
- Shows campaign escrow, pledges, refunds, and release conditions;
- artist/drop/campaign authority where a durable public proof is useful;
- optional attendance or supporter proofs when users want portability;
- portable holder credentials that partner tools can verify.

Off-chain product surfaces:

- profiles and visibility settings;
- chat messages, comments, reactions, follows, and room membership state;
- taste matching, cohort suggestions, city scene membership, and social graph;
- moderation reports, bans, deletes, and safety actions;
- private badges, reputation context, analytics, and recommendation signals.

Hybrid access pattern:

1. A listener owns or earns an on-chain asset or proof.
2. Resonate indexes or verifies that proof.
3. The backend grants an off-chain role, badge, or benefit eligibility.
4. The listener decides whether to display it publicly.
5. Economic redemption uses on-chain settlement only when money, assets, escrow,
   or transferable rights require it.

This keeps the user experience fast, private, and moderatable while preserving
web3-native value for ownership, escrow, royalties, credentials, and holder
benefits.

## AI And ML Uses

AI should support discovery, safety, and artist insight without making the
community feel automated.

Planned uses:

- taste embedding and cohort matching;
- city and scene clustering;
- safe explanations for why users, rooms, or campaigns are suggested;
- artist summaries of fan questions and themes;
- moderation triage and toxicity detection;
- campaign conversion prediction;
- show demand forecasting;
- fraud, spam, and sybil-risk detection;
- personalized holder benefit suggestions.

AI should not auto-post as fans, simulate community activity, expose raw private
signals, or create manipulative pressure to buy.

## Events And Analytics

The community layer should integrate with
[Analytics Event Ledger](analytics_event_ledger.md).

Candidate event families:

- `community.profile_visibility_updated`
- `community.cohort_suggested`
- `community.cohort_joined`
- `community.room_joined`
- `community.message_created`
- `community.message_reported`
- `community.badge_granted`
- `community.role_granted`
- `community.benefit_unlocked`
- `community.benefit_redeemed`
- `community.campaign_referral_created`
- `community.show_city_interest_joined`
- `community.discord_bridge_connected`

Primary product metrics:

- social opt-in rate;
- cohort join conversion;
- D7/D30 retention lift for community participants;
- artist room activation rate;
- messages or reactions per active community user;
- community-to-campaign conversion;
- community-to-show pledge conversion;
- holder benefit redemption;
- successful local scene formation;
- moderation burden per active community.

## MVP Scope

### In Scope

1. Listener profile showcase with opt-in badges and owned marketplace items.
2. Artist community tab with announcements and release discussion.
3. Holder-only artist room based on owned stem NFT or collectible ownership.
4. Shows campaign room connected to campaign support and city demand.
5. Basic reputation badges for early listener, supporter, collector, and show
   attendee.
6. Privacy controls for listening visibility, city visibility, and ownership
   display.
7. Analytics events for joins, visibility changes, role grants, and benefit
   redemption.

### Out Of Scope For MVP

- open-ended global feed;
- general-purpose direct messaging;
- broad public follower graph;
- automated token trading incentives;
- algorithmic public rankings of fans;
- raw wallet exposure;
- fully replacing Discord;
- on-chain governance for artist communities;
- financial return promises tied to community status.

## Verification

When implemented, verification should include:

- backend integration tests for profile visibility, role grants, holder benefit
  eligibility, campaign room membership, and privacy enforcement;
- contract or indexer tests where marketplace ownership controls access;
- frontend tests for profile showcase, artist community tab helpers, campaign
  room, and holder-only states;
- analytics tests for community event emission and consent boundaries;
- abuse tests for blocked users, reported messages, moderation actions, and
  hidden ownership;
- Playwright tests for listener opt-in, holder room access, and Shows campaign
  conversion paths.

## References

- RFC: [Listener Community Network](../rfc/listener-community-network.md)
- Execution plan:
  [Listener Community Network Execution Plan](listener_community_network_execution_plan.md)
- Architecture:
  [Listener Community Network Architecture](../architecture/listener_community_network.md)
- Feature: [Resonate Shows](resonate_shows.md)
- Feature: [Punchline Drops](punchline_drops_mvp.md)
- Feature: [Remix Studio](remix_studio.md)
- Feature: [Agent Taste Intelligence](agent_taste_intelligence.md)
- Feature: [Geo Analytics Demand Dimension](geo_analytics_demand_dimension.md)
- Feature: [Analytics Consent And Retention Policy](analytics_consent_retention_policy.md)
