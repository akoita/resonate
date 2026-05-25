---
title: "Analytics Pipeline Observability"
status: partial
owner: "@akoita"
issue: 962
---

# Analytics Pipeline Observability

## Status

`partial`

Resonate now exposes an admin analytics pipeline health report and emits
structured warning logs when product analytics payloads are rejected at
`POST /analytics/product/event`. Pub/Sub publish successes/failures already
emit structured logs from the analytics publisher, and warehouse loads expose
inserted/skipped/quarantined row metrics.

This is enough to catch obvious data loss during staging and early production.
Managed alerting dashboards, BigQuery scheduled checks, and SLO ownership still
need to be wired in infrastructure.

## Who It Is For

- Operators watching for analytics pipeline loss before reports drift.
- Developers adding event producers, Dataflow transforms, or BigQuery marts.
- Product and artist analytics owners who need confidence that historical
  facts are complete enough for future reports.

## Value

Analytics is only useful if missing data is visible. The observability surface
turns hidden failure modes into actionable signals:

- rejected product event payloads by reason and event name;
- Pub/Sub publishing success/failure and strict/non-strict behavior;
- quarantine row growth by reason and event name;
- missing `actorId`, `sessionId`, `trackId`, `artistId`, or `releaseId` where
  the event family expects them;
- clean-to-fact coverage;
- stale warehouse/reporting freshness.

## How To Use Today

- `GET /admin/analytics/pipeline/health` returns the current health report.
  It requires an admin JWT.
- `POST /admin/analytics/warehouse/load` and
  `POST /admin/analytics/warehouse/backfill` continue to return load metrics,
  including quarantined and schema-incompatible rows.
- Search structured logs for:
  - `analytics_product_event_rejected`
  - `analytics_event_published`
  - `analytics_event_publish_failed`
- Add scheduled BigQuery checks for the same signals when managed warehouse
  alerting is available.

Example admin health fields:

| Field | Meaning |
| --- | --- |
| `status` | `ok`, `warning`, or `critical` based on freshness, quarantine, identifier gaps, and clean-to-fact coverage. |
| `freshness` | Latest clean/fact timestamp, lag seconds, and warning/critical thresholds. |
| `quarantine.byReason` | Quarantine counts grouped by reason and event name. |
| `identifierGaps.byReason` | Missing identifier counts grouped by reason and event name. |
| `facts.cleanToFactRate` | Ratio of clean events with generated fact rows. |
| `productIngestion.rejectedPayloadLogEvent` | Structured log event name for rejected product analytics payloads. |
| `pubSub` | Whether analytics publishing is enabled, strict, and has topic/project config. |
| `recommendations` | Human-readable next checks for operators. |

## Implementation Notes

- The health report is built by
  `backend/src/modules/analytics/analytics_observability.service.ts` from the
  canonical warehouse export layers.
- Product analytics rejection logs intentionally omit payload content. They
  include reason, event name, and endpoint only.
- Pub/Sub publish failures remain non-blocking unless
  `ANALYTICS_EVENT_PUBLISHING_STRICT=true`.
- A `critical` health status means reports can be materially wrong until the
  pipeline is repaired or backfilled.

## Verification

- Health report scoring is covered by
  `backend/src/tests/analytics_observability.spec.ts`.
- Product event rejection behavior remains covered by
  `backend/src/tests/analytics.controller.http.spec.ts`.
- Pub/Sub publishing success/failure behavior is covered by
  `backend/src/tests/analytics_event_publisher.spec.ts`.
- Warehouse load quarantine metrics are covered by
  `backend/src/tests/analytics_warehouse_loader.spec.ts`.
