# Issue #1121 Implementation Plan

## Scope

Add a first artist action cockpit slice to `/artist/analytics` so artist-facing
work includes recommended actions, not only metric display.

## Implemented Slice

- Extend `GET /analytics/artist/:id/v1` with a stable `actions` block.
- Derive cards from artist-owned catalog state and aggregate analytics already
  present in the dashboard response.
- Render action cards above metric charts with safe links or disabled reasons.
- Emit privacy-safe product analytics for card impressions and clicks.
- Document the current action-card types, privacy threshold, API field, events,
  and tests.

## Initial Card Types

- `promote_top_track`: deep link to the player when aggregate plays identify a
  top track above threshold.
- `review_marketplace_readiness`: deep link to the marketplace management view
  when protected releases are marketplace-ready.
- `start_listener_community`: deep link to the artist community tab when catalog
  and analytics indicate enough aggregate listener activity to gather fans.
- `prepare_marketplace_catalog`: disabled guidance for artists with catalog
  activity but no marketplace-ready releases yet.

## Privacy Boundary

Cards use artist-owned catalog metadata and aggregate counts only. No listener
identity, wallet address, raw playback history, cohort membership, or
per-listener action appears in the DTO. Listener-derived cards require at least
five aggregate events before counts are shown.

## Validation

- Backend unit test for card derivation and threshold behavior.
- Backend controller test for product analytics allow-list events.
- Frontend component test for action cards.
- Feature catalog/documentation update.
