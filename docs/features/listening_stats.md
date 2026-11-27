---
title: "Your listening (listener stats)"
status: implemented
owner: "@akoita"
issues: [2729]
---

# Your listening

## Goal

Show every signed-in listener how they listen: time listened, top artists and
tracks, genres and moods, a daily trend, the time of day they listen, how often
they play tracks to the end, and their listening streak. Only the listener can
see their page.

Revenue line (ADR-BM-6): vision-neutral listener experience. No money, payouts
or prices are involved.

## How to use

- Open **Your listening** from the sidebar account menu, or the **Your
  listening** button in the Library header (`/listening`).
- Pick **7 days**, **30 days**, **90 days** or **Year**. The choice is kept in
  this browser (`localStorage`, best effort).
- **Play these** queues the listed top tracks; a cover plays one track.
- User Guide article: `/help/your-listening`.

## How it works

`GET /listening/stats?days=7|30|90|365` (JWT user only, no `userId` parameter)
is computed on read by `ListeningStatsService` from the listener's own
`AgentSignal` rows. Nothing new is stored.

- A **play** is a counted play: the `complete` signal recorded at 30 s (upgraded
  in place when the track plays through) or a `replay`. Plays the AI DJ starts
  count too. Local-file plays send no play events, so they never count.
- **Time listened** is the recorded completion ratio times the track duration,
  never less than the 30 s of a counted play (a careful lower bound).
- Only plays the listener let Resonate remember exist: signals are written only
  with product-analytics consent and taste-memory training on. The response's
  `recording` flag says whether new plays are being remembered now, and the page
  explains when they are not. A taste reset forgets everything before it here
  too.
- **Artists** are grouped by the credited artist (main `ReleaseArtistCredit`),
  else the resolved credited name, never the uploader account. An artist is
  *new to you* when none of their tracks was played before the window.
- **Genres and moods** come from the release's `genre` and `moods`.
- **Morning / afternoon / evening / night** and weekday/weekend come from the
  broad buckets the player already sends with each play.
- **Days, streaks and the busiest day** are worked out in the browser
  (`web/src/lib/listeningStats.ts`) from `activity`, plays in 15-minute UTC
  slots, so the server never needs the listener's time zone.
- Reads are capped (20,000 plays newest first; `truncated` tells the page).

## Code

- Backend: `backend/src/modules/listening_stats/` (aggregation in
  `listening_stats.aggregate.ts`); tests `listening_stats_aggregate.spec.ts`,
  `listening_stats.controller.http.spec.ts`, `listening_stats.integration.spec.ts`.
- Web: `web/src/app/listening/page.tsx`, `web/src/styles/listening-stats.css`,
  `web/src/lib/listeningStats.ts` (+ test); sample data in
  `web/tests/fixtures/listening-stats-mock.mjs`, used by the laptop layout check
  and the User Guide screenshot.

## Not yet

- A shareable recap (image or link).
