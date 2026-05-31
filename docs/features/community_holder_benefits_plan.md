---
title: "Community Badges, Roles, And Holder Benefits Plan"
status: in-progress
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/998"
---

# Community Badges, Roles, And Holder Benefits Plan

## Purpose

This plan implements the second Listener Community Network milestone: private
eligibility and holder utility. It builds on the profile visibility foundation
without making wallet address, ownership, pledge, or attendance proofs public by
default.

## Slice 1: Backend Eligibility Foundation

Status: `in-progress`

Deliverables:

- Add persistence for community badges, roles, benefit rules, and redemptions.
- Add a `CommunityEligibilityService` that evaluates benefit policies from
  trusted backend state, not client-submitted ownership claims.
- Support active benefit rules for:
  - room access
  - discounts
  - early access
  - fee discounts
  - drop priority
  - ticket priority
  - remix eligibility
- Support eligibility policy primitives for:
  - manual grants
  - badge grants
  - role grants
  - stem ownership from indexed purchases
  - Shows campaign support from confirmed/submitted pledge state
  - compound `any_of` and `all_of` policies
- Add idempotent redemption records for single-use benefits.
- Return eligibility responses that expose whether the listener is eligible and
  redeemable without exposing private wallet or ownership details.

## Slice 2: Artist And Operator Rule Management

Status: `planned`

Deliverables:

- Artist/admin APIs to create, pause, and expire benefit rules.
- Validation for eligibility and redemption policy JSON.
- Governance events for benefit rule lifecycle changes.
- Frontend management surface under artist/community or campaign settings.

## Slice 3: Listener Benefit Surface

Status: `planned`

Deliverables:

- Listener-facing "Benefits unlocked" surface.
- Profile showcase badges that respect `showTasteBadges` and `showOwnedItems`.
- Public profile redaction for private badges and private ownership proofs.
- Empty and locked states that explain value without exposing sensitive facts.

## Verification

Slice 1 should use focused backend integration coverage:

- ownership-based eligibility works from indexed `StemPurchase` rows;
- private ownership unlocks benefits while public profile ownership display can
  remain disabled;
- wallet address remains hidden unless explicitly enabled;
- client-provided ownership facts are ignored;
- redemption is idempotent for single-use policy;
- campaign support and badge/role grants can unlock benefits.

