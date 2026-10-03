---
title: "Discovery popularity and engagement"
status: partial
owner: "@akoita"
issue: 1450
---

# Discovery popularity and engagement

Trending Now and Top Artists use engagement snapshots, rather than release
recency. Online requests read `TrackPopularity` and `ArtistEngagement` in
Postgres, with a 120-second Redis cache; they never query BigQuery.

This is vision-neutral infrastructure and quality supporting ADR-BM-6 Line 4
Listener Pro and Line 3 marketplace. Scores never determine payouts, and no
fees or splits change.

## Snapshot contract

Dataform models in `workers/analytics-dataflow/dataform/definitions/discovery/`
produce `track_popularity` and `artist_engagement` for 24-hour, seven-day and
30-day windows, both overall and by genre. Scores combine completion-weighted
plays, saves weighted by two, and settled purchases weighted by five, with
linear decay and a 0.1 floor. Starts and completions do not count twice.
Distinct listener audiences are unioned across an artist's tracks.

The backend enriches eligible ledger events with authoritative catalog genre,
AI disclosure and credited-artist dimensions. Client-supplied eligibility flags
cannot certify an event. Missing actor, basis or eligibility metadata excludes
an event; fully AI-generated tracks and artist self-engagement cannot create
promotion. Optional play/save events require consent, while canonical settled
purchases use their contract basis. Legacy events need a governed backfill
before they qualify.

Both paths enforce `DISCOVERY_MIN_AUDIENCE` before snapshot storage and again
on reads. An empty qualifying audience keeps the existing low-data UI.
Dataform assertions cover identifiers, windows, nonnegative bounded scores,
audience floors and freshness. Rebuilds read bounded recent events; the
exporter reads only precomputed marts.

## Refresh and failure behavior

`DISCOVERY_POPULARITY_SOURCE=local` keeps the bounded local filler. Warehouse
mode disables that filler; an external schedule runs
`backend/src/scripts/refresh_discovery_popularity.ts` after a successful mart
rebuild. Table names, query byte bounds, row limits and deadlines come from
[environment configuration](../deployment/environment.md).

A truncated, invalid, incomplete, stale or over-limit warehouse response
preserves the previous serving snapshot. Each export validates a fresh sentinel
with matching row counts, so empty marts also require evidence of a successful
rebuild. Stored rows retain their warehouse computation time; online reads and
caches suppress rows older than the configured snapshot age (120 minutes by
default). Valid complete exports replace both tables
atomically, then rotate a shared Redis cache generation across all genres,
windows, limits and backend instances. The cache generation is captured before
a database read, so a read racing replacement cannot populate the new generation
with stale rows.

Consent withdrawals and account deletion must reconcile source warehouse
records, rebuild derived marts and refresh serving snapshots. Export does not
independently erase warehouse history. Operational reconciliation and rollout
are tracked privately in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263).

## Verification and delivery status

Focused backend tests cover scoring, export pagination/deadlines, transactional
replacement, audience suppression, authoritative metadata and cache generation.
Full local Dataform compilation validates the combined action graph and
generated SQL. Existing Agent Taste templates use inline configuration helpers
so their configuration blocks compile in the same graph. Application
materialization and export are merged in
[PR #2045](https://github.com/akoita/resonate/pull/2045).
Warehouse execution, dry-run byte evidence, scheduling and live checks remain
tracked privately in [resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263);
staging acceptance remains open in
[resonate-iac#264](https://github.com/akoita/resonate-iac/issues/264). This feature
remains `partial` until those checks are complete.

## Related documents

- [Discovery Intelligence RFC](../rfc/discovery-intelligence.md)
- [Analytics event ledger](analytics_event_ledger.md)
- [Analytics consent and retention](analytics_consent_retention_policy.md)
