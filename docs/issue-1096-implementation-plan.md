# Issue #1096 Implementation Plan: NFT-Verifiable Artist Holder Room Access

## Issue

- GitHub: https://github.com/akoita/resonate/issues/1096
- Branch: `feat/1096-nft-holder-room-access`
- Parent boundary: `docs/rfc/community-membership-boundaries.md`

## Goal

Use existing stem/NFT ownership proof as a private eligibility input for artist
holder rooms while keeping room membership, moderation state, messages, bans,
profile visibility, and cohort state off-chain.

This issue should not mint a new membership NFT or move any community state
on-chain.

## Current Code Findings

- Artist community rooms already provision a public room and an `artist_holder`
  room in `backend/src/modules/community/community_rooms.service.ts`.
- Holder rooms already use an `any_of` access policy with:
  - `{ type: "ownership", assetType: "stem_nft", artistId }`
  - `{ type: "role", roleType: "holder", scopeType: "artist", scopeId: artistId }`
- `CommunityEligibilityService.evaluateOwnershipPolicy()` already checks the
  authenticated listener wallet against indexed `StemPurchase` records joined
  through `StemListing -> Stem -> Track -> Release`.
- `CommunityRoomsService.assertRoomJoinable()` already blocks banned users
  before evaluating holder eligibility.
- Existing integration tests seed a holder wallet, stem listing, and stem
  purchase in `backend/src/tests/community_rooms.integration.spec.ts`.
- Frontend holder-room copy already explains private holder checks in
  `web/src/components/community/ArtistCommunityTab.tsx` and
  `web/src/components/community/roomAccess.tsx`.

## Proposed Implementation

1. Tighten the ownership policy contract.
   - Require or validate `assetType: "stem_nft"` for the current ownership path.
   - Return a specific reason such as `stem_nft_holder` instead of the generic
     `private_ownership`.
   - Preserve `wallet_missing` and `ownership_missing` as non-sensitive failure
     reasons.

2. Make artist holder rooms reconcile eligibility.
   - Extend `shouldReconcileMembershipAccess()` so `artist_holder` rooms with an
     access policy are rechecked on room reads and message access.
   - If a previously joined holder no longer satisfies ownership/role policy,
     mark the off-chain membership `removed` with `endedAt`.
   - Keep `banned` as an override that cannot be rejoined while ownership still
     exists.

3. Preserve privacy in API responses.
   - Do not expose wallet addresses, token IDs, purchase IDs, listing IDs, or
     exact ownership details in artist room DTOs.
   - Keep access responses to joinability plus bounded reason codes.

4. Improve UI copy only where needed.
   - Keep the locked copy privacy-forward.
   - For eligible listeners, make the action copy clear that existing ownership
     was checked privately.

5. Update docs.
   - Update `docs/features/listener_community_network.md` to mark holder-room
     NFT-verifiable access as implemented for the first ownership-proof slice.
   - Link back to the #1084 blockchain membership boundary RFC.

## Test Plan

- Backend integration tests in `backend/src/tests/community_rooms.integration.spec.ts`:
  - eligible stem/NFT holder can join `artist_holder`;
  - non-holder cannot join;
  - banned holder cannot rejoin even with valid ownership;
  - active holder membership is removed when the underlying ownership proof no
    longer matches;
  - artist holder room access responses do not expose wallet or token details.
- Frontend tests:
  - holder room locked copy remains privacy-safe;
  - eligible holder join copy remains clear and does not imply public
    membership.

## Non-Goals

- No Solidity changes.
- No new membership NFT.
- No Prisma migration unless implementation discovers an unavoidable schema gap.
- No private taste, city, or cohort membership on-chain.
- No public enumeration of holder-room members.
- No wallet, token, or purchase detail exposure in community room responses.

## Open Implementation Question

`evaluateOwnershipPolicy()` currently computes current holder eligibility from
indexed marketplace purchases minus indexed marketplace sales for each stem NFT
token. This covers Resonate-indexed marketplace resale without exposing wallet,
token, listing, or purchase details in community responses. A later issue can
add a fresh on-chain `balanceOf` read or ownership snapshot table if off-platform
ERC-1155 transfers need to affect holder-room eligibility immediately.
