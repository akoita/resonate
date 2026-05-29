---
title: "Marketplace Listing Lifecycle"
status: in-progress
owner: "@akoita"
---

# Marketplace Listing Lifecycle

Resonate marketplace listings are finite on-chain offers. This feature makes
listing expiry understandable and recoverable for creators while keeping public
buyer and machine-commerce surfaces strict about availability.

## Who It Is For

- Artists and stem owners who list ERC-1155 stem editions for sale.
- Listeners and collectors browsing active marketplace inventory.
- Backend, frontend, x402, MCP, and agent developers who need a single listing
  availability contract.

## Current Capability

- Public marketplace reads only return listings that are active, have remaining
  amount, and have `expiresAt` in the future.
- Owner listing management is available at `/marketplace/manage`.
- Owner inventory can show `active`, `expiring_soon`, `expired`, `sold`,
  `cancelled`, and `stale` lifecycle states.
- Backend reconciliation marks active rows as `expired` after `expiresAt <= now`.
- Sellers can receive idempotent `listing_expiring_soon` and `listing_expired`
  notifications.
- Notification preferences include marketplace lifecycle controls.
- Expired and cancelled listings can be relisted from the owner view by creating
  a new on-chain listing transaction.

## How To Use

### Creator

1. Open `/marketplace/manage` with the listing seller wallet or smart account.
2. Filter by Active, Expiring, Expired, Sold, or Cancelled.
3. Use Relist on eligible expired or cancelled rows.
4. Confirm the new listing transaction; the indexer attaches the new listing row
   after the chain event is observed.

### Developer

- Public listings: `GET /api/metadata/listings`
- Owner listings: authenticated `GET /api/metadata/listings/owner/:seller`
  for the seller, a linked EOA/smart-account address, or admin.
- Notification preferences:
  - `GET /api/metadata/notifications/:address/preferences`
  - `PATCH /api/metadata/notifications/:address/preferences`
- Relisting uses the existing `StemMarketplaceV2.list` transaction path through
  `useListStem`; it does not mutate the expired listing.

## Lifecycle Semantics

| State | Meaning |
| --- | --- |
| `active` | Listing is active, has remaining amount, and is not close to expiry. |
| `expiring_soon` | Listing is still purchasable but expires within the owner-facing warning window. |
| `expired` | Listing expiry has passed and the row is not publicly purchasable. |
| `sold` | Listing has no remaining amount or was marked sold by contract events. |
| `cancelled` | Seller cancelled the listing on-chain. |
| `stale` | Reserved for chain/database mismatch repair states. |

## Surfaces

| Surface | Current behavior |
| --- | --- |
| Public marketplace | Excludes expired and sold-out listings. |
| Storefront/x402/MCP/agent commerce | Continue to treat expired listings as unavailable. |
| Owner listing manager | Shows actionable expired inventory and relist controls. |
| Notification bell | Routes listing lifecycle notifications to `/marketplace/manage`. |

## Tests

```bash
cd backend && npm run test -- listing_lifecycle.spec.ts notification.service.spec.ts
```

Frontend validation is currently covered by TypeScript/lint and manual UI review
for `/marketplace/manage`; dedicated component tests should follow once the
listing manager stabilizes.

## References

- Roadmap: [#1004](https://github.com/akoita/resonate/issues/1004)
- Implementation issue: [#1015](https://github.com/akoita/resonate/issues/1015)
- Smart contract integration: [Marketplace Integration](../smart-contracts/marketplace_integration.md)
- Code:
  - `backend/src/modules/contracts/listing-lifecycle.ts`
  - `backend/src/modules/contracts/contracts.service.ts`
  - `backend/src/modules/contracts/metadata.controller.ts`
  - `web/src/app/marketplace/manage/page.tsx`
