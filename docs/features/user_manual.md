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
  Curators & reporters, and Operators & admins for signed-in operators and
  admins).
- Operator and admin material (guides for admin tools, sections such as
  "Sending a notice (operators)", and links into `/admin`) shows only to
  signed-in operators and admins. Anyone else opening an operator-only guide
  sees a short note instead, and those guides are not indexed by search
  engines.
- Each article has an "On this page" outline, illustrative screenshots, and
  **Open in the app** deep links straight to the relevant screen, plus related
  guides.
- Some articles (Remix Studio first, #1905) offer a **Beginner /
  Intermediate / Professional** switch. Beginner is the default; the choice is
  kept in the URL (`/help/remix-studio?level=pro`) so it can be shared, and
  remembered on the device. Each level ends with a "Ready for more?" link to
  the next one, and a search match in a deeper level opens that level.

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
- **Levels.** Tag a section with `level: "beginner" | "intermediate" | "pro"`
  to show it only on that level; untagged sections (a glossary, eligibility)
  show on every level. An article whose sections use levels gets the switch
  automatically and needs a `levelIntros` entry per level (the tests enforce
  it). The rules live in `web/src/lib/help/levels.ts`; the switch is
  `web/src/components/help/HelpLevelledBody.tsx` (a WAI-ARIA tablist: arrow
  keys, Home/End, `?level=` deep links, a `#section` anchor opens its level,
  and the URL wins over the stored choice). Remix Studio slices (epic #1896)
  update the matching level's section in the same PR.
- **Operator material.** An article whose `audiences` is only `["operator"]`
  is operator-only. In a mixed article, tag a section or an app link with
  `audience: "operator"` to show it only to operators and admins (role
  `admin` or `operator`); every `/admin` app link in a mixed article must be
  tagged (the tests enforce it). The rules live in
  `web/src/lib/help/audience.ts`; the role-aware parts of an article are in
  `web/src/components/help/HelpReaderViews.tsx`. The server render has no
  role, so it shows the reader view and an operator's extra material appears
  once the session is known. This tidies the guide only: admin routes are
  protected by the server whether or not their guide is visible.

## Accessibility & ergonomics

- Server-rendered articles read fully **without JavaScript**; the landing
  search/filter is a progressive-enhancement client island.
- Correct heading order (h1 → h2), `nav`/`search`/`status` landmarks,
  `aria-pressed` persona toggles, an `aria-live` result count, captioned
  `figure`s with descriptive `alt`, `:focus-visible` rings,
  `prefers-reduced-motion` support, ≥44px touch targets, and section
  `scroll-margin` so the sticky top bar never hides anchors.

## Screenshots

Illustrations live in `web/public/help/screenshots/` and are captured with
`web/scripts/capture-help-screenshots.mjs` in several passes:

- **Public pass** (normally from staging; a local public preview is acceptable
  before a new route is first deployed): Discover, Catalog, the Drops gallery
  (`/drops` → `drops.png`), the Player, the Wallet, and the connect wall. Shows,
  a Shows campaign and Browse stems come from the seeded public pass below, not
  from staging. Discover is captured at 1440x1200
  with reduced motion so the Recently Added covers show and the hero stops
  rotating; the script features the first campaign whose title doesn't look
  like QA data (`TEST …`, `QA …`). Review every public shot before committing:
  staging data can put test records in view, and an older screenshot beats one
  that shows a throwaway record or an expired campaign.
- **Signed-in pass** (from a local instance): the screens behind the connect
  wall — Upload, Create, Settings, AI DJ, Sonic Radar, Library, and the Dispute
  Center. The script injects the same mock-auth `localStorage` the E2E tests use
  (`web/tests/auth.setup.ts`) to render the signed-in shells, so no real passkey
  login is needed. Run it against a local instance:
  `BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs`.
- **Seeded-owner pass** (from a seeded local backend): Artist Analytics, Managed
  Catalog, and Community. This pass obtains a real development-login token for
  the fixed E2E artist/listener and injects its seeded wallet address; it does
  not enable mock auth. Seed the backend first, then run from `web/`:

  ```sh
  CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_OWNER=true \
    BASE_URL=http://localhost:3001 API_BASE_URL=http://localhost:3000 \
    node scripts/capture-help-screenshots.mjs
  ```

- **Remix Studio pass** (#1905, opt-in, from a local dev server with mock
  auth): the Remix Studio guide images (`remix-studio-*.png`: the annotated
  overview, section on/off, loop, vibe, per-stem effects with the Pro strip,
  drafts, and the AI part takes). The studio API is fully mocked with the same
  module the Playwright studio flows use
  (`web/tests/fixtures/remix-studio-mock.mjs`), and the pass pins locale, time
  zone, and dates, so the images are deterministic and need no backend or
  staging data. The overview's numbered callouts (1 Session, 2 Transport,
  3 Create, 4 Drafts) are drawn into the image; keep them in sync with the
  legend in the article. From `web/`, with `next dev -p 3001` running:

  ```sh
  CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_REMIX=true \
    BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
  ```

  Add `CAPTURE_ONLY=remix-studio-vibe.png` to refresh one image. Most shots are
  element crops, so update the figure `width`/`height` in `content.ts` if a
  layout change resizes them, and look at every image before committing.
- **Crate Digger pass** (`CAPTURE_CRATES=true`, off by default): the request box,
  a crate page, the quote panel (`crate-digger-quote.png`, #1964) and the export
  panel (`crate-digger-export.png`, #1965) and the watch panel
  (`crate-digger-watch.png`, #1967) for the
  `crate-digger` article, against the fully mocked
  crate API the Playwright flow uses (`web/tests/fixtures/crate-digger-mock.mjs`),
  so no backend or staging data is needed. From `web/`, with mock auth and
  `next dev -p 3001` running:

  ```sh
  CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_CRATES=true \
    BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
  ```
- **Official stems pass** (`CAPTURE_OFFICIAL_STEMS=true`, off by default): the
  artist's Official stems panel on a release page (`official-stems-panel.png`)
  and the Official / Separated (AI) badges with the source menu in Browse stems
  (`stem-source-badges.png`, #2379) for the `official-stems` and `stem-sources`
  guide sections, from fixed mock data
  (`web/tests/fixtures/official-stems-mock.mjs`), so no backend or catalog data is
  needed. From `web/`, with mock auth and `next dev -p 3001 --webpack` running:

  ```sh
  CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_OFFICIAL_STEMS=true \
    BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
  ```

- **Seeded public pass** (#1846, `CAPTURE_SEEDED=true`, off by default): the
  Shows page (`shows.png`), a live pledgeable campaign page
  (`show-campaign.png`) and Browse stems (`marketplace.png`: listings with
  cover art, a mix of license tiers and the Official and Separated (AI) source
  badges). These pages read their data on the Next.js server or through its
  proxy, so browser route mocks cannot reach them; the script instead starts a
  tiny sample backend (`web/tests/fixtures/guide-seed-mock.mjs`) on the port of
  `API_BASE_URL` (default 3000) with invented artists, six live campaigns and
  six stems, plus generated abstract art (no photos of real people, no real
  artist names). Dates are relative to the run, so a campaign never shows as
  expired. The local app must use the default API URL and nothing else may be
  listening on port 3000 (set `CAPTURE_SEEDED_START_API=false` to point at an
  already running sample backend). From `web/`, with `next dev -p 3001`
  running:

  ```sh
  CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_SEEDED=true \
    BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
  ```

  The figures' `height` values in `content.ts` follow each target's
  `viewportHeight`; update both together and look at every image before
  committing.

## Surfaces

- **UI routes:** `/help`, `/help/[slug]`
- **Entry points:** sidebar `User Guide`, top-bar `?` button, About dialog. The
  About dialog identifies non-production environments and links support/help;
  it does not publish maintainer identity or exact build provenance.
- **Code:** `web/src/app/help/`, `web/src/components/help/`,
  `web/tests/fixtures/remix-studio-mock.mjs` (shared studio mock),
  `web/tests/fixtures/guide-seed-mock.mjs` (sample Shows and Marketplace backend),
  `web/src/lib/help/`, `web/src/styles/help.css`
- **Assets:** `web/public/help/screenshots/`
- **Tests:** `web/src/lib/help/help.test.ts`,
  `web/src/components/help/HelpLevelledBody.test.tsx`,
  `web/tests/help-levels.spec.ts`

## Coverage notes

The guide currently has 20 articles spanning getting started, discovery,
playback, library/playlists, the marketplace (buy and sell), AI music creation
and remixing, artist upload/analytics/rights, Resonate Shows (back and run),
community, disputes, settings/privacy, troubleshooting, and the desktop app.

Coverage notes:

- Signed-in screens are illustrated via the mock-auth capture pass (Upload,
  Create, Settings, AI DJ, Sonic Radar, Library, Disputes).
- Data-heavy owner views are illustrated via the seeded-owner pass: Artist
  Analytics, Managed Catalog, and the Community benefits/cohorts hub. Run the
  backend seed and the exact command above when refreshing those assets.
- The guide should keep expanding as features ship — it is a living surface,
  like the feature catalog.

## Related

- Issue: [#428](https://github.com/akoita/resonate/issues/428)
- Most articles map to a page under `docs/features/` (Resonate Shows, Remix
  Studio, Marketplace lifecycle, Rights verification, Community network, etc.).
