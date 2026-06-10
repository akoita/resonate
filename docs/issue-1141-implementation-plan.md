---
title: "Implementation Plan: Seller License-Tier Listings"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/1141"
related:
  - docs/features/remix_studio.md
  - docs/features/marketplace_listing_lifecycle.md
  - docs/issue-894-implementation-plan.md
---

# Implementation Plan: #1141 Seller License-Tier Listings

Branch: `feat/1141-remix-tier-listings`

Lets sellers create remix (and commercial) license-tier listings from the UI,
closing the gap where the #894 "Get remix license" CTA routes buyers to a
marketplace that can only ever contain personal-tier listings.

## Verified architecture (no backend or contract change needed)

- `StemMarketplaceV2.list()` carries no license type on-chain; the indexer
  stamps `StemListing.licenseType` from
  `event.licenseType ?? StemListingIntent.licenseType`
  (`contracts.service.ts:638`), defaulting to `personal`.
- `POST /metadata/notify-listing` **already accepts**
  `licenseType: "personal" | "remix" | "commercial"` and upserts the
  `StemListingIntent` keyed by `(transactionHash, tokenId)`
  (`metadata.controller.ts:2070+`).
- The buy side already consumes tiers: per-stem `tierListings` in the public
  listings payload, the BuyModal tier selector, and remix eligibility's
  `StemPurchase.licenseType = remix` proof.

The three frontend gaps:

1. `ListStemModal` (stem page "List for Sale") has **no tier picker and never
   calls notify-listing at all** — its listings always index as personal.
2. `MintStemButton` hard-codes `licenseType: "personal"` in its
   notify-listing payload.
3. The batch mint-and-list path in `useContracts.ts` hard-codes `"personal"`.

## Slices

### 1. Seller tier picker in `ListStemModal`

- Add a license tier radio group (Personal / Remix / Commercial) with the
  same tier descriptions used by the buy-side `LicenseTypeSelector`
  ("Use in derivative works, publish remixes", etc.), defaulting to Personal.
- Accept a new optional `stemId` prop (the stem page has the catalog id since
  #894's metadata change) and fetch `GET /api/stem-pricing/:stemId` to
  **prefill the price per tier** (`basePlayPriceUsd` → personal,
  `remixLicenseUsd` → remix, `commercialLicenseUsd` → commercial) when the
  listing asset is a USD stablecoin; manual price entry always wins.
- After a successful on-chain `list()`, **send the notify-listing call**
  (currently missing entirely from this flow) with `transactionHash`,
  `tokenId`, `stemId`, seller, price, amount, paymentToken, duration, and the
  chosen `licenseType` — this both stamps the tier via the listing intent and
  gives this flow the same instant-broadcast behavior mint-and-list has.
- Edition guard copy: when balance is 1 and the user picks a non-personal
  tier, note that offering multiple tiers simultaneously requires multiple
  editions (one active listing consumes the listed units).

### 2. Tier parameter through mint-and-list flows

- `MintStemButton`: accept `licenseType` (default `"personal"`) and surface a
  compact tier select beside the existing mint-and-list control on the
  release page owner section; thread it into the notify-listing payload.
- Batch mint-and-list in `useContracts.ts`: take `licenseType` in its params
  (default `"personal"`) instead of the hard-coded literal; callers unchanged
  default to personal.

### 3. Out of scope (documented)

- Tier change on relist from `/marketplace/manage` — relist keeps the
  original tier (noted in the issue as optional; deferred).
- x402 remix-tier receipts (remix backlog E4).
- Marketplace deep-link from the remix CTA (carried item; unchanged).

## Tests (vitest)

- `ListStemModal.test.tsx` (new): tier picker renders three tiers with
  descriptions; default personal; selecting remix prefills the remix price
  for USD assets; notify-listing payload carries the chosen tier + tx hash;
  edition note appears for balance 1 + non-personal tier.
- Extract pure helpers where it keeps tests render-free:
  `tierDefaultPriceUsd(pricing, tier)` and
  `buildNotifyListingPayload(...)`.
- `MintStemButton`: payload test for the threaded tier (pure helper if the
  component is too wired for static render).

## Docs

- `docs/features/marketplace_listing_lifecycle.md` + catalog row: seller tier
  listings.
- `docs/features/remix_studio.md`: license-required CTA path now satisfiable
  end to end in-app.

## Commit plan

1. `feat(#1141): add license tier picker and notify-listing to ListStemModal`
2. `feat(#1141): thread license tier through mint-and-list flows`
3. `docs(#1141): document seller license-tier listings`

## Verification

- `cd web && npx vitest run` (full) + eslint on changed files +
  `npm run build`.
- Backend untouched → existing CI only.
- Manual staging check after merge: list a stem with the remix tier, buy it,
  confirm the release-page CTA flips to "Remix".
