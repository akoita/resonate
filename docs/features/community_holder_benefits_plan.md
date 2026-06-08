---
title: "Community Badges, Roles, And Holder Benefits Plan"
status: in-progress
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/998"
follow_up_issue: "https://github.com/akoita/resonate/issues/1126"
---

# Community Badges, Roles, And Holder Benefits Plan

## Purpose

This plan implements the second Listener Community Network milestone: private
eligibility and holder utility. It builds on the profile visibility foundation
without making wallet address, ownership, pledge, or attendance proofs public by
default.

Public supporter and collector credential rules are defined separately in
[Public Supporter And Collector Credential Rules](../rfc/public-supporter-collector-credential-rules.md).
That RFC recommends off-chain opt-in public badges backed by existing
ownership/support proofs before any new NFT-backed community credential.

## Slice 1: Backend Eligibility Foundation

Status: `implemented`

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

Status: `implemented`

Deliverables:

- Artist/admin APIs to create, pause, and expire benefit rules.
- Validation for eligibility and redemption policy JSON.
- Governance events for benefit rule lifecycle changes.
- Frontend management surface under artist/community or campaign settings.

Implemented in [#1126](https://github.com/akoita/resonate/issues/1126):

- `GET /community/artists/:artistId/benefit-rules`
- `POST /community/artists/:artistId/benefit-rules`
- `POST /community/artists/:artistId/benefit-rules/:ruleId/pause`
- `POST /community/artists/:artistId/benefit-rules/:ruleId/expire`

Artists/operators can manage rules from the artist Community tab. The first
supported management templates are artist stem holders, Shows campaign
supporters, artist-scoped collector badges, and artist-scoped holder roles.
Responses expose rule status, benefit type, dates, redemption settlement mode,
and a safe eligibility summary; raw proof details, wallet addresses, and
listener eligibility internals remain server-side.

## Slice 3: Listener Benefit Surface

Status: `partial`

Deliverables:

- Listener-facing "Benefits unlocked" surface.
- Profile showcase badges that respect `showTasteBadges` and `showOwnedItems`.
- Public profile redaction for private badges and private ownership proofs.
- Empty and locked states that explain value without exposing sensitive facts.

Implemented in [#1128](https://github.com/akoita/resonate/issues/1128):

- `/community` now includes a listener "Unlocked benefits" panel backed by
  `GET /community/benefits/me`.
- Claimable, claimed, locked, unavailable, loading, empty, and error states are
  represented with privacy-safe copy.
- Eligible listeners can redeem claimable benefits through
  `POST /community/benefits/:benefitRuleId/redeem`.
- The UI shows profile-level wallet/ownership display settings, but does not
  expose raw proof reasons, wallet addresses, or ownership details.

Remaining:

- Public profile benefit showcase badges remain deferred until the publication
  rules for public badges and ownership display are implemented.
- New NFT-backed credentials and on-chain settlement remain out of scope for M2.

## Verification

Slice 1 should use focused backend integration coverage:

- ownership-based eligibility works from indexed `StemPurchase` rows;
- private ownership unlocks benefits while public profile ownership display can
  remain disabled;
- wallet address remains hidden unless explicitly enabled;
- client-provided ownership facts are ignored;
- redemption is idempotent for single-use policy;
- campaign support and badge/role grants can unlock benefits.

Slice 2 adds focused coverage for:

- artist-owner authorization for rule list/create/pause/expire;
- rule validation for ownership, badge, role, and campaign-support policies;
- campaign-support rules scoped to the managed artist;
- lifecycle events bridged into analytics with compact payloads only;
- management DTOs that omit wallet addresses and raw proof data.

Slice 3 adds focused frontend coverage for:

- listener benefit grouping and status copy;
- no raw proof reason leakage in rendered cards;
- empty, claimable, redeemed, locked, and unavailable states;
- redemption UI state updates through the typed API wrapper.
