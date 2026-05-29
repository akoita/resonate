# Issue #1015 Implementation Plan

## Goal

Make marketplace listing expiry a managed creator lifecycle instead of a
passive purchase filter. Expired listings should disappear from public purchase
surfaces, remain understandable and actionable for the seller, notify the seller
once per lifecycle threshold, and support a first-class relist path that creates
a new on-chain listing.

## Current Baseline

- `StemListing.status` is currently a string with active/sold/cancelled-style
  values, while expiry is primarily represented by `expiresAt`.
- Public marketplace reads already protect buyers by requiring `amount > 0` and
  `expiresAt > now`.
- Listing reads hydrate payment-token/price data from `StemListingIntent` when
  the indexer races listing intent capture.
- Notification preferences currently cover dispute/evidence events, not
  marketplace lifecycle events.
- The frontend marketplace is buyer-focused; there is no dedicated owner
  listing-management surface with expired inventory and relist actions.

## First Slice

1. Define shared listing lifecycle semantics in backend code:
   - `active`
   - `expiring_soon` as a derived owner-facing view state
   - `expired`
   - `sold`
   - `cancelled`
   - `stale` only where chain/DB repair requires it
2. Add an owner listing-management API that returns seller inventory across
   active, expiring soon, expired, sold, and cancelled states without exposing
   expired inventory to public buyer surfaces.
3. Add an expiry reconciliation service that idempotently transitions eligible
   active rows to `expired` when `expiresAt <= now`.
4. Add idempotent marketplace lifecycle notifications:
   - `listing_expiring_soon`
   - `listing_expired`
5. Extend notification preferences for marketplace lifecycle events and make the
   notification bell route these notifications to the owner listing surface.
6. Add an owner listing-management UI with filters and an expired-listing relist
   CTA.
7. Add relist UX that pre-fills safe prior metadata and submits a new on-chain
   listing transaction instead of mutating the old listing.

## Non-Goals

- Do not change `StemMarketplaceV2` listing semantics in this slice.
- Do not make expired listings purchasable through x402, MCP, storefront, agent,
  or public marketplace surfaces.
- Do not introduce a new background infrastructure dependency unless the
  existing NestJS process cannot host the reconciliation safely.
- Do not add new environment variables unless scheduling/configuration requires
  them; if any are introduced, document them in deployment docs in the same
  branch.

## Implementation Notes

- Prefer a derived lifecycle presenter/helper so public and owner reads do not
  duplicate expiry logic.
- Keep public reads strict: active inventory must still require active status,
  positive amount, and unexpired `expiresAt`.
- Use `StemListingIntent` or the previous listing row only as a prefill source;
  relisting must still call the existing on-chain list flow.
- Marketplace lifecycle notifications need an idempotency key or equivalent
  guard so reconciliation runs do not spam sellers.
- Owner-facing expired rows should include enough metadata for artists to
  understand what happened: stem, track, tier/license, price, amount, payment
  asset, listed date, and expiry date.

## Validation

Backend:

- Integration tests for active-to-expired reconciliation and idempotency.
- Public-vs-owner listing visibility tests.
- Notification preference and notification idempotency tests.
- Regression tests for storefront/x402/agent surfaces excluding expired
  listings.

Frontend:

- Owner listing-management filter tests for active and expired rows.
- Relist CTA/prefill tests for relistable expired rows.
- Notification routing tests for marketplace lifecycle notification types.

Docs:

- Update `docs/features/README.md`.
- Add or update the dedicated marketplace feature page under `docs/features/`.
- Update `docs/smart-contracts/marketplace_integration.md`.
