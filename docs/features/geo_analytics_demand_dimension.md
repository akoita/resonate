---
title: "Geo Analytics Demand Dimension"
status: partial
owner: "@akoita"
issue: 972
---

# Geo Analytics Demand Dimension

## Status

`partial`

Coarse geography is now supported as a governed analytics event dimension.
Backend event validation, product/playback ingestion, Shows campaign analytics,
warehouse export, and Dataflow transforms can preserve country/region/city
slug fields without accepting raw IP, GPS, latitude, or longitude values.

Product reports and UI surfaces that collect user-declared city/region remain
future work.

## Who It Is For

- Shows operators evaluating city-level artist demand.
- Artists reading aggregate city/country demand.
- Product and growth teams studying regional demand without tracking users.
- Developers instrumenting analytics events with coarse geography.

## Value

Geo demand lets Resonate answer where interest is forming while keeping
analytics privacy-safe. For Shows, the platform can compare campaign target
geo with pledge/supporter geo and understand whether a proposed city campaign
has local support or mostly remote enthusiasm.

## How To Use Today

Analytics producers may attach:

```ts
geo: {
  countryCode: "FR",
  regionCode: "IDF",
  citySlug: "paris",
  source: "user_declared",
  precision: "city",
}
```

Rules:

- `countryCode` must be an uppercase ISO-3166 alpha-2 code.
- `regionCode` is optional and uppercase.
- `citySlug` is optional except for city precision.
- `source` must be `user_declared`, `ip_coarse`, or `campaign_target`.
- `precision` must be `country`, `region`, or `city`.
- Never put raw IP, GPS, latitude, or longitude values in analytics payloads.

Current event surfaces:

- `POST /analytics/product/event`
- `POST /analytics/playback/completed`
- `POST /analytics/playback/event`
- Shows campaign creation and pledge flows through `shows.*` analytics events

Warehouse/Dataflow dimensions:

- `geoCountryCode`
- `geoRegionCode`
- `geoCitySlug`
- `geoSource`
- `geoPrecision`

## Privacy

Geo analytics is demand geography, not user location tracking. City-level geo
combined with authenticated actor/session identifiers is governed analytics
data and must follow retention, export, and deletion behavior in the analytics
consent and retention policy.

Reports should aggregate demand before showing geo outside the user's own
account or privileged operator views.

## Verification

- Envelope validation is covered by
  `backend/src/tests/analytics_event.spec.ts`.
- Product/playback ingestion shaping is covered by
  `backend/src/tests/analytics.controller.http.spec.ts`.
- Producer support is covered by
  `backend/src/tests/analytics_instrumentation.spec.ts`.
- Warehouse preservation is covered by
  `backend/src/tests/analytics_warehouse.spec.ts`.
- Dataflow preservation and quarantine behavior are covered by
  `workers/analytics-dataflow/test_analytics_transform.py`.

## References

- [Geo Analytics Demand Dimension RFC](../rfc/geo-analytics-demand-dimension.md)
- [Analytics Event Ledger](analytics_event_ledger.md)
- [Resonate Shows](resonate_shows.md)
