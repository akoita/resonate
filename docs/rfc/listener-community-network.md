---
title: "Listener Community Network RFC"
status: draft
owner: "@akoita"
---

# Listener Community Network RFC

## Summary

Resonate should ship a listener community layer from the first versions of the
product, but the layer should emerge from music behavior rather than ask users
to join yet another generic social network.

The objective is to make Resonate the reference address where fans, artists,
collectors, curators, remixers, and local scenes interact around music-native
objects:

- artists;
- tracks;
- releases;
- stems;
- collectible NFTs;
- playlists;
- remixes;
- campaigns;
- shows;
- cities;
- scenes.

This community layer should create both human and material value:

- listeners find people, culture, identity, access, and rewards;
- artists gain direct relationships, demand signals, retention, revenue, and
  campaign conversion;
- the platform turns passive listening into active cultural participation.

## Problem

Artists and fans already interact across many external surfaces:

- artist social accounts on Instagram, TikTok, X, Threads, Facebook, WhatsApp,
  and similar platforms;
- YouTube and short video platforms;
- streaming apps such as Spotify, Apple Music, Deezer, and others;
- Discord servers and private chat groups.

This creates fragmentation:

- streaming apps know listening behavior but are weak at community;
- social platforms know attention but are not music-rights or music-commerce
  native;
- Discord is powerful for communities but generic;
- artists must constantly rebuild audiences across channels;
- fans with similar taste, same city, or shared artist support often remain
  invisible to each other.

Resonate can differentiate by making social interaction a first-class music
primitive instead of a late add-on.

## Strategic Lessons

### What Successful Social Networks Usually Got Right

Successful social products often start with one strong graph or loop:

- real-world identity and relationships;
- interest-based communities;
- creation and distribution;
- private communication utility;
- live presence and ritual;
- visible reputation;
- creator monetization;
- local or event-based coordination.

For Resonate, the strongest native loops are:

- taste graph;
- artist-fan graph;
- local scene graph;
- supporter and collector graph;
- campaign and show graph;
- creator/remixer graph.

### Why Generic Music Social Often Struggles

Music platforms already have attention, but social behavior is habit-based. If a
product spent years training users that it is where they listen, users may keep
using Instagram, WhatsApp, TikTok, Discord, and YouTube for interaction.

Generic additions such as a feed, comments, or direct messaging may not be
enough because they do not create a new reason to move social behavior into the
music app.

The lesson is not that music social fails. The lesson is that social mechanics
must be native to music action:

- discover;
- support;
- collect;
- attend;
- remix;
- curate;
- fund;
- organize;
- unlock;
- belong.

## Product Thesis

> Resonate should not copy Discord, Instagram, or Spotify social features. It
> should create a music-native social graph where listening, ownership, support,
> locality, and artist participation become reasons for people to interact.

The most important design move is to avoid an empty social network. Do not ask a
new listener to "post something." Instead, show them a meaningful social moment:

- "You and 12 people in your city are early supporters of this artist."
- "Owning this stem unlocks the collector room and 15% merch discount."
- "This campaign needs 40 more backers in Paris to unlock the venue proposal."
- "Three listeners with your taste joined tonight's listening party."
- "This artist is asking supporters which city should host the next show."

## Target User Value

### Listener Value

Listeners should gain:

- discovery through people, not only algorithms;
- a sense of belonging around taste and locality;
- cultural status for early support, curation, collecting, attendance, and
  remixing;
- access to artist rooms and private moments;
- holder perks and discounts;
- show and campaign participation;
- safer ways to meet fans with similar taste;
- control over profile identity and visibility.

### Artist Value

Artists should gain:

- persistent fan community surfaces;
- direct communication independent of external platform algorithms;
- better fan segmentation by city, taste, support, and collector behavior;
- higher conversion into marketplace purchases, campaigns, and shows;
- demand forecasting for live events;
- community-driven release feedback;
- moderation and summarization tools;
- monetizable holder benefits that do not require speculative promises.

### Platform Value

Resonate should gain:

- differentiated retention;
- more surfaces for marketplace conversion;
- stronger Shows and campaign economics;
- richer first-party data with consent;
- a defensible social graph around music-native behavior;
- more reasons for artists to bring audiences into Resonate.

## Core Mechanisms

### 1. Profile As Cultural Passport

The listener profile should be a cultural passport, not a generic social page.
It can show:

- favorite artists, moods, scenes, and genres;
- early listener badges;
- supporter badges;
- marketplace collectibles;
- stem NFTs;
- show attendance proofs;
- campaign backing proofs;
- remix participation;
- playlists and curation;
- artist-recognized roles.

All sensitive sections must be opt-in.

### 2. Artist Rooms

Artist rooms are persistent community hubs. They should combine:

- announcements;
- release discussion;
- supporter chat;
- collector chat;
- campaign updates;
- show city channels;
- listening parties;
- polls and questions;
- moderation.

These rooms should be structured around Resonate data. For example, the artist
should be able to post directly to holders of a specific stem, backers of a
campaign, listeners in a city, or people who attended a show.

### 3. Taste Cohorts

Taste cohorts are small, explainable groups of listeners with overlapping music
behavior.

Good cohorts:

- are small enough to feel human;
- have a clear reason for existing;
- expire or refresh if activity fades;
- include opt-in controls;
- explain the match reason.

Bad cohorts:

- expose sensitive listening history without consent;
- create huge noisy rooms;
- overfit on private data;
- feel like automated spam.

### 4. City Scenes

City scenes connect discovery, Shows, and culture.

Potential uses:

- local fan groups;
- campaign demand formation;
- venue interest;
- local listening parties;
- artist city heatmaps;
- scene ambassadors;
- post-show continuity.

The system should rely on coarse, user-declared or privacy-safe location. Raw
GPS should not be required for normal community features.

### 5. Campaign Missions

Campaigns should become social missions, especially for Shows.

Examples:

- "Help bring this artist to your city."
- "Back this release to unlock a listening party."
- "If 100 holders collect this drop, the artist releases a bonus stem."
- "This city needs 20 more verified supporters to open venue talks."

Each campaign can have:

- public progress;
- supporter room;
- milestone unlocks;
- artist updates;
- referral tracking;
- backer badges;
- post-campaign continuation.

### 6. Marketplace Ownership And Privileges

Owned stems, collectible NFTs, and other marketplace items should become optional
social credentials and utility keys.

Potential privileges:

- artist room access;
- holder-only discussions;
- early ticket access;
- merch discounts;
- marketplace fee discounts;
- remix eligibility;
- private listening sessions;
- campaign boosts;
- collector badges;
- non-financial voting;
- artist rewards.

Guardrail:

> Ownership can grant access and recognition, but it should not become the only
> path to status or belonging.

### 7. Reputation Without Toxic Leaderboards

Use contextual badges and roles instead of a single global score.

Recommended reputation types:

- early listener;
- collector;
- supporter;
- show attendee;
- local ambassador;
- curator;
- remix contributor;
- campaign advocate;
- trusted moderator.

Avoid:

- global fan rankings;
- spend-only status;
- pay-to-speak rooms;
- speculative token scoreboards;
- public wallet wealth signaling.

### 8. Discord Bridge

Discord should be treated as an installed behavior, not an enemy.

MVP bridge options:

- link official artist Discord;
- mirror Resonate announcements to Discord;
- grant Discord roles based on Resonate ownership or support;
- import Discord community links into artist profiles;
- provide migration paths for artist teams that want Resonate-native rooms.

Long term, Resonate wins when its community surfaces are clearly better for
music-native actions, not when it tries to replace all chat behavior at once.

## Blockchain Boundary

The best tradeoff is a hybrid system:

> Use blockchain for credentials, ownership, rights, and settlement. Use
> off-chain systems for social interaction, privacy, moderation, discovery, and
> product experience.

### Good On-Chain Fits

- Stem NFT and collectible ownership.
- Marketplace settlement, royalties, and resale policy.
- Shows campaign escrow, pledge confirmation, refunds, and release conditions.
- Artist, drop, or campaign authority where public proof matters.
- Optional supporter, collector, or attendance proofs when users want portable
  identity.
- Holder credentials that can be verified by Resonate, Discord bridges, partner
  tools, or future agent flows.

### Bad On-Chain Fits

- Chat messages.
- Likes, reactions, comments, follows, and room presence.
- Taste matching and cohort membership.
- Listening history.
- City or location membership.
- Moderation reports, bans, deletes, appeals, and safety actions.
- Private profile settings.
- Reputation calculations.
- Any data users may reasonably expect to hide, edit, or delete.

### Recommended Access Pattern

The community layer should treat blockchain state as one input into product
eligibility, not as the product database.

Example flow:

1. A listener buys a stem NFT.
2. The marketplace contract records ownership and settlement.
3. Resonate's indexer or backend verifies the ownership.
4. The community service grants a holder role or benefit eligibility off-chain.
5. The listener can access the holder room.
6. The listener chooses whether the NFT appears on their public profile.
7. A discount or gated purchase can redeem against the benefit rule.
8. If redemption involves money, rights, or transferable assets, settlement can
   return to the contract layer.

This protects privacy and UX while preserving the value of public proof.

### Design Rule

If the data is high-volume, personal, mutable, safety-sensitive, or likely to
need deletion, keep it off-chain. If the data represents durable ownership,
escrow, settlement, rights, authority, or portable proof, consider blockchain.

## AI, Data, And Game Theory

### AI Uses

AI can help with:

- cohort matching;
- taste explanations;
- city and scene clustering;
- moderation triage;
- artist community summaries;
- campaign demand forecasting;
- show city recommendations;
- spam and sybil-risk detection;
- personalized holder benefit suggestions.

AI should not:

- create fake community activity;
- impersonate users;
- push manipulative purchase pressure;
- expose raw private listening history;
- hide why users were matched.

### Game Theory Design

Incentives should reward real contribution.

Good incentives:

- profile badges for early support;
- city milestones;
- group unlocks;
- discounts for holders;
- referral credit tied to real campaign conversion;
- curator recognition when recommendations drive saves, purchases, or show
  demand;
- artist-recognized roles.

Risky incentives:

- rewards based only on message volume;
- rewards based only on spend;
- public rankings that encourage harassment or spam;
- financial promises without legal and protocol clarity;
- referral loops that make communities feel like affiliate funnels.

## Suggested MVP

### Slice 1: Profile And Proofs

Deliver:

- listener profile sections for badges and marketplace items;
- opt-in visibility controls;
- ownership display for stem NFTs and collectible moments;
- early supporter, collector, and show attendee badges.

Why first:

- it gives social identity before complex community tools;
- it supports marketplace value immediately;
- it creates status objects for future rooms.

### Slice 2: Artist Community Tab

Deliver:

- artist announcements;
- release discussion;
- holder-only room;
- basic moderation/reporting;
- artist/team posting permissions.

Why second:

- artists need a home for fans before open network effects;
- rooms can be attached to real music objects.

### Slice 3: Shows And Campaign Rooms

Deliver:

- campaign supporter room;
- city demand group;
- milestone updates;
- campaign badges;
- conversion events.

Why third:

- Shows already needs coordination;
- the social layer can directly improve pledge conversion and show turnout.

### Slice 4: Taste Cohorts

Deliver:

- opt-in taste matching;
- small group suggestions;
- explainable match reasons;
- group lifecycle rules.

Why fourth:

- this requires stronger data, privacy, and moderation readiness.

### Slice 5: Discord Bridge

Deliver:

- official Discord link;
- role sync from Resonate ownership or badges;
- announcement mirroring;
- community migration analytics.

Why fifth:

- it respects existing artist workflows while proving Resonate-specific value.

## Open Product Questions

- Should listener-to-listener direct messaging exist in v1, or should
  interaction stay room-based first?
- Which holder benefits are platform-funded versus artist-funded?
- Should marketplace fee discounts apply globally, artist-by-artist, or by
  collection type?
- How should private ownership unlock benefits without exposing the item on a
  public profile?
- What is the minimum moderation surface required before artist rooms launch?
- Should city scenes be artist-specific first or cross-artist by genre/scene?
- How should Resonate prevent sybil behavior in campaign referrals and holder
  rewards?
- Which community actions are safe to put on-chain, and which should remain
  off-chain product state?

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Empty rooms | Trigger rooms from releases, campaigns, holders, shows, and cohorts only when enough users exist. |
| Pay-to-belong culture | Recognize curation, attendance, remixing, moderation, and early discovery alongside purchases. |
| Privacy backlash | Make listening, city, wallet, and ownership visibility opt-in with clear scopes. |
| Discord resistance | Start with bridge and role sync instead of replacement. |
| Spam and referral abuse | Add rate limits, reputation context, sybil detection, and conversion-quality scoring. |
| Artist moderation burden | Provide reports, role tools, AI summaries, and configurable room access. |
| Speculation pressure | Describe NFTs as collectibles, proofs, licenses, access keys, or supporter credentials, not as financial promises. |
| Cold-start failure | Seed from artist communities, Shows campaigns, drops, and local scenes rather than global feeds. |

## Success Metrics

Early metrics:

- profile social opt-in rate;
- ownership display opt-in rate;
- badge display opt-in rate;
- artist community tab visits;
- holder room join rate;
- campaign room join rate;
- campaign conversion lift from community participants;
- show pledge conversion by city scene;
- D7 and D30 retention lift for community participants;
- moderation reports per active room.

Mature metrics:

- percent of artists with active rooms;
- percent of marketplace purchases that unlock or redeem benefits;
- percent of Shows campaigns with active city communities;
- fan-to-fan recommendation conversion;
- artist revenue lift from community participants;
- external community bridge usage;
- successful Discord-to-Resonate migrations;
- local scene formation and repeated event attendance.

## Implementation Notes

Initial backend concepts:

- `CommunityProfile`
- `CommunityVisibilitySettings`
- `CommunityRoom`
- `CommunityMembership`
- `CommunityRole`
- `CommunityBadge`
- `CommunityMessage`
- `CommunityModerationReport`
- `CommunityBenefitRule`
- `CommunityBenefitRedemption`
- `CommunityCohort`
- `CommunityCohortMembership`

Potential role sources:

- marketplace ownership;
- campaign backing;
- show attendance;
- artist assignment;
- moderation trust;
- curation metrics;
- remix publication;
- early listening activity.

Potential access checks:

- item ownership;
- active campaign pledge;
- successful campaign backing;
- show attendance proof;
- artist/team membership;
- manual allowlist;
- profile privacy scope;
- blocked or banned status.

## Related Resonate Modules

- [Listener Community Network feature](../features/listener_community_network.md)
- [Listener Community Network Execution Plan](../features/listener_community_network_execution_plan.md)
- [Listener Community Network Architecture](../architecture/listener_community_network.md)
- [Resonate Shows](../features/resonate_shows.md)
- [Punchline Drops](../features/punchline_drops_mvp.md)
- [Remix Studio](../features/remix_studio.md)
- [Agent Taste Intelligence](../features/agent_taste_intelligence.md)
- [Geo Analytics Demand Dimension](../features/geo_analytics_demand_dimension.md)
- [Analytics Event Ledger](../features/analytics_event_ledger.md)
- [Analytics Consent And Retention Policy](../features/analytics_consent_retention_policy.md)
- [Marketplace Integration](../smart-contracts/marketplace_integration.md)
