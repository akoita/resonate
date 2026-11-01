# Vision Sprint 49: Owned means owned, every moment named

**Status:** ◐ In progress. Owner-approved 2026-11-01, including the proposed
defaults.
**Milestone:** to be created by the owner (the agent session cannot create or
close milestones).
**Goal:** What the library says you own comes only from what you actually
hold, and a golden moment reads as the right kind (Punchline, Crescendo, Hook,
Solo) everywhere it appears, not just on the collectible card.

## Why this theme

- **The local library epic is one issue from done.** #2503 shipped in #2510
  and the staging feedback in #2517. The server now rejects ownership fields on
  local rows, but on catalog rows `isOwned`, `tokenId` and `listingId` still
  come from the client (#2511). No server path trusts them today, yet
  `resolveAvailability()` uses `isOwned` to keep a withdrawn track playable, so
  the label should come from holdings. Closing #2511 closes the epic.
- **Sprint 48 left golden moments half-renamed.** A moment can now come from
  any stem or the full mix and carries a `momentKind` (#2489), but the Library
  Moments tab and public profile cards still call every moment a Punchline, the
  builder still asks instrumental moments for a "lyric", and the set-bonus clip
  is still cut from vocals (#2522).
- **Slice 3 is a stretch, and only half unblocked.** #1184 (closed) stores one
  summary per stem: tempo, first beat, key, overall energy and onset density.
  It has no energy-over-time curve, so a suggested range needs a new loudness
  scan of the chosen layer (re-scoped 2026-11-01, see below).
- **Small, low-risk sprint after the 45–48 night run and today's library
  and player work.** It finishes tails instead of opening new surfaces, so the
  owner's review queue (below) doesn't grow much.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#2511](https://github.com/akoita/resonate/issues/2511) | `isOwned`, `tokenId` and `listingId` on catalog library rows are derived from the account's holdings (`StemPurchase` / wallet ownership); any client value is ignored. Closes epic #2503 |
| 2 | P1 | Usability | [#2522](https://github.com/akoita/resonate/issues/2522) | Library Moments tab and profile cards show the moment kind; non-vocal moments ask for a caption, not a lyric; the set-bonus clip follows the set's source layer |
| 3 | P1 | Known issue (owner) | [#2436](https://github.com/akoita/resonate/issues/2436) | Carried from Sprint 45. The owner runs the idle CPU/GPU/memory check on staging (steps in the issue thread). Close if fine; if GPU stays high on Home or Shows, one PR swaps the blur behind those two surfaces for a solid fill |
| 4 | P2 | Business value | [#1476](https://github.com/akoita/resonate/issues/1476) slice 3 | The moment builder suggests ranges from a loudness scan of the chosen layer, snapped to the measured beat grid, that the artist can accept or adjust. Closes #1476. On-demand ffmpeg loudness scan, owner's call 2026-11-01 (#2526) |

## Re-scope log

- 2026-11-01: #2511 (#2524) and #2522 (#2525) opened. Slice 3 found to need an
  energy-over-time scan that #1184 does not store. Owner asked whether to build
  an on-demand ffmpeg loudness scan or defer the slice.
- 2026-11-01: owner chose the on-demand scan. Slice 3 opened as #2526 (stacked
  on #2525). #2525 also gained the set-bonus editor previewing the same layer
  the bonus is cut from.

## Defaults taken (owner may override in review)

1. **Holdings source for #2511.** Ownership is read on write and on list from
   `StemPurchase` plus on-chain holdings already indexed. If a value can't be
   resolved, the row shows as not owned rather than trusting the client.
2. **Set-bonus fallback.** When a set mixes source layers, the bonus clip uses
   the most common layer in the set and falls back to vocals, and the builder
   says which layer it used.
3. **Slice 3 stays a suggestion.** Suggested ranges never auto-publish and
   never change the clip length caps from Sprint 48.

## Exit criteria

- PRs for #2511 and #2522 merged with focused backend and web tests green.
- #2503 and #1476 closed, or the remaining slice tracked on the issue.
- #2436 closed with the owner's numbers, or one follow-up PR open.
- Verified on staging after a Release Deployment.

## Not in this sprint

- #2379 threshold tuning: data-gated on real official packages; backlog.
- #1903 Remix Pro mode remaining slices (automation, beat grid, stem export):
  bigger and better as its own sprint.
- Live charging (#2409) and buying credits (#1422): gated on Stripe keys
  (resonate-iac#325) and the #1421 pricing sign-off.
- #2367 remix challenges: owner decision first.

## Waiting on the owner (not sprint work)

- Legal review of the refund wording for Stripe cancel on erasure (#2473).
- The 10 s full-mix clip cap (#2489) and the listening share campaign line
  (#2485).
- Stripe test keys (resonate-iac#325), the #1421 pricing sign-off, the #2367
  remix-challenge decision.

## Revenue line

- **#2511, #2436:** vision-neutral infrastructure and quality. No money moves.
- **#2522, #1476 slice 3:** line 3 (collectibles), presentation and authoring
  only. No new fee or price. ADR-BM-4: utility, not yield; the artist receives
  at least 85% of a paid collect.
