---
title: "Jump back in (Home)"
status: implemented
owner: "@akoita"
issues: [2735]
---

# Jump back in

## Goal

A returning listener's first question on Home is "where was I?". The **Jump
back in** row answers it: what the signed-in listener played or opened lately
(hours, days, months), newest first, between the featured campaign hero and the
catalog section. The catalog stays among the first Home components; the row is
hidden for signed-out visitors and for listeners with no history, so newcomers
still meet the catalog first.

Revenue line (ADR-BM-6): vision-neutral listener experience. No money, payouts
or prices are involved.

## What it shows

Up to 12 tiles, one per thing, newest first. Each tile shows a type badge, the
title, an artist or owner line, "Played …" or "Opened …", and a one-click play.

| Kind | Source | Play button |
| --- | --- | --- |
| Album / Single / EP / Remix | plays (server) and opened release pages | plays the release; a played one resumes at the last track |
| Playlist (your own, or someone's public one) | plays from that playlist (server) and opened playlist pages | plays the playlist; a played one resumes at the last track |
| Artist | opened artist pages | plays the artist's releases, newest first |
| Stems (a release's stem mixer) | opened `/release/:id?mixer=true` | plays the release; the tile opens the mixer |
| Show | opened campaign pages (never drafts) | none; opens the campaign |
| Stem | opened stem pages | none; opens the stem |

A release played and later opened is one tile at its latest moment and keeps
the resume point. Remix Studio drafts are deliberately left out: they are work
in progress, listed in the studio, not listening.

## How it works

- **Plays:** `GET /listening/recent?limit=1..24` (JWT user only, default 12)
  reads the listener's own `complete`/`replay` AgentSignals of the last 180
  days, the same consented rows as [Your listening](listening_stats.md), newest
  600 at most. Computed on read, nothing stored. A taste reset hides everything
  before it. A play made from a playlist the listener can still open (own, or
  public) counts for that playlist, any other play for the track's release.
  Unavailable tracks (withdrawn, removed, under review, restricted) are left
  out. Device files never appear: they are not catalog tracks and the player
  never sends their ids. Release tiles carry the release's AI disclosure.
- **Opened pages:** recorded in this browser only (`localStorage`,
  `resonate.recentViews.v1.<userId>`, 30 entries max) by the artist, release,
  playlist, show and stem pages, for signed-in listeners only. Never sent to
  the server and not telemetry. Entries are validated on read (same-origin
  links, http(s) or same-origin images). A full local reset removes them.
- **Clear** empties this device's list and hides everything up to that moment,
  plays included, on this device (`resonate.recentViews.clearedAt.v1.<userId>`).
  It does not delete play history; Settings → Taste Memory reset does.
- **Layout:** a compact two-row tray (`HomeShelf` with `JumpBackInCard`), so the
  catalog stays near the top. A skeleton keeps the space while a stored session
  is restored (`html[data-session="stored"]`), and the row collapses when there
  is nothing to show.

## Code

- Backend: `backend/src/modules/listening_stats/listening_recent.{aggregate,service,controller}.ts`;
  tests `listening_recent_aggregate.spec.ts`, `listening_recent.controller.http.spec.ts`,
  `listening_recent.integration.spec.ts`.
- Web: `web/src/components/home/JumpBackIn.tsx`, `RecordRecentView.tsx`,
  `web/src/lib/jumpBackIn.ts`, `web/src/lib/recentViews.ts`; tests next to each.
  Sample data for screenshots: `web/tests/fixtures/jump-back-in-mock.mjs`.
- User Guide: `/help/discover-music#jump-back-in`.
