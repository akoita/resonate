# Feature Tips

**Status:** `implemented` (first set of tips; more can be added one entry at a time)
**Audience:** all web users, signed in or not
**Surface:** wherever a tip's feature lives (queue, playlists, library, playlist panel, catalog, Loop and Repeat), plus Settings › Help & tips
**Vision:** vision-neutral product quality (no money, payouts, ingestion trust, AI billing, collectibles or licensing)

## What it does

Some of Resonate's most useful features have no visible button: selecting
several tracks with Shift or Ctrl/Cmd-click, dropping tracks onto a playlist in
the side panel, queueing a card from its right-click menu, looping a passage.
Feature tips point them out once, right where they can be used, with a small
dismissible pop-up: a title, one or two sentences, **Got it**, **Learn more**
(the matching User Guide section) and **Turn off tips**.

## Rules (so tips never nag)

- Each tip appears **at most once** in a browser, wherever it is placed. It is
  recorded as seen the moment it appears, so ignoring it never brings it back.
- **One tip on screen at a time**, and **at most one new tip a day**
  (`FEATURE_TIP_COOLDOWN_MS`).
- A tip waits until its spot has been relevant for 2.5 s (for example a queue
  with at least three tracks and nothing selected), and only while the tab is
  visible. It closes when the spot stops being relevant (a selection starts,
  the panel closes, the page changes).
- Tips about mouse gestures (multi-select, drag and drop) are not offered on
  touch-only screens; the card tip names the queue button instead of
  right-click there. The modifier key reads **Cmd** on Apple devices and
  **Ctrl** elsewhere.
- **Turn off tips** in any tip, or the switch in **Settings › Help & tips**,
  stops them all. **Show tips again** there forgets which were seen.
- Everything is stored in this browser only (`localStorage`,
  `resonate.featureTips`); the server never learns which tips someone saw. If
  storage is blocked, no tip is shown, because it could not be remembered.

## Tips shipped

| Tip id | Where | Shown when |
| --- | --- | --- |
| `select-several-tracks` | Player queue, a playlist's track list, My Library tracks | 3+ tracks and nothing selected |
| `drag-to-playlist` | Playlist side panel | Panel open with at least one playlist |
| `queue-from-cards` | Catalog (releases, artists, playlists) | Cards loaded |
| `loop-passage` | Loop and Repeat (player bar and full player) | A track is playing, the section is closed and no loop or repeat is set |

## Adding a tip

1. Add an entry to `FEATURE_TIPS` in `web/src/lib/featureTips.ts` (title, body,
   User Guide link, whether it needs a mouse). The test checks that every
   `learnMore` link points at an existing User Guide section.
2. Render `<FeatureTip tipId="…" anchorRef={ref} eligible={…} />` next to the
   feature, with `placement="inside"` for a panel with no room around it.
3. Keep the copy short and plain, and mention the tip in the User Guide only if
   the feature itself is not described there already.

## Code

- Rules, storage, one-at-a-time coordination: `web/src/lib/featureTips.ts`
  (tests: `web/src/lib/featureTips.test.ts`)
- Pop-up and placement: `web/src/components/ui/FeatureTip.tsx`,
  `web/src/styles/feature-tips.css` (one entrance animation, nothing loops)
- Settings: `web/src/components/settings/FeatureTipsSettingsPanel.tsx`

## Not done yet

- Tips are per browser, not per account; a signed-in listener on a new device
  sees them again. Syncing would need a server-side preference, deliberately
  left out to keep the "never recorded" promise simple.
- No analytics on whether tips help; add only through the existing consented
  product analytics if it becomes useful.
