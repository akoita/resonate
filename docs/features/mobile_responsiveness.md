---
title: "Mobile Responsiveness"
status: implemented
owner: "@akoita"
---

# Mobile Responsiveness

Resonate's primary web surfaces support phone viewports from 320 to 400 pixels
wide without widening the document or placing active controls outside the
viewport. Dense desktop interfaces intentionally reflow, wrap, or use a
clearly scrollable row on phones instead of clipping content.

## Covered Surfaces

The regression audit covers Home, Library and playlists, artist profile and
editing, artist catalog and upload, Create, Marketplace, a seeded Shows
campaign, Wallet, Player, Community, Settings, and Artist Analytics. It runs
with a real test-signed artist session so authenticated route shells and their
controls are rendered.

The shared phone layout also provides a drawer navigation, compact persistent
player, stacked cards and forms, and viewport-contained transaction dialogs.
Marketplace stem filters reflow into a compact grid at phone widths, while
Wallet detail rows stack so addresses and actions remain reachable.

## Validation

Run the cross-viewport regression suite from `web/`:

```bash
npx playwright test tests/responsive.spec.ts
```

The mobile project checks 320, 375, 390, and 400 pixel widths. Failures report
the route, document width, and bounded geometry for the elements and controls
that escaped the viewport. Desktop and tablet smoke checks remain in the same
spec, including drawer, sidebar, persistent-player, and long Drops-card
coverage.

The audit deliberately ignores controls inside an intentional horizontal
scroller and closed off-canvas navigation or playlist panels. It does not use a
global `overflow-x: hidden` rule to conceal widening content.

## Scope

This is vision-neutral UX quality under `vision:keep`. It changes no fee,
split, payout, price, licensing rule, collectible, or deployment authority.
See [#1440](https://github.com/akoita/resonate/issues/1440) for the systematic
audit and [#1427](https://github.com/akoita/resonate/issues/1427),
[#1428](https://github.com/akoita/resonate/issues/1428), and
[#1439](https://github.com/akoita/resonate/issues/1439) for earlier focused
mobile fixes.
