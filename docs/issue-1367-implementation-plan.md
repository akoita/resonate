# Issue #1367 — Player "Support a show" chip (slice 1)

Wire the player's now-playing `shows_campaign` action to the playing artist's
live campaign. Today it is hardcoded `status: "planned"` in
`CatalogService.getPlayerTrackActions`. This is the "listen → act" loop:
playing an artist's track should surface "Support a show → their active
campaign" as a working, deep-linked chip.

## Backend — `backend/src/modules/catalog/catalog.service.ts`

In `getPlayerTrackActions` (~line 1096):

1. After the track fetch, when `track.release.artistId` is non-null, look up
   the artist's most relevant **active** campaign with the global `prisma`
   singleton (same pattern as the `stemListing` query already in this method):

   ```ts
   const activeCampaign = track.release.artistId
     ? await prisma.showCampaign.findFirst({
         where: { artistId: track.release.artistId, status: "active" },
         orderBy: { createdAt: "desc" },  // verify the model has createdAt; else updatedAt
         select: {
           id: true, slug: true, title: true, city: true,
           goalAmountUnits: true, raisedAmountUnits: true,
           confirmedPledgeCount: true,
         },
       })
     : null;
   ```

   Slice 1 intentionally uses only `status: "active"` (pledging open). Do NOT
   surface draft/pending/funded/booked etc. — "Support a show" means the fan
   can pledge right now. (`PUBLIC_DISCOVERY_EXCLUDED_CAMPAIGN_STATUSES` in
   shows.service.ts is the discovery blocklist; being stricter than it here is
   deliberate.)

2. Replace the hardcoded `shows_campaign` action entry:

   ```ts
   activeCampaign
     ? {
         key: "shows_campaign",
         label: PLAYER_ACTION_LABELS.shows_campaign,
         status: "available",
         href: `/shows/${activeCampaign.slug}`,
         metadata: {
           campaignId: activeCampaign.id,
           slug: activeCampaign.slug,
           title: activeCampaign.title,
           city: activeCampaign.city,
           progressPct,           // computed below
           backerCount: activeCampaign.confirmedPledgeCount,
         },
       }
     : {
         key: "shows_campaign",
         label: PLAYER_ACTION_LABELS.shows_campaign,
         status: "disabled",
         reason: "No live campaign for this artist right now.",
       }
   ```

   `progressPct` = `Math.min(100, Math.round(raised / goal * 100))` computed
   with `Number(...)` on the unit strings, guarded against a zero/invalid
   goal (fall back to 0). Keep it an integer.

   Note the fallback `status` changes from `"planned"` to `"disabled"` with a
   precise reason — the capability is now wired; absence of a campaign is a
   data state, not a roadmap state. Keep `artist_room` and `collect_drop` as
   `"planned"` — they are later slices.

## Web — player chip

`web/src/app/player/page.tsx` renders the chips from
`getPlayerTrackActions` (via `web/src/lib/api.ts`). Verify the generic
renderer already treats `status: "available"` + `href` as an enabled link
chip (it does for `buy_license`/`inspect_stems`); if `shows_campaign` was
special-cased into a coming-soon bucket, remove that special case so it
follows the generic available/disabled behavior. When metadata is shown for
other chips, surface `title` + `progressPct` (e.g. "Aya Nakamura in Montréal
· 78% funded") as the chip's detail line — follow the existing chip detail
pattern, do not invent a new UI primitive.

Internal navigation should use the SPA-friendly pattern the page already uses
for internal hrefs (Next `Link` or router push) — `/shows/<slug>` is internal.

## Analytics

`player.action_impression` / `player.action_selected`
(`web/src/lib/productAnalytics.ts`) already fire generically per action key
from the player page (#1005). Verify `shows_campaign` flows through both with
its `status`, and that selecting the chip fires `player.action_selected`
before navigation. Do NOT add new event names (no taxonomy test churn
expected). If the impression payload includes availability, the flip from
planned→available/disabled must not break `productAnalytics.test.ts` — update
that test only if it asserts the old `planned` status.

## Tests (`backend/src/tests/`)

- `catalog.integration.spec.ts`: extend the existing player-actions coverage:
  1. seed (respecting the FK chain, unique TEST_PREFIX) an artist with a
     release/track AND a `showCampaign` row with `status: "active"`, linked by
     `artistId` → assert the `shows_campaign` action is `available`, `href`
     is `/shows/<slug>`, metadata has title/progressPct;
  2. campaign in a non-active status (e.g. `cancelled`) → assert `disabled`
     with the new reason;
  3. artistId null or no campaign → `disabled`.
- `catalog.controller.spec.ts` / `catalog.controller.http.spec.ts`: update
  any fixture asserting the old `planned` entry.
- Frontend: if `web/src/lib/api.test.ts` or player tests assert the planned
  chip, update them; add/extend a test that an available `shows_campaign`
  action renders as an enabled link.

## Docs (same branch)

- `docs/features/player_action_layer.md`: mark the Support-a-show chip slice
  implemented (status stays `in-progress` overall; Remix/Buy/Artist
  room/Collect remain later slices — keep the remaining-work list explicit).
- `docs/features/README.md`: update the Player Action Layer row to say the
  Support-a-show chip is live (links to #1367).
- User Guide (`web/src/lib/help/content.ts`): the player article — if it
  describes the campaign chip as coming soon, update it to describe the live
  behavior in plain language; keep `web/src/lib/help/help.test.ts` green.

## Verification gates (run from `backend/` and `web/`)

- backend: `npx jest --config jest.config.js --testPathPattern='catalog.controller'` (unit) must pass.
- backend integration (requires Docker — if the sandbox cannot run it, say so
  in the report; the reviewer runs it): `npx jest --runInBand --config jest.integration.config.js --testPathPattern='catalog.integration'`.
- web: `npx vitest run src/lib src/app/player src/components/shows 2>/dev/null || npx vitest run` and `npx eslint` on changed files.
- `git diff --check` clean. Do NOT run `next build`.

## Conventions

- No hardcoded URLs/ports; hrefs are app-relative paths.
- State the revenue line in the PR: (1) Shows campaign fees — conversion feed.
- Keep the diff scoped: backend catalog service + tests, player page chip
  wiring, analytics verification, docs/help. No shows.service changes.
