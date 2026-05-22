---
title: "Phase 0: Data Model & Storage Plan"
status: draft
owner: "@akoita"
---

# Phase 0: Data Model & Storage Plan

## Objectives

- Draft OLTP schema for core entities.
- Define analytics schema for event logging.
- Document storage layout for audio assets.

## OLTP (PostgreSQL) Draft

Tables:

- `users`: id, email, created_at
- `wallets`: id, user_id, address, chain_id, balance
- `artists`: id, user_id, display_name, payout_address
- `tracks`: id, artist_id, title, status, created_at
- `stems`: id, track_id, type, uri, ipnft_id, checksum
- `sessions`: id, user_id, budget_cap, spent, started_at, ended_at
- `licenses`: id, session_id, track_id, type, price, duration
- `payments`: id, session_id, tx_hash, amount, status

Relationships:

- `users` 1:1 `wallets`
- `artists` 1:many `tracks`
- `tracks` 1:many `stems`
- `sessions` 1:many `licenses`
- `sessions` 1:many `payments`

## Analytics (BigQuery) Draft

Datasets:

- `events_raw`: append-only event envelopes with schema evolution.
- `events_clean`: validated, normalized events.
- `analytics_facts`: long-lived pseudonymous commerce, playback, rights,
  catalog, agent, and generation facts.
- `analytics_views`: daily aggregates, funnel views, payout reports, exports,
  audit/reporting tables, API-ready tables, and dashboard-ready tables.
- `analytics_quarantine`: invalid envelopes and unsupported event families held
  for schema fixes or replay instead of silently dropped.

Core event fields:

- event_id, event_name, event_version, occurred_at, received_at, producer
- privacy_tier, consent_basis, environment, schema_uri
- actor_id, track_id, stem_id, session_id
- amount, currency, tx_hash
- source_refs for transaction hashes, job ids, object URIs, or source row ids

See [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md) for
the canonical event envelope and retention model.

Current backend implementation persists the raw envelope locally in Postgres via
the `AnalyticsEvent` table. Warehouse export to the raw/clean/fact/view and
quarantine layers is exposed by `AnalyticsWarehouseExportService`. Operational
loading/backfill is exposed by `AnalyticsWarehouseLoaderService`; the first
durable target is `ANALYTICS_WAREHOUSE_TARGET=local_json`, which writes
idempotent JSONL files outside process memory and can be scoped by date or event
family. Deployed environments can set
`ANALYTICS_WAREHOUSE_TARGET=bigquery_insert_all` to stream the same generated
layers into the configured BigQuery dataset through Google ADC. The target
near-real-time path now has an Apache Beam/Dataflow processor artifact under
`workers/analytics-dataflow/`; it consumes the Terraform-managed analytics
Pub/Sub subscription and writes the same raw, clean, fact, view, and quarantine
BigQuery layers as a Flex Template.
The current artist analytics endpoints build their report responses from the
generated fact/view layers, using fact dimensions for legacy response fields.
When `ANALYTICS_REPORT_SOURCE=bigquery`, those endpoints read BigQuery
`analytics_facts` and `analytics_views` directly with artist/time-window
filters, freshness metadata, a maximum-bytes-billed guard, and short TTL
caching.
Deletion, redaction, consent withdrawal, and retention cleanup lineage is
recorded in `AnalyticsGovernanceLog`.

## Storage Layout (GCS/IPFS)

GCS buckets:

- `resonate-raw-uploads/artist_id/track_id/`
- `resonate-stems/artist_id/track_id/stem_type/`
- `resonate-remixes/user_id/session_id/`

IPFS:

- Store finalized stems and remixes with content-addressable URIs.
- Pinning policy for MVP: 30 days by default.

## Retention & Compliance

- Raw uploads retained for 90 days.
- Derived stems retained for 12 months.
- Personal raw analytics events retained for short operational windows by
  default.
- Pseudonymous analytics events retained for multi-year replay/backfill.
- Financial and audit facts retained 7-10 years where needed for accounting,
  royalty, settlement, and dispute history.
- Anonymous aggregates can be retained indefinitely while commercially useful.

## Open Questions

- Do we need soft-delete vs. hard-delete for user data?
- Minimum retention required for payout audits?
