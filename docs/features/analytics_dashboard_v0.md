---
title: "Phase 1: Analytics Dashboard v0"
status: draft
owner: "@akoita"
issue: 25
---

# Phase 1: Analytics Dashboard v0

## Goal

Deliver a minimal analytics view for artists (plays and payouts).

This feature is one current dashboard/reporting surface. It should not define
what data Resonate captures for analytics overall. The broader long-term event
capture strategy for future reports, exports, audits, agent datasets, and
dashboards lives in
[Analytics Event Ledger](analytics_event_ledger.md) and the
[Long-Term Analytics Event Ledger RFC](../rfc/analytics-event-ledger.md).

## Current Backend Path

The artist analytics endpoints now read from normalized analytics layers. Local
development and tests use the existing `AnalyticsWarehouseExportService`
fallback; deployed environments can set `ANALYTICS_REPORT_SOURCE=bigquery` so
the same endpoints read artist-scoped `analytics_facts` and `analytics_views`
rows from BigQuery:

- `GET /analytics/artist/:id`
- `GET /analytics/artist/:id/v1`

Both endpoints require JWT auth. Artist users can read only their own artist
metrics; admins can read any artist. Responses include `meta.timeWindow`,
`meta.freshness`, `meta.source`, cache information, and `meta.isEmpty` so an
empty dashboard is explicit no-data rather than placeholder numbers.

The service consumes `analytics_facts` for play and payout report totals,
`analytics_views` for plays-over-time rows when available, and fact dimensions
for compatibility fields such as track title, session, source, and payout asset
metadata. BigQuery reads are bounded by artist id and explicit time windows,
use named query parameters, have a configurable maximum-bytes-billed guard, and
are cached briefly in-process to avoid repeated identical dashboard queries.

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
- Durable event ledger facts/views for current backend reads; production
  BigQuery reporting mode requires Google ADC and the `ANALYTICS_REPORT_SOURCE`
  / `ANALYTICS_BIGQUERY_*` backend environment variables.
