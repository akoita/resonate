# Responsive UI/UX audit — #557

Tracking doc for the per-page audit requested in issue
[#557](https://github.com/akoita/resonate/issues/557).

## Canonical breakpoints

Defined in [web/src/styles/tokens.css](../src/styles/tokens.css) and
[web/src/hooks/useBreakpoint.ts](../src/hooks/useBreakpoint.ts):

| Name    | Range           | Notes                          |
|---------|-----------------|--------------------------------|
| phone   | `<768px`        | Sidebar becomes slide-in drawer |
| tablet  | `768px–1279px`  | Sidebar collapses to icon rail  |
| desktop | `≥1280px`       | Full layout                     |

Use these values in new `@media` queries and in `useBreakpoint()` —
don't add new one-off thresholds (600, 860, 900, 1024) unless a
component has a genuine case that doesn't fit the canonical tiers.

## What's already shipped in this PR

- [`tokens.css`](../src/styles/tokens.css) — breakpoint values + `--touch-target: 44px`.
- [`useBreakpoint.ts`](../src/hooks/useBreakpoint.ts) — `matchMedia`-based hook.
- [`globals.css`](../src/app/globals.css) — base responsive layer: horizontal-overflow guard, fluid media, touch-target minimum on coarse pointers, responsive app-shell overrides (phone drawer + tablet icon rail).
- [`Sidebar.tsx`](../src/components/layout/Sidebar.tsx) — drawer mode with backdrop; auto-closes on route change.
- [`Topbar.tsx`](../src/components/layout/Topbar.tsx) — hamburger button (visible on phone only) toggles the drawer; title truncates.
- [`PlayerBar`](../src/components/layout/PlayerBar.tsx) — compact layout on phone (tighter insets, volume slider hidden, controls wrap).
- [`GlobalPlaylistPanel`](../src/components/layout/GlobalPlaylistPanel.tsx) — renders as full-width sheet on phone.
- [`playwright.config.ts`](../playwright.config.ts) — adds `chromium-tablet` and `chromium-mobile` projects.
- [`tests/responsive.spec.ts`](../tests/responsive.spec.ts) — cross-viewport smoke spec.

## Per-page audit

Status values:

- **Shell-only** — page content is a simple vertical stack; the responsive shell is sufficient.
- **Needs follow-up** — page has a non-trivial layout (multi-column grid, data table, absolute-positioned chrome) that warrants its own issue.
- **TBD** — not yet opened in a real mobile viewport.

| Route                       | Primary file                                                        | Status         | Notes                                                                                                   |
|-----------------------------|---------------------------------------------------------------------|----------------|---------------------------------------------------------------------------------------------------------|
| `/`                         | [app/page.tsx](../src/app/page.tsx)                                  | TBD            | Featured stems carousel already viewport-aware (4 tiers at 640/900/1200). Verify at 320px.              |
| `/player`                   | [app/player/page.tsx](../src/app/player/page.tsx)                    | TBD            | Player page + PlayerBar overlap — verify both visible or one is hidden on phone.                        |
| `/library`                  | [app/library/page.tsx](../src/app/library/page.tsx)                  | Needs follow-up | Library has a sticky playlist sidebar (`library-sidebar`) — doesn't collapse on phone.                  |
| `/create`                   | [app/create/page.tsx](../src/app/create/page.tsx)                    | Shell-only     | Already has `@media (max-width: 640px)` rules in [create.css](../src/styles/create.css).                |
| `/marketplace`              | [app/marketplace/page.tsx](../src/app/marketplace/page.tsx)          | Needs follow-up | Stem-pricing grid + filters bar — uses 900/600 breakpoints; modals (Buy, List, Resale) need audit.      |
| `/agent`                    | [app/agent/page.tsx](../src/app/agent/page.tsx)                      | Needs follow-up | Agent dashboard grid collapses at 900px — fine for tablet, but taste-card layout needs phone check.     |
| `/sonic-radar`              | [app/sonic-radar/page.tsx](../src/app/sonic-radar/page.tsx)          | TBD            | Existing `@media (max-width: 768px)` rules in globals — verify radar visualization scales.              |
| `/artist/[id]`              | [app/artist/[id]/page.tsx](../src/app/artist/[id]/page.tsx)          | TBD            | Profile page — verify banner/avatar behavior.                                                           |
| `/artist/upload`            | [app/artist/upload/page.tsx](../src/app/artist/upload/page.tsx)      | Needs follow-up | Upload flow is a core user path — multi-step form needs a targeted mobile pass.                         |
| `/artist/onboarding`        | [app/artist/onboarding/page.tsx](../src/app/artist/onboarding/page.tsx) | TBD         | Inline `@media (max-width: 600px)` already present — align with canonical breakpoints.                  |
| `/artist/analytics`         | [app/artist/analytics/page.tsx](../src/app/artist/analytics/page.tsx) | Needs follow-up | Charts + multi-col KPI cards — probably fine at tablet, need mobile strategy (swipeable charts?).       |
| `/release/[id]`             | [app/release/[id]/page.tsx](../src/app/release/[id]/page.tsx)        | Needs follow-up | Release detail has cover art + track list + rights panel — two-column layout to untangle.               |
| `/stem/[tokenId]`           | [app/stem/[tokenId]/page.tsx](../src/app/stem/[tokenId]/page.tsx)    | Needs follow-up | Stem detail with pricing sidebar; uses [stem-pricing.css](../src/styles/stem-pricing.css) grids.        |
| `/wallet`                   | [app/wallet/page.tsx](../src/app/wallet/page.tsx)                    | TBD            | USDC vault grid collapses at 860px — already close, verify.                                             |
| `/settings`                 | [app/settings/page.tsx](../src/app/settings/page.tsx)                | Shell-only     | Simple form layout.                                                                                     |
| `/disputes`                 | [app/disputes/page.tsx](../src/app/disputes/page.tsx)                | Needs follow-up | Dispute queue is table-heavy; mobile needs card-style rendering.                                        |
| `/disputes/leaderboard`     | [app/disputes/leaderboard/page.tsx](../src/app/disputes/leaderboard/page.tsx) | Needs follow-up | Leaderboard table.                                                                                      |
| `/disputes/admin`           | [app/disputes/admin/page.tsx](../src/app/disputes/admin/page.tsx)    | Needs follow-up | Admin review queue — same table-on-mobile problem.                                                      |
| `/collection`               | [app/collection/page.tsx](../src/app/collection/page.tsx)            | TBD            | Grid of owned stems.                                                                                    |
| `/import`                   | [app/import/page.tsx](../src/app/import/page.tsx)                    | TBD            | File-picker flow — verify drop zone behaves on touch.                                                   |
| `/curators/[address]`       | [app/curators/[address]/page.tsx](../src/app/curators/[address]/page.tsx) | TBD       | Curator profile + stats.                                                                                |

## Proposed follow-up issues

Each should reference #557 as parent and target an isolated page or
component.

1. **Library: responsive playlist sidebar** — the sticky `library-sidebar` needs to either stack above the track list on phone or become a sheet.
2. **Marketplace: mobile-friendly filters + modals** — BuyModal, ListStemModal, BatchMintListModal, ResaleModal all assume desktop-width; plus the filter bar needs to scroll horizontally or collapse into a filter sheet.
3. **Release detail: two-column to stacked layout** — reflow cover art + track list + rights panel for phone/tablet.
4. **Stem detail: pricing grid on phone** — `stem-pricing.css` grids need phone-tier behavior.
5. **Artist upload: multi-step form on phone** — end-to-end pass on the upload flow including drag-drop file input.
6. **Disputes: card-mode on phone** — three routes with tables (`/disputes`, `/disputes/leaderboard`, `/disputes/admin`) need mobile rendering.
7. **Agent dashboard: taste card phone layout** — agent taste + history layout below 768.
8. **Artist analytics: mobile chart strategy** — swipeable chart carousel vs. stacked.

## Out of scope for #557

- Lighthouse mobile perf regression budget (needs a CI harness beyond this PR).
- Visual regression tooling (Percy / Chromatic).
- Real-device manual QA checklist (separate QA ticket).
