# RFC: Geo Analytics Demand Dimension

Date: 2026-05-25
Status: Draft
Issue: [#972](https://github.com/akoita/resonate/issues/972)

## Summary

Resonate should model geography as coarse demand geography, not user location
tracking. The analytics event envelope can carry a small optional `geo`
dimension for country, region, or city-level demand when the producer has a
clear product reason, especially Shows campaign demand.

The goal is to answer aggregate product questions:

- Which cities have demand for an artist?
- Which countries are backing a campaign?
- Are pledges local to the target city or global supporters?
- Should a fan campaign be allowed if most demand is outside the proposed show
  region?

The goal is not to record raw IPs, GPS coordinates, or individual movement.

## Event Shape

```ts
geo: {
  countryCode: "FR",
  regionCode: "IDF",
  citySlug?: "paris",
  source: "user_declared" | "ip_coarse" | "campaign_target",
  precision: "country" | "region" | "city",
}
```

## Rules

- No raw IP in analytics events.
- No GPS or latitude/longitude by default.
- Prefer user-declared city/region for Shows demand.
- If IP-derived geo is ever used, resolve server-side to country/region and
  discard the IP before analytics ingestion.
- Store only coarse values in `analytics_facts.dimensions`.
- Treat city-level geo plus authenticated actor/session identifiers as
  retention/deletion governed analytics data.
- Reports should aggregate demand, such as "Paris demand: 183 fans", and never
  expose individual locations.

## Initial Implementation

- Backend analytics envelopes validate optional `geo`.
- Product/playback analytics requests can carry coarse `geo`.
- Product payload sanitization drops raw location-tracking keys such as IP,
  GPS, latitude, and longitude fields.
- Shows campaign creation and pledge events emit `shows.*` analytics with
  campaign-target geo, or user-declared geo when supplied on pledge intent.
- Warehouse export and Dataflow preserve coarse geo fields in clean rows and
  fact dimensions:
  - `geoCountryCode`
  - `geoRegionCode`
  - `geoCitySlug`
  - `geoSource`
  - `geoPrecision`

## Reporting Guidance

Listener-facing summaries may use a listener's own coarse declared geo and
anonymous comparison baselines. Artist-facing reports may use aggregate demand
counts by city/region/country only. Shows operator reports may compare pledge
geo with campaign target geo to flag local-vs-global demand.

City-level outputs should use aggregation thresholds before being shown outside
the user's own account or a privileged operator view.

## Open Questions

- Which UI surface should collect user-declared city/region?
- What minimum aggregation threshold should city-level artist reports enforce?
- Should campaign creation require country codes only, or support country names
  with an explicit normalization table?
- Which privacy review should approve any future `ip_coarse` resolver?
