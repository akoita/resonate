---
title: "Player Action Layer"
status: in-progress
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/1005"
---

# Player Action Layer

## Status

`in-progress`

The first implementation slice adds a player-facing action availability contract
and a Now Playing action surface in the player console. It connects playback to
existing save, playlist, stem inspection, marketplace/license, remix, and
active Shows campaign paths while keeping future community and collect/drop
actions safely disabled or planned until those surfaces expose linkable public
state. The Support-a-show chip is implemented in [#1367](https://github.com/akoita/resonate/issues/1367):
when the playing artist has an active Shows campaign, it deep-links to that
campaign with compact title and funding progress metadata; otherwise it explains
that no live campaign is open for the artist right now.

## Who It Is For

- Listeners who want to act while music is playing.
- Artists who benefit when listening leads to saves, playlists, licensing,
  remix eligibility, community, Shows, and collecting flows.
- Frontend and backend developers adding music-native actions to playback.
- Agent developers that need a compact, redacted action model for track context.

## Value

The player becomes more than transport controls. It gives listeners a clear
answer to: why this track, what can I do with it, and which actions are
available right now?

## Current Surfaces

- UI: `/player?trackId=<track-id>`
- API: `GET /catalog/tracks/:trackId/actions`
- Web helper: `getPlayerTrackActions`
- Player component: `PlayerActionPanel`
- Analytics:
  - `player.action_impression`
  - `player.action_selected`

The player UI keeps album art, title, artist, and stem mixer access in the hero.
Immediately usable actions render in the right console near progress, volume,
and queue context. Disabled or future actions render as a compact
`Unavailable / Coming soon` list with safe reasons, so unavailable capabilities
are visible without behaving like conversion buttons.

The Shows campaign action is part of the implemented conversion feed for revenue
line (1) Shows campaign fees: active campaigns render as `Support a show` chips
linking to `/shows/<slug>`. Non-active campaign states stay disabled here
because player support means pledging is open now.

## Action Contract

Each action has:

- `key`
- `label`
- `status`: `available`, `disabled`, or `planned`
- optional `href`
- optional safe `reason`
- optional compact `metadata`

Initial action keys:

- `save`
- `add_to_playlist`
- `inspect_stems`
- `buy_license`
- `remix`
- `artist_room`
- `shows_campaign`
- `collect_drop`

## Privacy Boundary

The action endpoint is public and intentionally compact. It must not expose:

- hidden wallet addresses;
- owner-only marketplace lifecycle rows;
- private ownership claims;
- raw taste history;
- private community eligibility.

Marketplace/license availability is based only on public active listings with
positive amount and future expiry. Expired, sold, cancelled, zero-amount, and
owner-only inventory must not make player purchase actions available.

Shows campaign availability is stricter than general campaign discovery:
only `active` campaigns are linkable from the player. Draft, pending, funded,
booked, cancelled, refund, and released states remain disabled for this action.

## Remaining Work

- Artist room actions remain planned until public listener room eligibility and
  deep links are available from the action endpoint.
- Collect/drop actions remain planned until active drop state has a public,
  redacted player contract.
- Remix and marketplace/license chips should continue to be hardened as their
  downstream workflows evolve, but no new analytics event names are required for
  this slice.

## How To Test

Backend:

```bash
cd backend
npm run test -- catalog.controller.spec.ts catalog.controller.http.spec.ts
npm run test:integration -- catalog.integration.spec.ts
```

Frontend:

```bash
cd web
npm run test:unit -- api.test.ts productAnalytics.test.ts PlayerActionPanel.test.tsx
```

Manual:

1. Open `/player?trackId=<published-track-id>`.
2. Confirm Now Playing actions render in the right console without shifting
   playback controls.
3. Confirm save changes to `Saved` after success and add-to-playlist uses the
   existing playlist flow.
4. Confirm marketplace/license appears only when an active public listing exists.
5. Confirm Support a show links to `/shows/<slug>` only when the playing artist
   has an active campaign, with title/funding progress shown on the chip.
6. Confirm disabled/planned actions show safe reasons.

## References

- [#1005](https://github.com/akoita/resonate/issues/1005)
- [#1367](https://github.com/akoita/resonate/issues/1367)
- [Strategy execution plan](../strategy/next_generation_music_platform_execution_plan.md)
- [Agent Taste Intelligence](agent_taste_intelligence.md)
- [Marketplace Listing Lifecycle](marketplace_listing_lifecycle.md)
- [Resonate Shows](resonate_shows.md)
- [Remix Studio](remix_studio.md)
- [Listener Community Network](listener_community_network.md)
