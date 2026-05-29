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
and a Now Playing action surface. It connects playback to existing save,
playlist, stem inspection, marketplace/license, and remix paths while keeping
future community, Shows, and collect/drop actions safely disabled or planned
until those surfaces expose linkable public state.

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
- Analytics:
  - `player.action_impression`
  - `player.action_selected`

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
npm run test:unit -- api.test.ts productAnalytics.test.ts
```

Manual:

1. Open `/player?trackId=<published-track-id>`.
2. Confirm Now Playing actions render without shifting playback controls.
3. Confirm save and add-to-playlist use existing library and playlist flows.
4. Confirm marketplace/license appears only when an active public listing exists.
5. Confirm disabled/planned actions show safe reasons.

## References

- [#1005](https://github.com/akoita/resonate/issues/1005)
- [Strategy execution plan](../strategy/next_generation_music_platform_execution_plan.md)
- [Agent Taste Intelligence](agent_taste_intelligence.md)
- [Marketplace Listing Lifecycle](marketplace_listing_lifecycle.md)
- [Resonate Shows](resonate_shows.md)
- [Remix Studio](remix_studio.md)
- [Listener Community Network](listener_community_network.md)
