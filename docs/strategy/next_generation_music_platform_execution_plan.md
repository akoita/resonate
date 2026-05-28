---
title: "Next-Generation Music Platform Execution Plan"
status: draft
owner: "@akoita"
depends_on:
  - docs/strategy/next_generation_music_platform_analysis.md
  - docs/features/listener_community_network.md
  - docs/features/listener_community_network_execution_plan.md
  - docs/architecture/listener_community_network.md
  - docs/features/agent_taste_intelligence.md
  - docs/strategy/agent_mediated_playback.md
  - docs/features/resonate_shows.md
  - docs/features/remix_studio.md
---

# Next-Generation Music Platform Execution Plan

## Goal

Turn Resonate from a set of advanced music, AI, commerce, and protocol
capabilities into one coherent product loop:

```text
listen -> understand -> act -> reward -> gather -> create -> prove value
```

The plan below prioritizes work that improves listener experience, artist
freedom, artist-listener relationships, and direct music-native monetization.

## Execution Principles

1. **Player first.** The player is the strongest place to connect discovery,
   action, rights, community, and artist intent.
2. **Privacy before social expansion.** Profiles and visibility must launch
   before rooms, cohorts, or listener-to-listener discovery.
3. **Utility before speculation.** Ownership should unlock access, proof,
   benefits, and cultural status without becoming the only path to belonging.
4. **Artist action before dashboards.** Analytics should lead to recommended
   actions artists can take.
5. **Rights before creation.** Remix and generation workflows must begin with
   eligibility, consent, license state, and provenance.
6. **Off-chain for community state.** Profiles, messages, rooms, moderation,
   cohorts, and privacy controls stay off-chain.

## Roadmap Overview

| Phase | Outcome | Main Existing Anchors |
| --- | --- | --- |
| P0 | Align docs, epics, and product language | #996, #997-#1002, feature catalog |
| P1 | External agent application UX | MCP server, x402 payments, OpenAPI, storefront contracts, receipts |
| P2 | Player action layer | player, catalog, marketplace, Shows, recommendations |
| P3 | Durable listener taste memory | Agent Taste Intelligence, analytics ledger |
| P4 | Community identity and holder utility | #997, #998 |
| P5 | Artist rooms and campaign rooms | #999, #1000, Resonate Shows |
| P6 | Rights-aware creative bridge | Remix Studio, licensing roadmap |
| P7 | Artist action cockpit | analytics dashboard, Shows, marketplace, rights |
| P8 | Taste cohorts and Discord bridge | #1001, #1002 |

## P0: Alignment And Tracking

Purpose:

- make sure the new product direction is visible in planning;
- prevent community, player, AI, marketplace, and Shows work from drifting into
  separate products.

Actions:

1. Add the Listener Community Network to the strategic roadmap.
2. Link #996 from any higher-level product roadmap or planning issue.
3. Keep #997-#1002 as milestone issues and require each implementation PR to
   cite the relevant milestone.
4. Add a cross-feature product rule: ownership eligibility and public ownership
   display must stay separate.
5. Add a cross-feature product rule: community interaction is off-chain unless
   it represents ownership, settlement, escrow, rights, authority, or portable
   proof.

Exit criteria:

- feature catalog includes Listener Community Network;
- architecture doc defines the community boundary;
- milestone issues are linked and scoped;
- privacy and moderation requirements are visible before implementation starts.

## P1: External Agent Application UX

Purpose:

- make Resonate easy, safe, and valuable for outside LLM and agentic
  applications to discover, request playback, quote, pay, license, download,
  verify, and recover from protocol-native music actions.

Why this matters:

- MCP and x402 already make Resonate usable by machine clients, but external
  agent UX is the quality of the contract those clients see: tool descriptions,
  schemas, quote flows, payment challenges, error codes, receipts, examples,
  and registry readiness.
- This is a distribution strategy for artists and catalog assets. Resonate
  should be callable from other agentic apps without a bespoke integration.

Core user stories:

- As an external agent developer, I can discover Resonate capabilities through
  stable machine-readable metadata.
- As an external agent, I can search catalog, identify licensable assets, quote
  a stem/license, and explain the cost and rights to my human user before
  spending.
- As an external agent, I can request music playback or queue changes for my
  owner only through a scoped playback capability and an active Resonate client.
- As an external agent, I can satisfy an x402 payment challenge and receive the
  paid stem resource plus a durable receipt.
- As an external agent, I can retry safely without double-spending.
- As an external agent, I can understand and recover from expired challenges,
  invalid proofs, disabled payment routes, unavailable license tiers, and
  settlement failures.
- As an artist, I gain distribution into external creator agents, coding
  assistants, wallet agents, remix tools, and music research workflows.

Suggested scope:

- Audit MCP, x402, OpenAPI, storefront, receipt, and error contracts as one
  external agent journey.
- Expand machine-readable capability metadata with:
  - supported tools and versions;
  - available license tiers;
  - payment asset and network;
  - facilitator information;
  - quote and purchase endpoints;
  - docs and example links.
- Improve MCP tool outputs with:
  - rights summary;
  - available next actions;
  - stable human summary fields;
  - policy constraints;
  - receipt and verification hints.
- Standardize agent-facing errors:
  - `PAYMENT_REQUIRED`;
  - `QUOTE_FAILED`;
  - `LICENSE_UNAVAILABLE`;
  - `CHALLENGE_EXPIRED`;
  - `PAYMENT_PROOF_INVALID`;
  - `FACILITATOR_FAILED`;
  - `SETTLEMENT_FAILED`;
  - `X402_DISABLED`;
  - `RESOURCE_NOT_FOUND`.
- Expand examples beyond catalog search to cover quote, unpaid paid-route
  challenge, proof insertion, receipt parsing, and safe retry behavior.
- Define a public validation window checklist for registry/scanner submission
  with seeded purchasable content, x402 enabled, rate limits, observability, and
  recorded scanner receipts.
- Add future MCP tools such as generation, remix, campaign, or community tools
  only after quote, consent, policy, payment, and receipt semantics are clear.
- Add playback tools only as owner-authorized intents:
  - `playback.capabilities`;
  - `playback.resolve`;
  - `playback.queue`;
  - `playback.play`;
  - `playback.control`;
  - `playback.status`.

Backend:

- version MCP tool schemas and receipt schemas;
- keep paid operations idempotent by proof or transaction hash;
- return stable error codes and recovery hints;
- define playback capability scopes, active-device requirements, confirmation
  states, and agent-originated analytics markers;
- keep public routes accountless where designed, but bounded by rate limits and
  abuse monitoring;
- avoid exposing private taste, wallet, proof, ownership, or unpublished
  staging data through public discovery.

Frontend:

- no primary frontend dependency for this phase;
- optionally show "agent-buyable" and receipt/proof meaning in marketplace or
  stem detail surfaces so humans understand what external agents can do.
- add an active-client bridge for owner-authorized playback requests before any
  external agent can start sound.

Verification:

- MCP smoke tests for initialize, tools/list, catalog search, quote, missing
  payment proof, and receipt shape;
- x402 HTTP tests for info, unpaid challenge, invalid proof, successful proof,
  idempotent retry, and settlement failure;
- OpenAPI/well-known snapshot tests for discoverability;
- example-client checks for Codex-compatible MCP configuration and TypeScript
  smoke flows;
- playback intent tests for no-active-device, confirmation-required,
  blocked-by-policy, queued, and playing outcomes;
- registry validation runbook execution during an approved public window.

## P2: Player Action Layer

Purpose:

- make the player the central place where listening becomes action.

Core user stories:

- As a listener, I can see why a track was recommended.
- As a listener, I can see whether the track has stems, licenses, collectibles,
  campaigns, artist rooms, or holder benefits.
- As a listener, I can take one meaningful action from the player without
  hunting across the app.

Suggested scope:

- Add a track context panel to the player or Now Playing route.
- Show recommendation reasons from existing agent/taste signals.
- Show available actions:
  - save;
  - add to playlist;
  - inspect stems;
  - buy/license;
  - remix when eligible;
  - join artist room when available;
  - view or support active Shows campaign;
  - collect moment/drop when available.
- Add action availability reasons when disabled.
- Emit analytics for action impressions and conversions.

Backend:

- extend catalog/recommendation response shape with action availability;
- expose compact rights and community eligibility summaries;
- avoid leaking private ownership or wallet data.

Frontend:

- player context panel;
- compact action rail;
- mobile-safe action sheet;
- empty states for tracks without actions.

Verification:

- frontend tests for action availability and disabled states;
- backend tests for redacted eligibility summaries;
- analytics event tests for player action impressions and clicks.

## P3: Durable Listener Taste Memory

Purpose:

- turn taste intelligence into a user-visible control surface.

Core user stories:

- As a listener, I can see what the app believes about my taste.
- As a listener, I can correct, hide, or reset taste signals.
- As a listener, I can opt into or out of taste-based social matching.
- As a listener, I can understand recommendation reasons without exposing raw
  private history.

Suggested scope:

- Add a taste profile page or settings section.
- Show favored moods, genres, artists, scenes, and recent intent categories.
- Add controls for:
  - reset taste memory;
  - hide a signal;
  - disable social taste matching;
  - enable city scenes;
  - manage recommendation explanation preferences.
- Feed these controls into Agent Taste Intelligence and future community
  cohorts.

Existing anchors:

- `docs/features/agent_taste_intelligence.md`
- `docs/features/analytics_consent_retention_policy.md`
- `docs/features/mood_vibe_discovery.md`

Verification:

- consent and settings tests;
- recommendation fallback tests after reset;
- explanation sanitization tests;
- analytics consent boundary tests.

## P4: Community Identity And Holder Utility

Purpose:

- ship the first Listener Community Network foundation without launching broad
  social interaction too early.

Milestones:

- #997: Community profile and visibility.
- #998: Badges, roles, and holder benefits.

Implementation order:

1. `CommunityProfile`.
2. `CommunityVisibilitySettings`.
3. Public profile/showcase read with redaction.
4. Marketplace ownership summary for profile display.
5. Badge grant/read service.
6. `CommunityEligibilityService`.
7. Benefit rule and redemption service.

Critical product rules:

- wallet address display defaults to hidden;
- ownership display is opt-in;
- private ownership can still unlock eligibility;
- eligibility checks never trust client-submitted ownership claims;
- new grants fail closed during indexer or contract proof outages.

Verification:

- profile redaction tests;
- hidden ownership but active eligibility tests;
- benefit redemption idempotency tests;
- contract/indexer outage behavior tests;
- frontend profile settings and showcase tests.

## P5: Artist Rooms And Campaign Rooms

Purpose:

- create artist-listener interaction surfaces tied to real music and campaign
  objects.

Milestones:

- #999: Artist community tab.
- #1000: Shows and campaign rooms.

Implementation order:

1. `CommunityRoom`.
2. `CommunityMembership`.
3. `CommunityMessage`.
4. `CommunityModerationReport`.
5. Artist public room.
6. Artist holder-only room.
7. Campaign supporter room.
8. City demand group.
9. Announcement and campaign update message types.
10. Moderation and audit actions.

Minimum moderation before launch:

- report message;
- delete message;
- leave room;
- ban from room;
- pause room;
- artist/team moderation role;
- platform admin override;
- destructive-action audit log.

Verification:

- room access policy tests;
- holder-only room tests;
- pledge-to-room access tests;
- campaign room join tests;
- moderation action tests;
- Shows detail frontend tests;
- analytics conversion event tests.

## P6: Rights-Aware Creative Bridge

Purpose:

- connect listening, ownership, remixing, and licensing into one creative path.

Core flow:

```text
track/player -> inspect stems -> check remix eligibility -> buy or prove remix
license -> create private remix project -> save provenance -> publish/export if allowed
```

Existing anchors:

- `docs/features/remix_studio.md`
- `docs/features/remix_studio_backlog.md`
- `docs/rfc/remix-studio.md`
- `docs/rfc/ai-derivative-rights-policy.md`
- `docs/rfc/licensing-roadmap.md`

Suggested scope:

- remix eligibility API;
- durable `RemixProject` model;
- player/release/stem remix CTA;
- AI-assisted remix draft provider boundary;
- provenance and source lineage;
- remix lifecycle analytics events;
- publish/export policy gates.

Verification:

- eligibility policy tests;
- project creation integration tests;
- disabled CTA tests for blocked/quarantined/unlicensed sources;
- provider failure tests;
- analytics lifecycle tests.

## P7: Artist Action Cockpit

Purpose:

- turn analytics into recommended artist actions.

Core user stories:

- As an artist, I can see what action would most help this release now.
- As an artist, I can understand which city, campaign, holder group, or track
  segment deserves attention.
- As an artist, I can create community, campaign, drop, pricing, or rights
  actions from one surface.

Suggested action cards:

- create holder benefit;
- invite collectors to artist room;
- open Shows campaign for city with demand;
- post campaign update;
- adjust stem pricing;
- launch remix challenge;
- create punchline/moment drop;
- request rights upgrade;
- answer top fan questions;
- reward early supporters.
- review agent-prepared drafts before publishing or sending.

Backend:

- artist action recommendation service;
- aggregate-only fan/community inputs;
- minimum thresholds for city/taste/supporter insights;
- no raw listener identity leakage.

Frontend:

- action cockpit inside artist analytics;
- one-click deep links into Shows, community, pricing, upload, and rights flows.

Verification:

- aggregate threshold tests;
- privacy redaction tests;
- action card rendering tests;
- workflow deep-link tests.

## P8: Taste Cohorts And Discord Bridge

Purpose:

- expand community after identity, benefits, moderation, and artist rooms are in
  place.

Milestones:

- #1001: Taste cohorts.
- #1002: Discord bridge.

Taste cohort scope:

- opt-in matching;
- minimum cohort size;
- safe explanations;
- join, leave, hide, disable flows;
- expiry and archival.

Discord bridge scope:

- official Discord link;
- announcement mirroring;
- role mapping from Resonate eligibility;
- sync failure and retry visibility;
- audit logs.

Verification:

- consent-gated suggestion tests;
- minimum-size tests;
- explanation sanitization tests;
- webhook validation tests;
- role sync privacy tests;
- frontend connected/failed/disconnected states.

## Cross-Workstream Requirements

### Data And Privacy

- Public profile display is opt-in.
- Wallet display defaults false.
- Listening and taste matching are opt-in for social use.
- City scenes use coarse or declared geography only.
- Ownership display is separate from eligibility.
- Artist analytics use aggregate thresholds.

### Analytics

Each phase should emit events into the existing analytics event ledger.

Priority events:

- `community.profile_visibility_updated`
- `community.ownership_display_updated`
- `community.role_granted`
- `community.benefit_unlocked`
- `community.benefit_redeemed`
- `community.room_joined`
- `community.room_access_denied`
- `community.campaign_room_joined`
- `community.show_city_interest_joined`
- `community.cohort_suggested`
- `community.cohort_joined`
- `agent_interface.capability_discovered`
- `agent_interface.catalog_searched`
- `agent_interface.quote_requested`
- `agent_interface.payment_required`
- `agent_interface.payment_verified`
- `agent_interface.receipt_issued`
- `agent_interface.error_returned`
- `agent_interface.registry_validated`
- `playback.agent_intent_received`
- `playback.agent_intent_blocked`
- `playback.agent_queue_updated`
- `playback.agent_play_started`
- `player.action_impression`
- `player.action_selected`
- `artist.action_recommended`
- `artist.action_started`

### Security And Abuse

- Rate-limit messages, joins, reports, and benefit redemptions.
- Keep destructive moderation audit logs.
- Fail closed for new gated grants when proof is unavailable.
- Allow off-chain bans even when access assets remain owned.
- Do not expose hidden wallet, hidden ownership, private taste, or private city
  context in profile, room, or cohort copy.

### Documentation

Every implementation PR should update:

- feature catalog;
- relevant feature page;
- environment docs if new env vars are added;
- analytics event taxonomy if new events are emitted;
- security/privacy notes for user-to-user interactions.

## First 10 Implementation Issues To Open Or Confirm

1. Player context and action availability API.
2. Player action rail UI.
3. External agent contract audit for MCP, x402, OpenAPI, storefront, receipts,
   and errors.
4. Agent-mediated playback policy and intent contract.
5. External agent example flows for quote, payment-required, proof retry, and
   receipt parsing.
6. Listener taste memory settings and reset controls.
7. Community profile and visibility models (#997).
8. Profile showcase API and redaction (#997).
9. Community eligibility service (#998).
10. Badge and holder benefit models (#998).

## Recommended First Sprint

The first sprint should avoid chat and network effects. It should prove the
foundation:

1. Create `CommunityProfile` and `CommunityVisibilitySettings`.
2. Add profile settings UI.
3. Add public profile showcase with redaction.
4. Add marketplace ownership summary behind display controls.
5. Add analytics events for profile and ownership visibility changes.
6. Add tests proving wallet address and ownership stay hidden by default.

This gives Resonate a social identity layer without taking on moderation risk
too early.
