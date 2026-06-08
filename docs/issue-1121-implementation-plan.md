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

## Second Slice Card Types

- `review_show_city_demand`: deep link to the relevant Shows campaign when
  aggregate city-demand joins meet the five-signal floor.
- `post_campaign_update`: deep link to the relevant Shows campaign/community
  update surface when aggregate campaign-update views meet the five-signal
  floor.
- `invite_holder_collectors`: deep link to the artist community tab when
  aggregate holder-room joins meet the five-signal floor.
- `prepare_remix_challenge`: disabled card when aggregate remix creation exists
  but the Remix Studio challenge workflow is still planned rather than live.

## Third Slice Card Types

- `relist_expired_inventory`: deep link to
  `/marketplace/manage?status=expired` when owner-visible marketplace inventory
  reports expired or cancelled listings that can use the existing relist flow.
- `review_marketplace_pricing`: deep link to
  `/marketplace/manage?status=active` when artist-attributed marketplace
  purchase intent reaches the five-signal floor.

## Privacy Boundary

Cards use artist-owned catalog metadata and aggregate counts only. No listener
identity, wallet address, raw playback history, cohort membership, private
community membership, or per-listener action appears in the DTO.
Listener/community/purchase-intent cards require at least five aggregate events
before counts are shown. Owner-inventory cards use counts from the protected
seller workspace and do not expose seller wallet addresses in the artist
analytics DTO.

## Validation

- Backend unit test for card derivation and threshold behavior.
- Backend controller test for product analytics allow-list events.
- Frontend component test for action cards.
- Feature catalog/documentation update.
