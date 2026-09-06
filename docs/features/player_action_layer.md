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

The player-session improvements in [#1614](https://github.com/akoita/resonate/issues/1614)
add ordered batch queue mutations, fair shuffle cycles, authenticated Saved/remove
state, immersive mode, and a mute toggle that restores the previous audible level.
This is vision-neutral product quality work and changes no fees, payouts, or
monetization mechanics.

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

The authenticated `POST /analytics/product/event` endpoint accepts both action
events with a `track` subject. Impressions carry aligned, unique `actionKeys`
and `actionStatuses` arrays; selections carry one known `actionKey` with
`actionStatus: available`. The backend fixes the source to `player`, derives
the pseudonymous actor from the session, and drops extra payload fields,
including titles, links, wallet details, and availability reasons. Unavailable
actions are observed in impressions but do not produce selection events.

The player suppresses unchanged action-panel impressions during a mounted page
visit. Retrying either event with the same client event ID, actor, session, and
track retains one ledger event; a new deliberate action receives a fresh ID.
Warehouse export and Dataflow preserve the action fields without counting them
as listening or revenue. Authenticated staging acceptance, browser impression suppression, retry
deduplication, and selection ingestion were verified on 2026-09-06; see
[#1732](https://github.com/akoita/resonate/issues/1732) and the
[Sprint 20 evidence](../sprints/2026-09-06-vision-sprint-20-player-action-telemetry.md#staging-outcome).

The player UI keeps album art, title, artist, and stem mixer access in the hero.
Immediately usable actions render in the right console near progress, volume,
and queue context. Disabled or future actions render as a compact
`Unavailable / Coming soon` list with safe reasons, so unavailable capabilities
are visible without behaving like conversion buttons.

Queue actions are available for individual tracks, selected release tracks,
albums, and playlists. Additions keep their source order, skip track IDs already
present in the active queue, update the queue immediately, and persist for the
browser playback session. Removing an entry reconciles the current position and
the active shuffle cycle.

Shuffle keeps a played set and navigation history instead of choosing each next
track independently. A track does not repeat automatically until every eligible
unique queue entry has played. Added entries join the current cycle; removed
entries are filtered without resetting playback; Previous walks known history;
Next retraces that history before drawing another eligible entry. Repeat All
starts a new cycle only after exhaustion.

The volume icon is a keyboard-operable mute toggle. Muting records the last
non-zero volume, and unmuting restores it while keeping the slider, master audio,
and stem mixer synchronized. The same player stage can enter browser fullscreen;
when fullscreen is unavailable or denied, it uses an in-page immersive fallback.
Escape and the visible exit control leave immersive mode without replacing the
audio element or queue.

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

Authenticated responses also contain owner-scoped `library` state with the
listener's saved flag and library-row ID. Anonymous responses use `library: null`.
The identity comes only from optional JWT authentication; no caller can query
another listener's library state.

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
   existing playlist flow; activating Saved removes the track and returns it to
   Save without a reload.
4. Confirm marketplace/license appears only when an active public listing exists.
5. Confirm Support a show links to `/shows/<slug>` only when the playing artist
   has an active campaign, with title/funding progress shown on the chip.
6. Confirm disabled/planned actions show safe reasons.
7. Add a track, selection, album, and playlist; confirm source order is retained,
   duplicates are skipped, and the current track is not interrupted.
8. Enable shuffle and confirm every queued track plays once before Repeat All
   starts another cycle; add and remove entries during the cycle.
9. Mute and unmute with pointer and keyboard, then enter and exit immersive mode
   with its button and Escape; confirm playback position and queue stay unchanged.

## References

- [#1005](https://github.com/akoita/resonate/issues/1005)
- [#1367](https://github.com/akoita/resonate/issues/1367)
- [#1614](https://github.com/akoita/resonate/issues/1614)
- [Strategy execution plan](../strategy/next_generation_music_platform_execution_plan.md)
- [Agent Taste Intelligence](agent_taste_intelligence.md)
- [Marketplace Listing Lifecycle](marketplace_listing_lifecycle.md)
- [Resonate Shows](resonate_shows.md)
- [Remix Studio](remix_studio.md)
- [Listener Community Network](listener_community_network.md)


## Save and control a listening session

Implemented for #1724, #1721 and #1723. These
controls serve listeners and curators; they are vision-neutral product quality.

**Save queue as playlist** appears beside Queue Manifest for ad-hoc or modified
queues. It snapshots past, current and upcoming tracks in manifest order, never
shuffle traversal order. An unchanged playlist links to its source. Provenance
survives player-state restoration; a coincidental content match does not create
source identity. Saving uses existing folder selection and private defaults and
does not change playback or overwrite the source playlist.

Unsupported local entries are listed and require confirmation before omission.
Deleted or unavailable catalog entries cause the server to reject the entire
save, with no partially created playlist. The dialog identifies those entries
and requires confirmation before retrying without them. Authenticated snapshots create the
playlist and resolve catalog entries into the owner's library in one database
transaction. An API failure is surfaced rather than silently creating a local
replacement. Signed-out saves use local storage; public sharing still requires
account synchronization.

**Loop and repeat** is available in the compact bar and full player. On the
player page the console owns the panel and the compact bar does not repeat it.
The panel is a console module rather than a form: a `.studio-label` kicker,
status LEDs for an armed passage or repeat plan, hairline rules instead of
nested boxes, inset rack wells with mono readouts, and the same chip family as
the Now Playing action row.
A–B markers
are seconds within a known track duration. The timeline highlights the range;
seeking is clamped within it, and B returns to A. Editing applies on Update
passage; Clear passage restores normal playback. Track changes clear markers.

Finite repeats count **additional** replays. A track plan advances after its last
replay; a queue plan finishes after its last complete cycle. Manual seeking does
not consume counts; selecting/skipping another track cancels a track plan.
Queue replacement/clear cancels a queue plan; additions/removals follow existing
queue and fair-shuffle rules. Finite and infinite repeats replace each other.
A–B loops take priority without consuming counts. Finite plans survive in-app
navigation, but are not persisted across browser sessions.

### Analytics and API

`POST /playlists` accepts optional `queueContext` with `origin: player_queue`,
`sourceKind: ad_hoc | modified_playlist`, `queueCount`, and `omittedCount`.
Authenticated queue saves emit one server `playlist.created` event containing
that context and `savedTrackCount`; the browser emits no duplicate creation.
Names and track titles are excluded from that event. Folder ownership and track
availability are checked before committing a snapshot.

The authenticated product-event ingestion path accepts
`player.segment_loop_enabled`, `player.segment_loop_updated`,
`player.segment_loop_disabled`, `player.repeat_count_set`,
`player.repeat_count_updated`, and `player.repeat_count_cleared`. Payloads carry
canonical track/artist/release and playback context when available, plus range
milliseconds or target/configured/remaining counts. The server validates ranges
and counts and discards unrelated payload fields. Signed-out interactions do
not upload events. Automatic loop/repeat iterations emit no control-action
events; segment loops never reset qualifying-play state.

### Verification

- `web/src/lib/listeningSession.test.ts`: provenance, snapshots, boundaries,
  repeat counts and repeated shuffle cycles.
- `web/src/lib/queuePlaylist.test.ts`: atomic client request, failure/cache
  behavior, and no duplicate analytics.
- `web/tests/listening-session.spec.ts`: real player context with controlled
  audio events, queue snapshots, provenance and loop/repeat interaction.
- Backend playlist Testcontainers and analytics HTTP/envelope/bridge suites
  cover persistence, owner checks and event acceptance.
- Refresh the player overview with `CAPTURE_ONLY=player.png` using
  `web/scripts/capture-help-screenshots.mjs`. Set `CAPTURE_LISTENING_HELP=true`
  when running the passage-loop browser scenario to refresh the populated
  controls illustration.
- Verify desktop and mobile controls with keyboard focus, then perform a
  combined staging walkthrough before closing the milestone.

No new environment variables, schema migration, pricing, payout, or contract
changes are required. Named saved passages and cross-device repeat plans remain
out of scope.
