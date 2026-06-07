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
The blockchain membership boundary is documented in
[Blockchain-Native Community Membership Boundaries](../rfc/community-membership-boundaries.md).
Public supporter and collector credential product rules are documented in
[Public Supporter And Collector Credential Rules](../rfc/public-supporter-collector-credential-rules.md).
Show attendance credential boundaries are documented in
[Show Attendance Credential Boundaries](../rfc/show-attendance-credential-boundaries.md).

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

Joined cohorts now also provide a privacy-safe discovery context for the
authenticated listener. `CommunityCohortService.getDiscoveryContextForUser()`
returns only joined, consented, active/suggested, unexpired cohorts that meet
the minimum visible-size threshold. Home recommendations and AI DJ selection use
that bounded context as an additive ranking signal and return safe explanation
copy such as "From your Dream Pop listeners cohort." Suggested-only, left,
hidden, stale, expired, archived, below-threshold, and consent-disabled cohorts
do not influence discovery.

This serving path is transactional and does not require Dataflow, BigQuery, or
warehouse materializations. Batch/streaming analytics may enrich aggregate
reporting later, but the core listener UX uses current cohort membership and
governed event data already available to the app.

Cohort detail can also show a capped preview of joined members who explicitly
make their community profile visible. Public and community-visible profiles can
appear as small profile summaries for authenticated listeners who can access
the cohort. Public profiles can link to their public profile route, while
community-visible profiles remain contextual summaries without stable public
profile links or exposed stable user identifiers. Private, follower-scoped,
suggested-only, left, hidden, consent-disabled, expired, archived, and
below-threshold members remain anonymous. The UI explains whether the current
listener can appear based on their profile visibility, joined status, and
taste/city matching consent.

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
| Artist community tab | implemented | `/artist/:id` exposes the Community tab with public and holder rooms, safe holder lock copy, join/leave controls, messages, artist announcements, reports, deletion, and basic message-author moderation actions. Holder rooms use NFT-verifiable access in [#1096](https://github.com/akoita/resonate/issues/1096): existing indexed stem/NFT ownership or private holder roles can unlock off-chain room membership, access responses expose only bounded reason codes, and moderation bans/removals still override ownership. Release-defined public artists with ready or published official catalog releases auto-provision default public and holder rooms on first room read, so public artist identity is not tied to the uploader or manager profile. `/admin/community/moderation` gives admins an operator-only queue for reports, room state, message previews, membership-count context, report resolution, message deletion, member removal/bans, and room pause/archive actions without returning wallet addresses, user emails, or access-policy payloads. |
| Taste cohort suggestions | implemented | Backend cohort contracts are implemented for opt-in, off-chain suggested groups. `GET /community/cohorts/suggestions` only returns cohorts assigned to the authenticated listener and gated by `allowTasteMatching` or `allowCityScenes`; `GET /community/cohorts/:cohortId` returns authenticated detail only for visible suggested/joined memberships and includes safe aggregate context, bucketed member-count copy, capped opt-in member profile previews, current-listener visibility copy, music-native next actions, and explicit privacy redactions; `POST /community/cohorts/:cohortId/join`, `/leave`, and `/hide` update mutable membership state. Minimum-size, expiry/archive, safe-explanation, profile-visibility, joined-membership, and matching-consent filters prevent exposing private listener identities, raw listening history, wallet data, ownership data, exact private counts, or private location facts. `/community` exposes listener cohort cards with safe explanations, join, leave, hide, empty, loading, disabled-consent states, and a detail panel in [#1052](https://github.com/akoita/resonate/issues/1052), [#1069](https://github.com/akoita/resonate/issues/1069), and [#1070](https://github.com/akoita/resonate/issues/1070); `/settings` keeps privacy/profile controls and points cohort participation to the Community hub. `GET /community/cohorts/:cohortId/room` and `POST /community/cohorts/:cohortId/room/join` activate lightweight cohort-scoped rooms for joined members only in [#1071](https://github.com/akoita/resonate/issues/1071); suggested, left, hidden, stale, expired, archived, below-threshold, or consent-disabled cohorts do not expose rooms, and cohort room messages redact other listeners as generic cohort members while reports flow through `/admin/community/moderation`. `POST /admin/community/cohorts/generate` materializes cohorts from safe transactional library/taste, artist-affinity, campaign, coarse city-scene, and collector signals in [#1054](https://github.com/akoita/resonate/issues/1054), marks no-longer-eligible visible memberships stale before threshold counts are recomputed, activates cohorts that meet `minimumSize`, archives below-threshold cohorts, and expires generated cohorts with no current eligible visible members in [#1059](https://github.com/akoita/resonate/issues/1059). `GET /admin/community/cohorts/quality` adds privacy-safe aggregate operator metrics for lifecycle health, generated-cohort health, stale memberships, disabled-consent filtering, action events, cohort types, and bounded reason-code summaries in [#1064](https://github.com/akoita/resonate/issues/1064). `/admin/community/cohorts` lets admins run the real generator, choose a staging validation `minimumSize` down to the backend floor of 2, inspect generation summaries, and see why no listener card can appear when real opted-in shared-signal data is missing in [#1066](https://github.com/akoita/resonate/issues/1066). The `/community` cohort detail panel opens an in-place cohort room conversation for active room members — recent messages, a composer, delete-your-own, report, and read-only paused/archived handling, plus empty/loading/error states — reusing the shared community room message APIs (`GET`/`POST /community/rooms/:roomId/messages`, `DELETE`/report) with peers shown as "Cohort member" (never raw ids) in [#1082](https://github.com/akoita/resonate/issues/1082). |
| City scene pages | planned | Local scene surfaces tied to declared coarse location and privacy-safe aggregate demand. |
| Campaign rooms | implemented | Shows detail pages expose campaign community rooms: any authenticated fan can join an open `show_city_demand` group for coarse city interest, confirmed backers can unlock a private `show_campaign_supporter` room, artists/operators can post campaign updates, and compact campaign/community analytics now cover joins, city demand, campaign update creation/views, badge grants, and role grants. Confirmed or released pledge support derives private supporter badges/roles for eligibility and can appear as campaign-support cards on public profiles only by listener opt-in. Refund-only, refunded, failed, and cancelled lifecycle states revoke private supporter proofs, remove stale private room access on read, and stop public support cards from displaying. See [#1048](https://github.com/akoita/resonate/issues/1048) and the [Shows Campaign Rooms Plan](shows_campaign_rooms_plan.md). |
| Holder benefit engine | in-progress | Backend foundation for private badge, role, ownership, campaign-support, and redemption eligibility is being built in [#998](https://github.com/akoita/resonate/issues/998). |
| Discord bridge | planned | Artist-controlled connection for announcements, role mirroring, community links, or migration paths. |
| Blockchain-native membership boundary | documented | [#1084](https://github.com/akoita/resonate/issues/1084) defines when NFT-backed or NFT-verifiable community credentials make sense and why private taste cohorts, city cohorts, cohort rooms, messages, reports, moderation state, and profile visibility preferences stay off-chain. [#1097](https://github.com/akoita/resonate/issues/1097) adds public supporter and collector credential product rules: do not mint a new NFT-backed credential yet; use off-chain opt-in public badges and existing ownership/support proofs first, with explicit transferability, revocation, expiry, opt-in, metadata, privacy, moderation, and recovery rules. [#1098](https://github.com/akoita/resonate/issues/1098) adds show attendance credential boundaries: do not mint a new attendance NFT yet; use off-chain opt-in attendance badges and event-scoped proofs first, keep city-scene membership off-chain, and handle cancellation, refund, no-show, delayed check-in, guest-list, revocation, expiry, and privacy rules before implementation. See [Blockchain-Native Community Membership Boundaries](../rfc/community-membership-boundaries.md), [Public Supporter And Collector Credential Rules](../rfc/public-supporter-collector-credential-rules.md), and [Show Attendance Credential Boundaries](../rfc/show-attendance-credential-boundaries.md). |
| Moderation console | implemented | `/admin/community/moderation` exposes open community reports, bounded room/message context, membership status counts, advisory AI assist summaries/risk hints from privacy-bounded moderation DTOs, and admin actions for dismiss, delete message, remove/ban member, pause room, and archive room. The assist defaults to deterministic mode and can be switched to model-backed summaries with `COMMUNITY_MODERATION_ASSIST_STRATEGY=model-assisted`; model prompts use only bounded report reason, room title/type/status, message preview/status/type, aggregate report counts, and membership status counts, with email and wallet-like strings redacted. Missing credentials, timeouts, malformed model output, invalid enums, or queue-cap exclusions fall back to deterministic assist. Queue hydration caps model-backed reports and per-process model concurrency so one admin load cannot fan out across the full report limit. The assist is read-only and never auto-deletes, bans, pauses, archives, or resolves reports; a human admin must choose and confirm any action. See [#1083](https://github.com/akoita/resonate/issues/1083) and [#1094](https://github.com/akoita/resonate/issues/1094). |

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
retention/consent notes are now implemented for the first governance slice in
[#1037](https://github.com/akoita/resonate/issues/1037): admins can triage
open reports at `/admin/community/moderation`, inspect bounded room/message
context, and resolve reports without exposing wallet addresses, user emails,
or raw access-policy JSON. The moderation assist now has an explicit backend
service boundary: deterministic assist remains the default deployed mode, while
`COMMUNITY_MODERATION_ASSIST_STRATEGY=model-assisted` can opt into model-backed
summaries with strict prompt bounds, redaction, timeout, malformed-output, and
post-validation fallback guards. Model-backed queue hydration is capped per
response and per-process concurrency is bounded, while uncapped reports still
receive deterministic assist. Operator notes are accepted for workflow context
but not persisted in this first slice; durable note/audit storage remains a
follow-up if moderation policy requires it.

## Blockchain-Native Boundary

The community layer should be blockchain-native where blockchain primitives
make community utility more open, verifiable, portable, and interoperable. This
means evaluating on-chain ownership, membership, credentials, escrow, rights,
rewards, and settlement whenever a community feature touches those domains. It
does not mean putting normal social behavior on-chain.

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
web3-native value for ownership, escrow, royalties, credentials, holder
benefits, and partner composability.

## AI-Native Uses

AI should be considered anywhere it can make discovery, safety, artist insight,
creative flow, or operator triage more adaptive and useful. It should make the
community feel more understandable and alive, not automated or fake.

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
- `recommendation.generated` with aggregate `cohortInfluence`
- `agent.selection` / `agent.track_selected` with aggregate `cohortInfluence`
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
