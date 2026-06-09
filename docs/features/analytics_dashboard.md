---
title: "Analytics Dashboards"
status: partial
owner: "@akoita"
issues: [25, 982, 1121]
---

# Analytics Dashboards

## Goal

Provide high-fidelity visual dashboards for Resonate artists and operators to
track catalog performance, settlement earnings, content-protection history, and
AI DJ recommendation quality.

The dashboard follows the **Obsidian Frequency (v2)** design system guidelines, reserving **Electric Violet** for AI-agent autonomous context and leveraging **Hyacinth Blue** for standard human-initiated metrics.

---

## Audience & Value

- **For Artists**: Provides clear visual tracking of plays over time, real-time USDC payout rollups, content protection route decision counts (Marketplace Ready vs Restricted/Blocked), first-slice recommended action cards, and detailed EVM staking escrow histories (Coup De Goule, Ah W Nass, etc.).
- **For Operators/Product Owners**: Provides aggregate AI DJ recommendation quality metrics so analytics-powered taste changes can be monitored before model promotion.
- **For Developers**: Demonstrates how to map versioned analytics facts from the BigQuery/Postgres ledger directly to standard React UI layers using performant, responsive SVG charting without heavy external chart libraries.

---

## How to Use

### As an End User
1. Log in to the Resonate portal and connect your EVM smart wallet.
2. Click **Analytics** in the left sidebar menu to navigate to `/artist/analytics`.
3. Toggle date ranges between **7d**, **30d**, and **90d** using the pill controls at the top right.
4. Hover over the **Plays over time** spline chart to reveal active tooltips showing daily metrics.
5. Review the **Sources breakdown progress bars** and the **Track Performance table**.
6. Use the **Action Cockpit** cards to open the player, marketplace management,
   artist community tab, or catalog review flow when aggregate signals support
   an action.
7. Monitor active escrow allocations under the **Content Protection Staking & escrow overview**.
8. Operators can open `/analytics/agent-quality` to review aggregate AI DJ
   acceptance, first-pick skip, session duration, save, playlist-add, purchase,
   strategy, taste-source, and model/materialization-version metrics.

### As a Developer
The frontend page [page.tsx](../../web/src/app/artist/analytics/page.tsx) automatically reads the authenticated wallet address and JWT token, queries [api.ts](../../web/src/lib/api.ts), and executes:
- `GET /analytics/artist/:id/v1?days=N` — returns the plays/payout fact aggregates grouped by tracks, sessions, and sources.
- `GET /analytics/agent/quality?days=N` — returns aggregate AI DJ quality
  metrics for `admin` and `operator` roles only.
- `GET /api/metadata/stakes/analytics/:address` — fetches EVM smart contract staking counts, active/refunded stakes, and historical deposits.

The backend derives the KPI totals, track-performance rows, source breakdown,
and plays-over-time chart from the same bounded `analytics_facts` slice. Daily
`analytics_views` remain available for warehouse consumers, but the artist
dashboard does not prefer them over facts so partial current-day windows cannot
drift from the rest of the report.

The same `GET /analytics/artist/:id/v1?days=N` response now includes an
`actions` array with stable artist action cards:

- `promote_top_track` opens `/player?trackId=<track-id>` when a top track has at
  least five aggregate plays in the selected window.
- `review_marketplace_readiness` opens `/marketplace/manage` when content
  protection data shows marketplace-ready releases.
- `start_listener_community` opens `/artist/:id?tab=community` when aggregate
  playback demand reaches the five-signal floor.
- `prepare_marketplace_catalog` points artists to `/artist/catalog` when no
  marketplace-ready release is visible in the current analytics slice.
- `review_show_city_demand` opens `/shows/:campaignIdOrSlug` when aggregate
  city-demand joins for a Shows campaign meet the five-signal floor.
- `post_campaign_update` opens `/shows/:campaignIdOrSlug` when aggregate
  supporter update views meet the five-signal floor.
- `create_holder_benefit` opens `/artist/:id?tab=community` when aggregate
  holder-room joins meet the five-signal floor and the selected analytics
  window has no holder-benefit rule creation signal.
- `invite_holder_collectors` opens `/artist/:id?tab=community` when aggregate
  holder-room joins meet the five-signal floor.
- `reward_early_supporters` opens `/artist/:id?tab=community` when aggregate
  supporter role grants, or fallback supporter-room joins, meet the five-signal
  floor.
- `prepare_remix_challenge` appears disabled when aggregate remix creation
  activity exists but Remix Studio challenge creation is still planned.
- `relist_expired_inventory` opens `/marketplace/manage?status=expired` when
  owner-visible marketplace inventory reports expired or cancelled listings
  that can use the existing relist workflow.
- `improve_marketplace_conversion` opens
  `/marketplace/manage?status=active` when aggregate marketplace purchase
  intent meets the five-signal floor but no settled commerce is visible in the
  selected window.
- `review_marketplace_pricing` opens `/marketplace/manage?status=active` when
  attributed aggregate marketplace purchase intent reaches the five-signal
  floor and settled commerce is visible in the selected window.

Each card includes `id`, `type`, `title`, `description`, `reason`, `priority`,
`confidence`, `sourceSignal`, `cta`, and `privacy`. Listener-derived cards use
aggregate counts only and apply a minimum signal threshold before surfacing
counts. Shows, holder-room, remix, and purchase-intent cards follow the same
aggregate floor before counts are surfaced. Marketplace owner-inventory cards
use artist-owned seller workspace summaries and do not expose seller wallet
addresses in the artist analytics DTO. The DTO does not include listener
identities, wallet addresses, raw play history, cohort membership, private room
membership, or per-listener drilldowns.

Action cockpit product analytics are emitted through `POST /analytics/product/event`:

- `artist.action_card_impression`
- `artist.action_card_clicked`
- `marketplace.owner_inventory_viewed`

The payload is intentionally compact: `cardId`, `cardType`, `priority`,
`sourceCategory`, and `disabled` for action-card events; artist-scoped listing
inventory events contain counts such as `activeCount`, `expiredCount`,
`expiringSoonCount`, `relistableCount`, and `totalListings`.

Artist dashboard authorization and default rollups remain manager/owner scoped
through the compatibility `artistId` dimension. Catalog metadata enrichment now
also preserves credited public-artist dimensions for future claim/grant-aware
artist analytics, but those credited dimensions are not yet the dashboard access
boundary.

The AI DJ quality dashboard derives aggregate metrics from bounded
`analytics_facts` windows. It includes only event-level rollups and segment
breakdowns by Session Intent, recommendation strategy, taste-signal source, and
model/materialization version. It explicitly excludes raw listener histories,
actor ids, wallet addresses, and per-user drilldowns.

---

## Technical Reference

### UI Routes & Entry Points
- Page Component: `/artist/analytics` -> `web/src/app/artist/analytics/page.tsx`
- Artist Action Cockpit:
  `web/src/components/analytics/ArtistAnalyticsDashboard.tsx`
- AI DJ Quality Page: `/analytics/agent-quality` ->
  `web/src/app/analytics/agent-quality/page.tsx`
- Layout Wrapper: `web/src/app/artist/analytics/layout.tsx`
- AI DJ Quality Component:
  `web/src/components/analytics/AgentQualityDashboard.tsx`
- Staking Widget: `web/src/components/analytics/StakingOverview.tsx`

### Styling Tokens Applied
- Background surface low: `var(--r-surface-low)` (#11101E)
- Canvas background: `var(--r-canvas)` (#08080F)
- Glowing overlays: `.premium-kpi-card:hover` utilizing `var(--r-primary-glow)` and `var(--r-secondary-glow)`
- Monospace tabular font: `var(--font-mono)` (JetBrains Mono)
- Date pill toggle controllers: `.date-selector-pill-row`

### Unit Tests
- Verification Suite: `web/tests/` (Vitest)
- Command: `npm --prefix web run test:unit`
- Artist action cockpit frontend check:
  `cd web && npx vitest run src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- Focused frontend check:
  `cd web && npx vitest run src/components/analytics/AgentQualityDashboard.test.tsx`
- Focused backend check:
  `cd backend && npx jest --runInBand src/tests/analytics.spec.ts src/tests/analytics.controller.http.spec.ts`

## Remaining P7 Work

Issue [#1121](https://github.com/akoita/resonate/issues/1121) remains the
tracking source for broader artist action recommendations. The deterministic
holder-benefit creation card is implemented as a deep link into the existing
artist community benefit-rule manager; it does not auto-create benefits or
inspect private holder proofs. The deterministic early-supporter reward card is
implemented as a deep link into the same manual benefit-rule/community surface;
it does not auto-send rewards, messages, payouts, or benefits. Deferred slices
now focus on full Remix Studio challenge/contributor workflows, deeper pricing
optimization beyond intent-without-settlement and checkout-intent review,
fan-question triage, and reviewed agent draft actions. Those should keep the
same privacy boundary: artist-owned data or aggregate-only listener/community
signals with explicit thresholds.
