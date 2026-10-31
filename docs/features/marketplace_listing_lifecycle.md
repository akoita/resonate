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
- Owner listing management is available at `/artist/listings` (sidebar
  **Listings**, artist side) and from lifecycle notification deep links.
  `/marketplace/manage` redirects there. Public browsing of listings lives at
  `/crates?tab=stems` (**Browse stems** in Crates & Stems); `/marketplace`
  redirects there (#2032).
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
- Owners can cancel a live listing (#284): active and expiring-soon rows in the
  owner view have **Cancel listing**, which asks for confirmation
  (`ConfirmDialog`) and calls `StemMarketplaceV2.cancel(listingId)` through the
  same smart-account (passkey) transaction path as other listing writes
  (`useCancelListing`). The row shows `cancelling` while the transaction is
  signed and confirmed, then flips to `cancelled` (and relistable when editions
  remain) as soon as it confirms. The indexer's `Cancelled` event
  (`contract.listing_cancelled`) persists the same state; until the owner API
  reports it, reloads keep the confirmed row cancelled
  (`web/src/lib/listingCancellation.ts`), and the page reloads its inventory
  when the `marketplace.listing_cancelled` websocket event names a row on
  screen. A dismissed passkey prompt, a listing created by another account
  (`NotSeller`), or any other failure leaves the row active with a
  plain-language error. Business model: ADR-BM-6 Line 3 (marketplace); no
  fee, price, or payout change.
- Owners can edit a live listing in one step (#2480): active and expiring-soon
  rows have **Edit listing**, which opens the relist dialog prefilled with the
  listing's terms (price, payment asset, quantity, duration). Listings are
  immutable on-chain, so saving sends `cancel(oldListingId)`, the marketplace
  approval when it is missing, and `list(...)` as **one** batched smart-account
  UserOperation (`useEditListing`, planned by
  `web/src/lib/listingEdit.ts` on top of the batch relist planner). The new
  listing keeps the old license tier and gets the same notify-listing intent
  as a relist; the new `list()` is simulated first so a failing price is
  reported before the passkey prompt. The batch reverts as a whole, so a
  dismissed prompt, `NotSeller`, or any other failure leaves the old listing
  active with a plain-language error in the dialog. While it is signed the row
  shows `updating`; once it confirms the old row gets the same cancelled
  overlay as a manual cancel and the inventory reloads, and the new listing
  appears when the indexer records it. Business model: ADR-BM-6 Line 3; no fee,
  price-policy, or payout change.
- Expired and cancelled listings can be relisted from the owner view by creating
  a new on-chain listing transaction.
- The owner view supports selecting relistable stems and applying shared relist
  terms across the selection. The selection is relisted with one confirmation
  per group of up to 10 stems (#2030): each group is one batched transaction
  (marketplace approval only when it is missing, then one listing per stem),
  and every relisted listing keeps its own license tier. A group fails as a
  whole; the dialog names the group's stems, the stem a pre-sign check found
  failing when it can, the stems already relisted in earlier groups, and keeps
  only the unlisted stems selected for a retry.
- Marketplace card stem titles and release-page minted-stem chips link to the
  stem detail page (`/stem/:tokenId`), the asset page showing identity,
  active license tiers, preview, and Buy/Remix/List actions (#1145).
- Sellers choose the listing's license tier (personal / remix / commercial)
  when listing (#1141): the stem page "List for Sale" modal has a tier picker
  with per-tier price prefill from the stem's catalog pricing
  (`GET /api/stem-pricing/:stemId`), shared with Mint & List and the batch
  mint-and-list modal. License tier is an off-chain listing attribute recorded via
  `POST /metadata/notify-listing` → `StemListingIntent`; the on-chain listing
  carries no license type. Remix-tier purchases are what satisfy Remix Studio
  eligibility. Relist keeps the original listing's tier (tier change on relist
  is a deferred follow-up).
- Sellers can offer one stem under several license tiers at once (#2041),
  each with its own price per edition and edition count, in one confirmation
  (one batched smart-account UserOperation; no contract change). The stem-page
  **List for Sale** modal, the release page **Mint & List** button (which now
  opens a tier dialog) and **Batch Mint & List** share one tier picker
  (`web/src/components/marketplace/TierPicker.tsx`). Because listings do not
  reserve balance and every sale transfers one edition, the planner
  (`web/src/lib/multiTierListing.ts`) never creates a listing the seller
  cannot fill: editions free to list = balance − editions in the seller's
  active listings of that token (floored at 0); any shortfall is minted with
  `StemNFT.mintMore` in the same batch, and a seller who is not the stem's
  creator (and so cannot mint) is blocked with a plain explanation instead.
  Mint flows mint the summed editions and call `listLastMint` once per tier.
  Browse stems shows one card per stem with a chip per available tier and its
  listing price; a chip opens checkout on that tier's listing.
- Seller listing and manager surfaces show estimated net proceeds from the
  current marketplace protocol fee and the stem's royalty bps. These values
  are derived from on-chain/API fields, not hardcoded display constants.
- Buyers have one home for purchased stems (#2042): **Library › Stems**
  (`/library?tab=stems`). The collection endpoint
  (`GET /api/metadata/collection/:walletAddress`) now returns, per stem,
  `licenseType` (the best standard tier the wallet bought across every
  purchase of that stem: `personal` < `remix` < `commercial`, or `null`) and
  `holding` (`purchased`, or `listed` for a stem the wallet only sells). The
  tier ranking is shared with crate export
  (`backend/src/modules/contracts/stem_license_tier.ts`). Library › Stems shows
  a license badge per stem, an All / Remix-ready / Personal filter, Remix for
  Remix/Commercial holders, **Upgrade to Remix license** (opens the stem page)
  for Personal holders, one **Remix N stems together** action per source track
  with two or more remix-ready stems, and an empty state pointing to Browse
  stems. Browse stems adds **My purchased stems** (signed-in only, since the
  library needs sign-in) next to **Manage listings** (hero) and **Manage my
  listings** (toolbar); the Listing Manager empty state tells buyers their
  purchases live in Library › Stems. After a purchase the buy modal stays open
  on a success view (Browse stems and the stem page no longer close it in
  `onSuccess`; their refreshes still run): the outcome, **View in your
  library** and, for Remix/Commercial purchases with a known track, **Open in
  Remix Studio** (eligibility-checked), with a single **Done** button and no
  purchase control, so the buyer cannot pay twice. The success view is
  captured at purchase time and does not depend on the (possibly refreshed or
  sold-out) listing. The old "You now own this stem NFT" toast is gone. An x402
  payment shows the library link only when it settled through the marketplace
  (`contract_backed`), since only then does a purchase row exist. Business
  model: ADR-BM-6 Line 3 (marketplace); no fee, price, or payout change.
- The success view also offers a tailored **license share** (#1915, parent of
  the fan-action shares): **Share what you licensed** with X, Facebook,
  Reddit, the native share sheet and copy link. Copy comes from
  `web/src/lib/fanActionShare.ts` ("I licensed the vocals stem of "<track>"
  by <artist> on Resonate", plus "to remix it" / "for commercial use" for
  those tiers) and links the public stem page `/stem/<tokenId>` with
  `utm_campaign=license_share`. It never states the price, payment method,
  receipt, transaction, or wallet. The at-least-85% claim appears only when
  the stem's creator made the sale (x402 checkout, or a wallet purchase whose
  listing seller is the on-chain creator); a resale leaves it out, since the
  reseller is paid. X posts fit 280 characters with links counted as 23;
  Reddit titles fit 300. Shares record `marketplace.license_shared` with the
  token id, listing id, channel and `trigger=after_purchase` only. The share
  is offered only when the listing's token is known. Business model: ADR-BM-6
  Line 3 (marketplace take-rate), distribution only; no fee change.

## How To Use

### Creator

1. Open **Listings** in the sidebar (`/artist/listings`)
   with the listing seller wallet or smart account.
2. Filter by Active, Expiring, Expired, Sold, or Cancelled.
3. To stop selling a live listing, choose **Cancel listing** on its row and
   confirm; the row turns Cancelled once the transaction confirms.
   To change its price or other terms instead, choose **Edit listing**, adjust
   the terms, and save; one confirmation closes the old listing and opens the
   new one (#2480).
4. Select eligible expired or cancelled rows, or use Relist on a single row.
5. Apply price, payment asset, quantity, and duration once for the selection.
6. Confirm once per group of up to 10 stems; the indexer attaches the new
   listing rows after the chain events are observed.

### Artist: offering several license tiers (#2041)

1. From a stem chip on your release page choose **Mint & List** (or **List
   for Sale** for a minted stem), select stems for **Batch Mint & List**, or
   open **List for Sale** on the stem page.
2. Tick Personal, Remix and/or Commercial. Each ticked tier takes a price per
   edition (prefilled from the stem's catalog pricing for stablecoin listings)
   and an edition count (default 1). Prices above the release's current price
   limit are flagged inline.
3. Read the summary line, e.g. "Lists 2 license tiers (2 editions); mints 1
   more edition to cover them, in one confirmation.", then confirm once.
4. The listing intent sent to the backend carries every tier with its order
   in the transaction and, when readable from the receipt, its listing id, so
   each listing is labelled with the right tier. Every web caller sends it
   with the user's sign-in token and `sellerAddress` (the Next proxy forwards
   `Authorization`); if it is refused or fails, the listing stays on-chain and
   a non-blocking notice says the tier may take a moment to show.

### Developer

- The collection endpoint is owner-only (#2139): it requires sign-in (a JWT)
  and answers only for the caller's own addresses — the wallet-auth account
  address, and the `address`/`ownerAddress` of the caller's wallet record —
  so a wallet's holdings and license tiers are no longer publicly readable.
  Other wallets get `403` with a generic message, a malformed address `400`,
  and no token `401`; `admin`/`operator` keep support access. Library › Stems
  sends the user's token for the sign-in wallet and the smart account and
  treats a refused request as no stems. Remix eligibility was already derived
  server-side from the authenticated user's own wallet and is unchanged.
- Public listings: `GET /api/metadata/listings`
- Owner listings: authenticated `GET /api/metadata/listings/owner/:seller`
  for the seller, a linked EOA/smart-account address, or admin.
- Notification preferences:
  - `GET /api/metadata/notifications/:address/preferences`
  - `PATCH /api/metadata/notifications/:address/preferences`
  - Both require sign-in and answer only for the caller's own addresses (see
    the notification routes in
    [community_curation_disputes.md](community_curation_disputes.md)).
- Relisting uses `StemMarketplaceV2.list` through `useRelistMany` and the pure
  planner in `web/src/lib/batchRelist.ts` (#2030); it does not mutate the
  expired listing. The planner groups listings by token with tiers ordered
  personal → remix → commercial, never splits one token's tiers across chunks,
  and moves a repeat relist of the same token and tier to a later chunk. Each
  chunk sends one notify per token with the shared transaction hash: a single
  tier uses the single-tier body, several tiers of one token use `tiers[]` with
  ordinals (and listing ids read from the receipt). Once the marketplace is
  approved, each `list()` is simulated before signing to name a failing stem.
- Per-tier listing intents (#2041). `POST /api/contracts/notify-listing`
  (`POST /metadata/notify-listing`) requires a JWT and a `sellerAddress` that
  is one of the caller's own addresses (sign-in account address or the
  wallet record's `address`/`ownerAddress`; `admin`/`operator` may notify for
  any seller): no token `401`, missing or malformed `sellerAddress` `400`,
  another seller `403`, with nothing written. It keeps the single-tier body
  (`licenseType`, `price`, `amount`) and also accepts
  `tiers: [{ licenseType, pricePerUnit, amount, ordinal, listingId? }]` for a
  transaction that calls `list()` once per tier for the same token. `ordinal`
  is the 0-based order of that token's `list()` calls (= its `Listed` logs) in
  the transaction; `listingId` is the on-chain id when the client read it from
  the receipt. With `tiers`, the top-level tier fields are ignored. Invalid
  tiers (not 1–3 entries, duplicate `licenseType` or `ordinal`, unknown
  tier, non-integer or negative `ordinal`, non-numeric price/amount/listingId)
  return `400`. Each tier is stored as one `StemListingIntent`, unique on
  `(transactionHash, tokenId, sellerAddress, licenseType)` (an ERC-4337
  bundle transaction can carry several senders), with `logOrdinal` and
  `listingId` (both null for the single-tier body). A `tiers` notify replaces
  all of that seller's earlier intents for the transaction and token; a
  single-tier notify replaces the seller's other single-tier intents, so a
  corrected retry wins.
- Trust: an intent applies to a listing only when its `sellerAddress` equals
  the on-chain seller (case-insensitive); intents written before #2041 have no
  seller and still apply. Chain values win: an indexed listing's price,
  amount and seller always come from the `Listed` event and are never
  overwritten by notify. Intents supply only the license tier, the stem link,
  and the payment asset of a native-token fallback row (the `Listed` event
  carries no payment token, so the indexer stamps the zero address; the price
  on chain is already in the asset's units).
- Matching a `Listed` event to its tier
  (`backend/src/modules/contracts/listing-intent-matching.ts`), over the
  on-chain seller's intents for the same transaction and token: (a) the intent
  whose `listingId` equals the event's; (b) when every intent has a
  `logOrdinal`, the one equal to the listing's ordinal; (c) the only intent,
  for single-tier bodies; otherwise the default tier (`personal`) and a
  warning. An intent pinned to a different `listingId` is never used for (b)
  or (c). The ordinal is the listing's rank among the seller's listing ids for
  the token in the transaction: `StemMarketplaceV2` assigns ids with
  `++listingId`, so id order equals log order. Siblings come from the raw
  `Listed` `ContractEvent` rows (the indexer stores each log before publishing
  it and walks a receipt in log order) plus already-indexed `StemListing`
  rows, so the result does not depend on the order the handlers run in. If
  the `Listed` events are indexed before the notify call, the call applies the
  same rule to the already-indexed rows (tier, stem link, fallback payment
  asset). Listing reads that backfill native-token fallback rows match per
  listing too (listing id, then tier, then the only intent). Relisting a tier
  still supersedes the same seller's active listing of that token and tier
  only; other tiers stay active.
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
| Public stem browsing (`/crates?tab=stems`) | Excludes expired and sold-out listings; sellers manage theirs from **Listings**. One card per stem: a stem listed under several tiers shows a chip per tier with its price, opening checkout on that tier (#2041). |
| Storefront/x402/MCP/agent commerce | Storefront, x402 settlement lookup, MCP catalog search, player actions, and AI DJ catalog search treat expired and sold-out listings as unavailable. |
| Owner listing manager | Shows artwork, seller inventory summaries, searchable lifecycle rows, selectable expired/cancelled inventory, single-row relist controls, batch relist with one confirmation per group of up to 10 stems (#2030), Cancel listing (#284), and one-step Edit listing that batches cancel + relist into one confirmation (#2480). Its empty state points buyers to Library › Stems (#2042). |
| Buyer purchases (`/library?tab=stems`) | Purchased stems with their best license tier, a license filter, Remix / Upgrade to Remix license actions, and a multi-stem Remix action per source track (#2042). Reached from **My purchased stems** on Browse stems (signed in) and the buy modal's success view. |
| Notification bell | Routes listing lifecycle notifications to `/artist/listings`. |

## Tests

```bash
cd backend && npm run test -- listing_lifecycle.spec.ts notification.service.spec.ts
cd backend && npm run test:integration -- --runInBand --testPathPattern=metadata.controller.integration.spec.ts
cd backend && npm run test:integration -- --runInBand --testPathPattern=agent_catalog_search.integration.spec.ts
cd backend && npm run test:integration -- multi_tier_listing
cd backend && npm run test -- listing_intent_matching.spec.ts metadata_notify_listing.controller.http.spec.ts
cd web && ./node_modules/.bin/vitest run src/lib/ownedStems.test.ts src/components/marketplace/PurchaseHandoff.test.tsx
cd web && ./node_modules/.bin/vitest run src/lib/fanActionShare.test.ts src/components/marketplace/BuyModal.test.tsx src/components/share
cd web && ./node_modules/.bin/vitest run src/lib/multiTierListing.test.ts src/lib/marketplaceStemGroups.test.ts src/components/marketplace/TierPicker.test.tsx src/components/marketplace/ListStemModal.test.tsx
```

Frontend validation is currently covered by TypeScript/lint and manual UI review
for `/artist/listings`; dedicated component tests should follow once the
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
  - `backend/src/modules/contracts/listing-intent-matching.ts`
  - `backend/src/modules/agents/tools/tool_registry.ts`
  - `web/src/app/artist/listings/page.tsx`
  - `backend/src/modules/contracts/stem_license_tier.ts`
  - `web/src/lib/ownedStems.ts`
  - `web/src/app/library/page.tsx`
  - `web/src/components/marketplace/PurchaseHandoff.tsx`
  - `web/src/lib/multiTierListing.ts`
  - `web/src/lib/marketplaceStemGroups.ts`
  - `web/src/components/marketplace/TierPicker.tsx`
- Buyer home for purchased stems: [#2042](https://github.com/akoita/resonate/issues/2042)

## Stem source (#1976)

Each listing's stem has a source, `official` (the artist's lossless parts) or
`separated` (AI), returned on `GET /api/metadata/listings` and filterable with
`?source=`. The source is catalog metadata: nothing changes on the marketplace
contracts, and the two sources are separate stems with their own listings and
prices. See [Official stems](official_stems.md).
