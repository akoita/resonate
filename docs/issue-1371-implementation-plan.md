# Issue #1371 — Campaign detail width + horizontal density pass

Live-UAT feedback on the #1365 redesign: the page still reads as one narrow
vertical column. Widen the campaign detail page and lay sections out
side-by-side so a desktop user gets an overview without excessive scrolling.
Desktop-only changes (≥1280px); mobile/tablet stacking stays as it is today.

## Files

- `web/src/styles/shows.css` — all layout changes live here.
- `web/src/app/shows/[campaignId]/page.tsx` — regroup sections into the new
  grid wrappers (markup-only; no data/logic changes).
- Do NOT touch: `/shows` explorer page layout, home page, `CampaignHero`,
  pledge/trust/operator component internals, help content.

## Changes

### 1. Widen the detail page only

The explorer and detail share `.shows-page` (max-width 1440px). Add a modifier
class on the detail page's `<main>` (e.g. `shows-page--wide`) rather than
changing `.shows-page` globally:

```css
.shows-page--wide {
  max-width: min(1720px, 100%);
  padding-left: clamp(24px, 3vw, 48px);
  padding-right: clamp(24px, 3vw, 48px);
}
```

### 2. Body grid: give the rail fixed comfort, the narrative the rest

`.show-detail__body` currently `minmax(0,1fr) minmax(340px,420px)`. Change the
rail to `minmax(360px, 440px)` and keep the narrative fluid. Rail stays sticky.

### 3. Narrative column: two-up rows instead of a single stack

Inside `.show-detail__narrative` (fluid, now much wider), introduce paired
rows at ≥1280px (single column below):

- **Row A**: campaign pitch + "Meet the artist" side by side
  (`grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr)`). When one of
  the two is absent, the present one spans full width (`:only-child` or a
  conditional wrapper class from the TSX).
- **Row B**: signal snapshot cards go 4-across at ≥1280px (they already use
  `repeat` — verify they don't wrap 2×2 at the new width; adjust minmax).
- **Row C**: "Why this matters" + "How it works" side by side; the three
  how-it-works steps stack vertically inside their half (they are currently
  3-across which forces the full width).
- **Gallery**: `repeat(auto-fill, minmax(240px, 1fr))` so it uses the width
  (currently fixed columns), capped at 6 items as today.
- **Community panel + escrow notice**: full-width rows, unchanged internals.

### 4. Above-the-fold check

On a 1920×1080 viewport the hero must not exceed ~72vh so the pitch/trust row
peeks above the fold. If needed, cap `.campaign-detail-hero` min-height with
`min(560px, 72vh)`.

## Verification gates

- `npx vitest run src/components/shows src/lib/help` — all pass.
- `npx eslint` on changed files — 0 errors.
- `git diff --check` clean.
- Do not attempt `next build` (hangs in sandbox); the reviewer runs it.

## Conventions

- Keep the existing shows.css comment style and CSS variable usage.
- No hardcoded colors — use the `.shows-surface` custom properties.
- Media queries: reuse the file's existing breakpoints (search `@media` in
  shows.css; it uses 1280px/1080px/900px/720px tiers).
