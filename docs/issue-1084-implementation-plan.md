# Issue #1084 Implementation Plan

## Issue

- GitHub: https://github.com/akoita/resonate/issues/1084
- Title: Explore blockchain-native community membership boundaries
- Branch: `feat/1084-blockchain-community-membership-boundaries`

## Goal

Document when community membership or credentials should become NFT-backed and
when they must remain off-chain. This is a documentation/RFC slice only; it
does not implement contracts, schema migrations, backend endpoints, or UI.

## Current Boundary

The Listener Community Network architecture already sets the high-level rule:

- blockchain proves ownership, authority, escrow, settlement, and portable
  credentials;
- community product state stays off-chain, privacy-aware, fast, deletable, and
  moderatable.

The current community implementation keeps profiles, visibility, rooms,
memberships, messages, cohort state, moderation, and benefit eligibility in the
backend. Existing protocol contracts cover stem NFTs, marketplace settlement,
content protection, revenue escrow, and Shows campaign escrow.

## Planned Docs

1. Add an RFC for blockchain-native community membership boundaries.
   - Define decision criteria for on-chain vs off-chain membership.
   - Explain why private taste/city cohorts stay off-chain.
   - Identify candidate NFT-backed public or portable membership surfaces.
   - Define privacy, consent, moderation, revocation, transferability, and
     indexer implications.
   - List implementation prerequisites for any future build.

2. Update Listener Community Network architecture docs.
   - Link the new RFC.
   - Make the off-chain/private cohort rule easy to find.
   - Clarify that NFT membership can be accepted as proof but should not own
     room moderation, private membership state, or chat state.

3. Update feature catalog/docs.
   - Reference #1084 as the current documentation boundary.
   - Keep feature status accurate: exploration/design, not implementation.

## Initial Decision Framework

Use NFT-backed membership only when most of these are true:

- the membership is intentionally public or selectively revealable;
- portability outside Resonate is valuable;
- durability across platforms matters;
- transferability is acceptable or explicitly constrained;
- ownership can be verified without exposing sensitive behavior;
- revocation semantics are clear;
- moderation can still happen off-chain.

Keep membership off-chain when any of these are true:

- membership depends on mutable consent;
- membership reveals taste, location, social graph, listening history, or
  sensitive support behavior;
- counts must be bucketed or minimum-size gated;
- the user needs hide, leave, or delete semantics;
- bans/removals must override access immediately;
- the community surface needs private chat/moderation state.

## Candidate Surfaces

Potential NFT-backed or NFT-verifiable:

- public artist supporter membership;
- public collector or stem-holder credentials;
- optional campaign supporter badges after campaign lifecycle is safe to reveal;
- show attendance proofs when attendee opts in;
- remix/contributor credentials;
- partner/venue/Discord role proofs.

Must remain off-chain by default:

- taste cohorts;
- city-scene cohorts tied to coarse location;
- cohort room membership;
- private supporter rooms;
- moderation actions, bans, reports, and message state;
- profile visibility preferences.

## Validation

Documentation-only validation:

- confirm all linked docs resolve;
- run `git diff --check`;
- no security scan required unless code/backend/contracts are changed.

## Non-Goals

- No Solidity contract work.
- No Prisma schema migration.
- No backend service or endpoint changes.
- No frontend UI changes.
- No deployment or environment variable changes.
