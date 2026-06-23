---
title: "In-App User Guide"
status: implemented
owner: "@akoita"
---

# In-App User Guide

A user-facing manual built into the app at **`/help`**. It explains *how to
use* Resonate in plain language, illustrated with real screenshots — distinct
from the developer-facing `docs/` (RFCs, architecture, feature specs).

- **Status:** `implemented`
- **For:** every persona — listeners, artists, producers/remixers,
  curators/reporters, and operators/admins.
- **Value:** new users can answer "how do I…?" without leaving the app or
  reading the codebase; existing users can look up any feature.

## How to use it

### As an end user

- Open it from the sidebar (**User Guide**), the **?** button in the top bar
  (available on every page), or the **About** dialog ("Learn how to use
  Resonate").
- On the landing page, **search** (e.g. `passkey`, `remix`, `refund`) or
  **filter by who you are** (Listeners, Artists, Producers & remixers,
  Curators & reporters, Operators & admins).
- Each article has an "On this page" outline, illustrative screenshots, and
  **Open in the app** deep links straight to the relevant screen, plus related
  guides.

### As a developer

- Content is authored as **type-safe structured data**, not free-form MDX, so
  rendering is consistently accessible and search needs no runtime parser.
- Add or edit an article in `web/src/lib/help/content.ts`. The shape is in
  `web/src/lib/help/types.ts`; categories/personas are in
  `web/src/lib/help/taxonomy.ts`.
- Articles render automatically — `/help/[slug]` is statically generated from
  the content list via `generateStaticParams`.
- Tests in `web/src/lib/help/help.test.ts` enforce unique slugs, valid
  related-links, valid categories/audiences, and that **every referenced
  screenshot file exists on disk** (so a broken image fails CI, not users).
- **Update an article in the same PR as the feature it documents** (see the
  Feature Catalog rules in `CLAUDE.md`).

## Accessibility & ergonomics

- Server-rendered articles read fully **without JavaScript**; the landing
  search/filter is a progressive-enhancement client island.
- Correct heading order (h1 → h2), `nav`/`search`/`status` landmarks,
  `aria-pressed` persona toggles, an `aria-live` result count, captioned
  `figure`s with descriptive `alt`, `:focus-visible` rings,
  `prefers-reduced-motion` support, ≥44px touch targets, and section
  `scroll-margin` so the sticky top bar never hides anchors.

## Screenshots

Illustrations live in `web/public/help/screenshots/` and are captured from the
**public** surfaces of staging with `web/scripts/capture-help-screenshots.mjs`
(`BASE_URL=… node scripts/capture-help-screenshots.mjs`). Captured today:
Discover, Catalog, Shows, a Shows campaign, the Marketplace, the Player, the
Wallet, and the connect wall.

## Surfaces

- **UI routes:** `/help`, `/help/[slug]`
- **Entry points:** sidebar `User Guide`, top-bar `?` button, About dialog
- **Code:** `web/src/app/help/`, `web/src/components/help/`,
  `web/src/lib/help/`, `web/src/styles/help.css`
- **Assets:** `web/public/help/screenshots/`
- **Tests:** `web/src/lib/help/help.test.ts`

## Coverage & follow-ups

The guide currently has 20 articles spanning getting started, discovery,
playback, library/playlists, the marketplace (buy and sell), AI music creation
and remixing, artist upload/analytics/rights, Resonate Shows (back and run),
community, disputes, settings/privacy, troubleshooting, and the desktop app.

Tracked follow-ups:

- Authenticated-only screens (Create, Upload, Settings, Disputes, AI DJ,
  Sonic Radar, Community, Library) are documented with text and deep links;
  capturing logged-in screenshots needs an authenticated capture pass and is
  deferred (passkey login can't be automated in the public capture script).
- The guide should keep expanding as features ship — it is a living surface,
  like the feature catalog.

## Related

- Issue: [#428](https://github.com/akoita/resonate/issues/428)
- Most articles map to a page under `docs/features/` (Resonate Shows, Remix
  Studio, Marketplace lifecycle, Rights verification, Community network, etc.).
