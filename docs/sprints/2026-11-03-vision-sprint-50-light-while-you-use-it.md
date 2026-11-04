# Vision Sprint 50: Light while you use it, nothing left red

> **Outcome (closed 2026-11-04):** all four items closed. #2535 (#2543), #2534 (#2544; GPU use while active fell to 20.6% from 97%, so the tinted fill was not needed), #2538 (#2545) and #2537 (#2568; duplicate #2567 closed). Milestone 48 closed.

**Status:** ✅ Approved 2026-11-02 by the owner, with the #2534 design call
(isolate the loops first, fill only if needed).
**Milestone:** Vision Sprint 50 (created by the owner once the scope is
approved).
**Goal:** Using Home, the player and Shows no longer keeps a laptop's GPU near
100%, every scheduled check on `main` is green, the last open Dependabot alert
is closed, and an untagged CD rip can get its year and genre without typing
them.

## Why this theme

- **#2436 fixed the idle tab, not the busy one.** A hidden or untouched tab
  now costs about 3% GPU, but while someone is using Home any running
  decorative loop forces the page to re-composite every `backdrop-filter`
  surface on every frame: 80–98% GPU in headless Chromium, about 50% with the
  blurs removed (#2534). It is the most visible quality problem left after
  Sprint 49 and needs one design call.
- **A scheduled check went red on 2026-11-02.** Mutation testing (#2535) was
  cancelled because the ContentProtection shard 4/4 hit the 120-minute job
  timeout; every other leg passed. Kill-scoring the money contracts went
  silent for six weeks once before (#1764), so it is fixed first.
- **One Dependabot alert left.** `zod` 3 under `@x402/core` and `@x402/evm`
  in `web/` (the backend is already on 2.29.0 since #2519). `@x402/*` 2.29.0
  clears the npm `min-release-age=7` hold on 2026-11-04.
- **Local library feedback.** CD rips such as the owner's Caravelle album
  (fre:ac WAVs) carry no year or genre at all, so after #2533 the owner still
  types them by hand. An opt-in lookup closes that loop without writing to
  the files.

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue (CI) | [#2535](https://github.com/akoita/resonate/issues/2535) | Mutation testing green again: ContentProtection gets more interleaved shards (4 → 6) so each leg finishes well under the timeout. Verified by a manual `workflow_dispatch` run. Closes #2535 |
| 2 | P0 | Usability / cost | [#2534](https://github.com/akoita/resonate/issues/2534) | GPU while interacting with Home, Player and Shows cut, measured before and after with `docs/engineering/idle-cost-harness.md`, with before and after screenshots. Approach per the owner's design call below |
| 3 | P1 | Security | [#2537](https://github.com/akoita/resonate/issues/2537) | `web/` moves to `@x402/core` and `@x402/evm` 2.29.x (zod 4), on or after 2026-11-04. Validated on the payment path (x402 checkout unit tests, smart-account checkout e2e). Closes the last Dependabot alert |
| 4 | P1 | Usability | [#2538](https://github.com/akoita/resonate/issues/2538) | In Edit album, **Look up details** searches MusicBrainz by artist, album and track count, shows the best matches, and fills only empty fields (year, genre, label) after the owner picks one. Opt-in per album; sends only artist, album and track count; never writes to the files (#2533 decision) |

### #2534 design call (owner's choice, 2026-11-02)

1. **First, no visible change:** move each decorative loop (kicker-dot pulse,
   equaliser bars, hero shimmer) out of the blurred cards' stacking contexts
   (`isolation`, own compositing layer) so a frame repaints only the loop.
2. **Measure.** If Home still sits above about 40% GPU while in use, replace
   the blur on the three large cards (Home hero card, tuner deck, Shows
   campaign rail) with a translucent solid fill of the same tint. Small
   chrome (top bar, player bar, menus) keeps its blur.
3. Loops are not removed.

## Exit criteria

- Mutation testing run on `main` green; #2535 closed.
- #2534 closed with before and after GPU numbers from the harness and
  screenshots, or the remaining step tracked on the issue.
- No open Dependabot alerts on `main` (the owner checks the Security tab).
- The owner's Caravelle album gets its year from a lookup on staging.
- Verified on staging after a Release Deployment; milestone closed and a
  release cut (project rule).

## Not in this sprint

- #2379 package-check tuning: data-gated on real official uploads.
- Remix Pro (#1903) next slices: Sprint 51.
- Writing tags back into files, and Electron auto-linking by absolute path
  (would store the OS user name): possible desktop opt-ins, not planned.
- Live charging (#2409) and buying credits (#1422): gated on Stripe keys
  (resonate-iac#325) and the #1421 pricing sign-off.

## Waiting on the owner (not sprint work)

- Legal review of the refund wording (#2473); Stripe test keys
  (resonate-iac#325); #1421 pricing sign-off; #2367 remix-challenge decision.
- Owner-passkey staging checks: #2154 and the rekordbox import check #2121.

## Revenue line

- **#2535, #2534, #2537, #2538:** vision-neutral
  infrastructure and quality. No money moves, no fee or split change. The
  x402 bump keeps the existing on-chain artist path (ADR-BM-4) unchanged.
