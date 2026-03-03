---
title: "Phase 1: Analytics Dashboard v0"
status: draft
owner: "@akoita"
issue: 25
---

# Phase 1: Analytics Dashboard v0

## Goal

Deliver a minimal analytics view for artists (plays and payouts).

## Actions

1. **Aggregation job**
   - Daily rollup of plays and payout totals.
   - Store in analytics view table.
2. **API endpoint**
   - `GET /analytics/artist/:id` with date range.
   - Return totals and per-track breakdown.
3. **UI stub**
   - Simple table of plays + payouts.
   - CSV export optional.

## MVP Acceptance Criteria

- Artists can view totals for last 7/30 days.
- Per-track breakdown visible.
- Data updates daily.

## Dependencies

- Analytics pipeline (Pub/Sub → BigQuery).
- Catalog metadata for display names.
