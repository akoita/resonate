---
title: "Artist Analytics Dashboard"
status: implemented
owner: "@akoita"
issue: 25
---

# Artist Analytics Dashboard

## Goal

Provide a premium, high-fidelity visual dashboard for Resonate artists to track audio play metrics, stablecoin settlement earnings, top-performing tracks, play sources, and Content Protection staking/escrow history.

The dashboard follows the **Obsidian Frequency (v2)** design system guidelines, reserving **Electric Violet** for AI-agent autonomous context and leveraging **Hyacinth Blue** for standard human-initiated metrics.

---

## Audience & Value

- **For Artists**: Provides clear visual tracking of plays over time, real-time USDC payout rollups, content protection route decision counts (Marketplace Ready vs Restricted/Blocked), and detailed EVM staking escrow histories (Coup De Goule, Ah W Nass, etc.).
- **For Developers**: Demonstrates how to map versioned analytics facts from the BigQuery/Postgres ledger directly to standard React UI layers using performant, responsive SVG charting without heavy external chart libraries.

---

## How to Use

### As an End User
1. Log in to the Resonate portal and connect your EVM smart wallet.
2. Click **Analytics** in the left sidebar menu to navigate to `/artist/analytics`.
3. Toggle date ranges between **7d**, **30d**, and **90d** using the pill controls at the top right.
4. Hover over the **Plays over time** spline chart to reveal active tooltips showing daily metrics.
5. Review the **Sources breakdown progress bars** and the **Track Performance table**.
6. Monitor active escrow allocations under the **Content Protection Staking & escrow overview**.

### As a Developer
The frontend page [page.tsx](../../web/src/app/artist/analytics/page.tsx) automatically reads the authenticated wallet address and JWT token, queries [api.ts](../../web/src/lib/api.ts), and executes:
- `GET /analytics/artist/:id/v1?days=N` — returns the plays/payout fact aggregates grouped by tracks, sessions, and sources.
- `GET /api/metadata/stakes/analytics/:address` — fetches EVM smart contract staking counts, active/refunded stakes, and historical deposits.

The backend derives the KPI totals, track-performance rows, source breakdown,
and plays-over-time chart from the same bounded `analytics_facts` slice. Daily
`analytics_views` remain available for warehouse consumers, but the artist
dashboard does not prefer them over facts so partial current-day windows cannot
drift from the rest of the report.

---

## Technical Reference

### UI Routes & Entry Points
- Page Component: `/artist/analytics` -> `web/src/app/artist/analytics/page.tsx`
- Layout Wrapper: `web/src/app/artist/analytics/layout.tsx`
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
