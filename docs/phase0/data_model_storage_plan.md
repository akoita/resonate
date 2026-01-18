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

- `events_raw`: raw Pub/Sub events with schema evolution.
- `events_clean`: validated, normalized events.
- `analytics_views`: daily aggregates and payout reports.

Core event fields:

- event_name, event_version, occurred_at, producer
- actor_id, track_id, stem_id, session_id
- amount, currency, tx_hash

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
- Event logs retained for 24 months.

## Open Questions

- Do we need soft-delete vs. hard-delete for user data?
- Minimum retention required for payout audits?
