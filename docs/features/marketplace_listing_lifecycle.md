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

- Public marketplace list and detail reads only return listings that are
  active, have remaining amount, and have `expiresAt` in the future.
- Agent catalog search uses the same public-purchasable rule before setting
  `hasListing`, so AI DJ and model tool calls do not boost expired or sold-out
  inventory as buyable.
- Owner listing management is available at `/marketplace/manage`, from the
  marketplace hero, from the connected-wallet marketplace filter bar, and from
  lifecycle notification deep links.
- Owner inventory can show `active`, `expiring_soon`, `expired`, `sold`,
  `cancelled`, and `stale` lifecycle states.
- Backend reconciliation marks active rows as `expired` after `expiresAt <= now`.
- The buy modal recognizes the zeroed struct a consumed/cancelled listing
  reads back from the contract (#1172) and renders "this listing is no longer
  active" with no purchase path, instead of a phantom `TOKEN #0 / 0 ETH`
  listing. The legacy native-ETH re-list warning fires only for live listings
  whose payment token is genuinely the zero address.
- Sellers can receive idempotent `listing_expiring_soon` and `listing_expired`
  notifications.
- Notification preferences include marketplace lifecycle controls.
- Expired and cancelled listings can be relisted from the owner view by creating
  a new on-chain listing transaction.
- The owner view supports selecting relistable stems and applying shared relist
  terms across the selection. Each selected stem still submits through the
  existing listing transaction path.
- Marketplace card stem titles and release-page minted-stem chips link to the
  stem detail page (`/stem/:tokenId`), the asset page showing identity,
  active license tiers, preview, and Buy/Remix/List actions (#1145).
- Sellers choose the listing's license tier (personal / remix / commercial)
  when listing (#1141): the stem page "List for Sale" modal has a tier picker
  with per-tier price prefill from the stem's catalog pricing
  (`GET /api/stem-pricing/:stemId`), and the batch mint-and-list modal has a
  tier select. License tier is an off-chain listing attribute recorded via
  `POST /metadata/notify-listing` → `StemListingIntent`; the on-chain listing
  carries no license type. Remix-tier purchases are what satisfy Remix Studio
  eligibility. Relist keeps the original listing's tier (tier change on relist
  is a deferred follow-up). Offering several tiers at once requires several
  editions, since one active listing consumes the listed units.
- Seller listing and manager surfaces show estimated net proceeds from the
  current marketplace protocol fee and the stem's royalty bps. These values
  are derived from on-chain/API fields, not hardcoded display constants.

## How To Use

### Creator

1. Open `Manage listings` from `/marketplace` or visit `/marketplace/manage`
   with the listing seller wallet or smart account.
2. Filter by Active, Expiring, Expired, Sold, or Cancelled.
3. Select eligible expired or cancelled rows, or use Relist on a single row.
4. Apply price, payment asset, quantity, and duration once for the selection.
5. Confirm the listing transactions; the indexer attaches the new listing rows
   after the chain events are observed.

### Developer

- Public listings: `GET /api/metadata/listings`
- Owner listings: authenticated `GET /api/metadata/listings/owner/:seller`
  for the seller, a linked EOA/smart-account address, or admin.
- Notification preferences:
  - `GET /api/metadata/notifications/:address/preferences`
  - `PATCH /api/metadata/notifications/:address/preferences`
- Relisting uses the existing `StemMarketplaceV2.list` transaction path through
  `useListStem`; it does not mutate the expired listing.
- Buyer quote-backed checkout surfaces expose price, royalty, platform fee,
  seller proceeds, and total payment amounts where those fields are available.

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
| Public marketplace | Excludes expired and sold-out listings and links sellers to the listing manager. |
| Storefront/x402/MCP/agent commerce | Storefront, x402 settlement lookup, MCP catalog search, player actions, and AI DJ catalog search treat expired and sold-out listings as unavailable. |
| Owner listing manager | Shows artwork, seller inventory summaries, searchable lifecycle rows, selectable expired/cancelled inventory, single-row relist controls, and batch relist progress. |
| Notification bell | Routes listing lifecycle notifications to `/marketplace/manage`. |

## Tests

```bash
cd backend && npm run test -- listing_lifecycle.spec.ts notification.service.spec.ts
cd backend && npm run test:integration -- --runInBand --testPathPattern=metadata.controller.integration.spec.ts
cd backend && npm run test:integration -- --runInBand --testPathPattern=agent_catalog_search.integration.spec.ts
```

Frontend validation is currently covered by TypeScript/lint and manual UI review
for `/marketplace/manage`; dedicated component tests should follow once the
listing manager stabilizes.

## References

- Roadmap: [#1004](https://github.com/akoita/resonate/issues/1004)
- Implementation issue: [#1015](https://github.com/akoita/resonate/issues/1015)
- Cross-surface lifecycle audit: [#1118](https://github.com/akoita/resonate/issues/1118)
- Smart contract integration: [Marketplace Integration](../smart-contracts/marketplace_integration.md)
- Code:
  - `backend/src/modules/contracts/listing-lifecycle.ts`
  - `backend/src/modules/contracts/contracts.service.ts`
  - `backend/src/modules/contracts/metadata.controller.ts`
  - `backend/src/modules/agents/tools/tool_registry.ts`
  - `web/src/app/marketplace/manage/page.tsx`
