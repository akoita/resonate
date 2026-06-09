# Issue #1134 Marketplace Pricing Optimization Action Card Slice

## Scope

This slice extends the deterministic artist action cockpit with a specific
marketplace conversion-gap card:

- `improve_marketplace_conversion` appears when aggregate
  `marketplace.purchase_intent` reaches the artist action threshold and no
  `commerce.settled` facts are visible for the artist in the selected analytics
  window.
- `review_marketplace_pricing` remains the generic pricing review card when
  thresholded purchase intent and settled commerce are both visible.

## Product Boundary

- The card deep-links to the existing marketplace management surface for active
  listings.
- The recommendation is advisory only; it does not change listing prices,
  license tiers, payment assets, durations, or inventory state.
- Inputs remain aggregate-only marketplace intent events and artist-attributed
  settled-commerce facts.
- The card does not expose buyer identities, wallet addresses, per-listener
  checkout history, or individual purchase attempts.

## Verification

- Backend analytics tests cover:
  - intent-without-settlement conversion guidance;
  - generic pricing review when settled commerce exists;
  - sub-threshold purchase intent suppression.
- Frontend dashboard tests cover the new card title and CTA through the generic
  action-card renderer.
- Feature docs list the card type, threshold, route, privacy boundary, and
  remaining work.

## Deferred

- Automated repricing.
- Model-backed pricing recommendations.
- Per-license conversion-rate cards once listing availability and settlements
  are consistently tier-attributed.
- Price-range recommendations from historical conversion data.
- Buyer or wallet drilldowns.
