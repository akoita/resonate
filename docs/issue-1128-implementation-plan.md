---
issue: "https://github.com/akoita/resonate/issues/1128"
title: "M2: Listener unlocked benefits surface"
status: in-progress
---

# Issue 1128 Implementation Plan

## Scope

Implement the listener-facing holder benefit surface for M2 slice 3. The first
shipping surface lives on `/community`, where authenticated listeners already
manage cohorts and rooms.

## Implementation

- Add typed web client wrappers for:
  - `GET /community/benefits/me`
  - `POST /community/benefits/:benefitRuleId/redeem`
- Add a `CommunityBenefitsPanel` to `/community`.
- Group benefits by listener actionability:
  - ready to claim
  - claimed
  - not currently claimable
- Keep raw proof reasons, wallet addresses, and ownership details out of the UI.
- Show profile-level privacy indicators for wallet and ownership display.
- Support empty, loading, error, redeemed, idempotent, and locked states.

## Out Of Scope

- Public profile benefit showcase badges.
- New NFT credentials.
- On-chain benefit settlement.
- Artist/operator rule creation changes.

## Verification

- Focused Vitest coverage for grouping, safe copy, empty state, and rendered
  claimable/redeemed/locked states.
- Web lint on the changed UI and API files.
- Documentation updates in the feature catalog and holder benefits plan.
