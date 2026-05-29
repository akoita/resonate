# Issue #1005 Implementation Plan

## Goal

Make the player the primary action surface for listeners. While a track is
playing, the listener should understand why it is relevant when a reason is
available, see which music-native actions are possible, and move directly into
save, playlist, stem inspection, marketplace/license, remix, Shows, community,
or collection flows without leaving playback context.

## Current Baseline

- `web/src/app/player/page.tsx` renders the main player stage, queue, mixer
  toggle, add-to-playlist action, and share controls.
- `web/src/lib/playerContext.tsx` owns current track, queue, playback state,
  mixer state, playback analytics, and remote catalog playback mapping.
- `web/src/lib/playlistStore.ts` already supports playlist creation, track
  addition, backend sync, IndexedDB fallback, and product analytics.
- `backend/src/modules/catalog/catalog.controller.ts` exposes public track and
  release reads but does not expose a compact action-availability contract.
- `backend/src/modules/recommendations/recommendations.service.ts` returns
  recommendation `reasons`, but those reasons are not preserved through the
  player once a track is playing.
- `backend/src/modules/contracts/metadata.controller.ts` exposes active
  marketplace listing reads and owner lifecycle reads; the player can use only
  public active listing availability.
- Product analytics already accepts governed `product/event` ingestion from the
  web app and has existing playlist, marketplace, agent, and settings events.

## First Slice

1. Add a backend player action-availability contract:
   - route: `GET /catalog/tracks/:trackId/actions`
   - returns track/release identity, safe recommendation explanation text when
     provided by query or known backend context, and action descriptors for
     save, add-to-playlist, inspect-stems, marketplace/license, remix, artist
     room, Shows campaign, and collect/drop.
   - each action has `key`, `label`, `status`, optional `href`, optional safe
     `reason`, and minimal metadata needed by the frontend.
2. Keep the first implementation conservative:
   - save and add-to-playlist are available for playable catalog tracks;
   - inspect-stems is available when public stems exist;
   - marketplace/license is available only when at least one public active,
     unexpired, positive-amount listing exists for a stem on the track;
   - remix is available when a public active remix listing exists or the track
     has clearly remixable stem/license metadata;
   - artist room, Shows campaign, and collect/drop return disabled/planned
     states until their current product surfaces expose safe linkable data.
3. Add safe redaction boundaries:
   - no hidden wallet addresses;
   - no owner-only listing lifecycle data;
   - no private ownership claims;
   - no raw taste history;
   - no private community eligibility.
4. Add frontend API helpers and types for player actions.
5. Add a Now Playing action surface to the player:
   - desktop: a compact panel near the hero/player context;
   - mobile: a touch-friendly action sheet/stack using the same data;
   - preserve existing playback controls, mixer access, and queue ergonomics.
6. Wire the first actionable commands:
   - save/library action where existing library APIs support it;
   - add to playlist through the existing modal;
   - stem inspection to `/stem/:tokenId` or the best available stem detail path;
   - marketplace/license to the marketplace listing or filtered marketplace
     context where available.
7. Emit product analytics:
   - `player.action_impression`
   - `player.action_selected`
   - include only safe IDs and action keys/statuses.

## Non-Goals

- Do not build full artist rooms, campaign rooms, taste cohorts, or community
  matching in this issue.
- Do not expose owner-only marketplace lifecycle rows to public player action
  responses.
- Do not infer private ownership or wallet state on the client.
- Do not require a new environment variable.
- Do not redesign the full player visual system beyond the action panel needed
  for this issue.

## Implementation Notes

- Prefer a backend presenter/helper for action descriptors so controller tests
  and service tests can verify the privacy contract independently from the UI.
- Treat recommendation reasons as optional. The player should render nothing
  awkward when no reason exists.
- Keep disabled reasons safe and product-facing, for example "No active stem
  license is available" rather than policy internals or private ownership state.
- Reuse `API_BASE` from `web/src/lib/api.ts` and existing analytics helpers.
- Add product analytics event names to `web/src/lib/productAnalytics.ts` before
  emitting them from UI code.
- Keep feature docs separate from this planning doc:
  - update `docs/features/README.md`;
  - add or update a dedicated player/action-layer feature page under
    `docs/features/`.

## Validation

Backend:

- Controller HTTP tests for `GET /catalog/tracks/:trackId/actions`.
- Service tests for action shaping across available, unavailable, and disabled
  action states.
- Tests proving expired, sold, cancelled, owner-only, and zero-amount listings
  do not make marketplace/license actions available.
- Redaction tests proving wallet, ownership, private taste, and community
  eligibility data are absent from the public response.

Frontend:

- API helper tests for the player actions endpoint.
- Component tests for available actions, disabled reasons, and missing
  recommendation reason handling.
- Product analytics helper tests for the new player action event names.

Manual:

- Load `/player?trackId=<published-track-id>`.
- Confirm playback controls remain fast and stable.
- Confirm add-to-playlist still opens the existing modal.
- Confirm marketplace/license action appears only for active public listings.
- Confirm mobile layout has no overlap between player controls, queue, and
  action surface.

Docs:

- Update the feature catalog for the player action layer.
- Link #1005 from the relevant feature page and PR summary.
