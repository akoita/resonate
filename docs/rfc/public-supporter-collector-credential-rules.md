---
title: "Public Supporter And Collector Credential Rules"
status: draft
owner: "@akoita"
related:
  - community-membership-boundaries.md
  - ../features/listener_community_network.md
  - ../features/community_holder_benefits_plan.md
  - https://github.com/akoita/resonate/issues/1097
  - https://github.com/akoita/resonate/issues/1106
  - https://github.com/akoita/resonate/issues/1107
  - https://github.com/akoita/resonate/issues/1108
---

# Public Supporter And Collector Credential Rules

## Purpose

This RFC defines product and security rules for public artist supporter and
collector credentials before any NFT-backed credential implementation starts.
It follows the boundary set in
[Blockchain-Native Community Membership Boundaries](community-membership-boundaries.md):
use blockchain for public, durable, portable proofs, and keep private,
mutable, safety-sensitive, consent-dependent community state off-chain.

## Recommendation

Do not build a new NFT-backed supporter or collector credential yet.

The recommended first path is:

1. use existing NFT ownership and indexed purchase/support proof as eligibility
   inputs;
2. issue off-chain, revocable supporter and collector badges first;
3. require explicit listener opt-in before any badge appears on public profiles
   or external integrations;
4. pilot one external verifier path, starting with Discord role sync or artist
   site verification, using existing proof plus an off-chain visibility grant;
5. revisit a new NFT-backed public credential only after the badge and verifier
   product proves user demand, partner demand, abuse handling, recovery UX, and
   metadata rules.

This avoids creating permanent public protocol state before Resonate knows
which credential is valuable enough to be portable. It also prevents a public
token from accidentally revealing private listening, spending, ownership,
support, refund, or moderation state.

## Decision Summary

| Question | Rule |
| --- | --- |
| First credential path | Off-chain public badge first, backed by existing ownership/support proof. |
| New NFT-backed credential | Deferred until a partner-facing use case proves demand. |
| First external use case | Discord role sync or artist site verification, not broad public indexing. |
| Transferability | Existing ownership NFTs keep their native transfer rules; off-chain badges are non-transferable. |
| Revocation | Off-chain badges and external visibility grants must be revocable by lifecycle, moderation, user opt-out, and policy. |
| Expiry | Supporter credentials should support campaign/season/benefit expiry; collector badges can be current-state or snapshot based on the badge type. |
| Public display | Requires explicit opt-in separate from owning an NFT, buying a stem, backing a campaign, or joining a room. |
| Public metadata | Only artist/collection, credential type, public label, coarse tier, issue/update time, expiry when relevant, and verification method. |
| Private data | Never publish wallet address, exact spend, full holdings, private room membership, listening history, city/cohort membership, report/moderation state, refund state, or raw eligibility policy. |
| Account recovery | Off-chain badge display follows the Resonate account; external proof can be re-bound after wallet recovery. New non-transferable NFTs are blocked until recovery semantics are designed. |

## User Stories Worth Solving First

### Artist Supporter Recognition

An artist wants to recognize opted-in supporters in public and partner spaces
without exposing how much they paid, exactly what they own, or whether they
joined a private room.

First implementation should support:

- public profile badge: "Supporter of Artist";
- optional Discord role sync for the artist's server;
- artist-site verification that confirms the listener has an active public
  supporter badge;
- revocation when the listener opts out, the campaign/support proof is no
  longer valid, or moderation removes the listener from artist community access.

This does not require a new NFT. Existing indexed support, purchase, or manual
artist/operator grants can back the badge.

### Collector Recognition

A collector wants to show public collecting identity for an artist, release, or
collection without exposing their full wallet, purchase history, or private
holder-room status.

First implementation should support:

- public profile badge: "Collector of Artist" or "Stem Collector";
- optional tier copy such as "collector", "early collector", or "complete set"
  only when the tier can be derived without exposing exact holdings;
- external verification for artist perks or Discord roles.

Existing stem NFTs and indexed purchases are enough for the first proof. A new
public collector NFT is not justified until external portability is the product
value, not just profile display.

## Credential Models

### Phase 1: Off-Chain Public Badge

Use this model first.

- Stored by Resonate as product state.
- Backed by existing indexed ownership, support, campaign, badge, role, or
  manual grant facts.
- Non-transferable.
- Revocable immediately.
- Hidden by default.
- Public only after explicit opt-in.
- Can feed partner integrations through a backend verifier.
- Can be removed from profile and integrations without changing chain state.

This is the safest way to learn which badges users and artists actually value.

### Phase 2: Existing NFT Ownership Proof

Use this when an external surface needs direct wallet verification and the
existing NFT is already the product object.

Examples:

- stem ownership unlocks holder benefits;
- collection ownership unlocks Discord role sync;
- artist site asks Resonate or the user's wallet to prove ownership.

Rules:

- do not publish all owned token IDs by default;
- do not require public profile display;
- do not treat transfer as room membership or moderation truth;
- off-chain bans, removals, refunds, and policy state override local access
  even if the wallet still owns a token.

### Phase 3: New NFT-Backed Public Credential

Defer until there is a concrete use case where a new portable credential is
better than existing ownership proof plus an off-chain badge.

Acceptable future candidates:

- opt-in show attendance proof;
- public artist supporter season pass;
- artist-recognized contributor credential;
- partner perk credential that needs open verification outside Resonate.

Do not mint a new NFT-backed credential for:

- private supporter rooms;
- taste cohorts;
- city-scene cohorts;
- private collector cohorts;
- moderation, report, ban, or appeal state;
- profile visibility settings;
- exact spend, pledge, refund, or full ownership history.

## Transferability Rules

| Surface | Transfer Rule | Reason |
| --- | --- | --- |
| Existing stem or collectible NFT | Keep native token transferability | It already represents a market asset. |
| Off-chain public supporter badge | Non-transferable | It is a Resonate recognition state, not an asset. |
| Off-chain collector badge | Non-transferable | It summarizes eligibility and display consent. |
| Discord/partner role | Non-transferable and refreshed | Role follows current verified eligibility and opt-in. |
| New supporter NFT, if later approved | Prefer non-transferable or expiring unless the product is explicitly collectible | Avoid turning social trust into speculative resale. |
| New attendance/contributor NFT, if later approved | Prefer non-transferable, revocable, or replacement-capable | Recovery and mistakes matter more than resale. |

Transfer of an underlying NFT must never automatically transfer off-chain
message history, room membership, moderation state, profile display, or
external roles.

## Revocation And Expiry Rules

Every credential path must define revocation before launch.

Revocation triggers:

- user disables public badge display;
- user disconnects external integration;
- artist/operator removes a manual grant;
- campaign support becomes refunded, failed, cancelled, or invalidated;
- benefit season, campaign, show, or time-box expires;
- indexed ownership no longer satisfies the rule;
- moderation ban/removal blocks community access;
- policy, fraud, chargeback, or trust review invalidates the proof.

Expiry rules:

- campaign supporter badges should be tied to campaign lifecycle and can become
  historical only after the lifecycle is safe to display;
- active holder/collector badges should refresh from current ownership or a
  deliberate snapshot policy;
- show attendance or contribution proofs can be permanent only when the user
  opted into a public memory/attribution surface;
- external roles should expire or refresh periodically instead of becoming
  one-way grants.

## Public Metadata Schema

Phase 1 should expose a backend/public verifier schema, not on-chain metadata.

Draft schema:

```json
{
  "schemaVersion": "public-community-credential/v1",
  "credentialId": "cred_...",
  "credentialType": "artist_supporter | artist_collector | collection_collector | show_attendee | contributor",
  "displayLabel": "Artist supporter",
  "subjectProfileId": "public-profile-id-or-null",
  "artistId": "artist-id-or-null",
  "artistDisplayName": "Artist Name",
  "collectionId": "collection-or-release-id-or-null",
  "collectionLabel": "Collection label or null",
  "tier": "supporter | early_supporter | collector | early_collector | complete_set | attendee | contributor",
  "status": "active | expired | revoked",
  "visibility": "public_profile | partner_verifier",
  "issuedAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "proofMethod": "indexed_ownership | campaign_support | manual_grant | badge_grant | role_grant",
  "verificationUrl": "https://resonate.example/community/credentials/cred_..."
}
```

Allowed public fields:

- credential id that is not a wallet address;
- credential type;
- display label;
- artist or collection reference;
- coarse tier;
- active/expired/revoked status;
- issue/update/expiry timestamps;
- proof method category;
- public profile id only when the listener profile is public.

Forbidden public fields:

- wallet address unless the user explicitly performs wallet-level verification
  for that partner session;
- email, internal user id, auth id, or private profile id;
- exact spend, pledge amount, resale price, or royalty history;
- full token holdings or all token IDs;
- private room membership;
- taste cohort, city cohort, or cohort room membership;
- listening history, saves, skips, library facts, or private recommendations;
- refund, chargeback, dispute, moderation, report, ban, appeal, or operator
  note details;
- raw eligibility policy JSON.

If a future on-chain metadata schema is proposed, it must be a separate RFC or
implementation plan and must preserve the same allowed/forbidden split.

## Opt-In And Visibility Rules

Credential ownership and credential display are separate states.

Required controls:

- owning a stem, backing a campaign, or receiving a badge does not make the
  credential public;
- public profile display requires explicit opt-in per badge or badge class;
- external partner verification requires explicit connection or one-time
  authorization;
- disabling public display removes the badge from public profile responses;
- disconnecting a partner stops future role sync;
- private and follower/community-only profile modes do not create public
  credential pages;
- hiding owned items must hide collector credentials that imply ownership.

Recommended default copy:

- "Show this supporter badge on my public profile";
- "Let this artist's Discord verify this badge";
- "This does not reveal your wallet address, exact spend, or full collection."

Avoid copy that says or implies investment, yield, financial status, or
leaderboard ranking.

## Privacy And Moderation Rules

Public credentials must not weaken community safety.

Rules:

- moderation bans/removals override role sync and Resonate room access;
- public credential pages must not expose reports, bans, removals, or appeals;
- partner role sync should fail closed when eligibility cannot be verified;
- revoked or expired badges should show only minimal public status when the user
  previously made the badge public;
- profile deletion or privacy downgrade must remove public credential display;
- artists and operators need a way to remove manual/public grants without
  touching underlying NFT ownership;
- abuse handling must treat credentials as recognition and access hints, not as
  an entitlement to message, bypass bans, or avoid moderation.

## Account Recovery Rules

Resonate supports embedded and ERC-4337 wallet paths, so credential design must
not assume one permanent externally owned account.

Phase 1 off-chain badges:

- follow the Resonate account;
- can re-evaluate eligibility after wallet recovery or wallet replacement;
- can preserve public profile display if the recovered account still satisfies
  the proof rule;
- should not publish old wallet addresses as credential identity.

Existing NFT proof:

- follows the wallet that owns the NFT;
- can be re-associated with the Resonate account after wallet recovery if the
  user proves control;
- external partners should verify current proof rather than cache a permanent
  role forever.

Future non-transferable NFT credential:

- blocked until a recovery plan exists;
- needs replacement, burn/reissue, delegation, or account-abstraction recovery
  semantics;
- must define who can revoke or reissue and what audit trail exists.

## External Use Case Priority

Recommended order:

1. **Discord role sync** for artist servers because it matches existing artist
   behavior and can be revoked off-chain.
2. **Artist site verification** because it gives artists portable fan
   recognition without requiring public token indexing.
3. **Venue or partner perks** only after expiry, revocation, and fraud handling
   are proven.
4. **Agent tooling** after stable verifier schemas exist.
5. **New NFT-backed credential** only after one of the above proves that open,
   wallet-native portability is the product value.

Discord and artist-site pilots should use backend verifier responses first.
They should not require minting a new NFT.

## Implementation Follow-Ups

This RFC recommends documentation and product rules only. It does not implement
schemas, APIs, Discord sync, or contracts.

Recommended follow-up issues:

1. [#1106](https://github.com/akoita/resonate/issues/1106): off-chain public
   supporter and collector badge visibility controls;
2. [#1107](https://github.com/akoita/resonate/issues/1107): privacy-safe public
   credential verifier API;
3. [#1108](https://github.com/akoita/resonate/issues/1108): Discord or
   artist-site verification pilot using existing ownership/support proof;
4. account-recovery rules for future non-transferable community credentials;
5. future NFT-backed credential contract RFC only after the pilot proves need.

## Non-Goals

- No Solidity implementation.
- No Prisma schema migration.
- No backend endpoint implementation.
- No frontend badge UI implementation.
- No Discord integration implementation.
- No new deploy variables or contract addresses.
