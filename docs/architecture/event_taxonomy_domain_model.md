---
title: "Phase 0: Event Taxonomy & Domain Model"
status: draft
owner: "@akoita"
---

# Phase 0: Event Taxonomy & Domain Model

## Objectives

- Define core domain entities and their relationships.
- Establish event names, payloads, and ownership.
- Set a versioning strategy for event evolution.

## Core Domain Entities

| Entity | Description | Key Fields |
| --- | --- | --- |
| User | Registered account with agent wallet | id, email, wallet_id, roles |
| Wallet | Account abstraction wallet | id, address, chain_id, balance |
| Artist | Creator profile | id, user_id, display_name, payout_address |
| Track | Song metadata container | id, artist_id, title, status |
| Stem | Audio stem asset | id, track_id, type, uri, ipnft_id |
| Remix | Derived composition | id, base_track_id, stem_ids, creator_id |
| Session | Listening session | id, user_id, budget_cap, spent |
| License | Rights grant | id, type, price, duration, session_id |
| Payment | On-chain settlement | id, tx_hash, amount, status |

## Event Taxonomy

All analytics events are emitted with a stable envelope that includes
`event_id`, `event_name`, `event_version`, `occurred_at`, `received_at`,
`producer`, `privacy_tier`, and schema metadata. See
[Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md) for the
canonical envelope, retention tiers, and warehouse layers.

### Ingestion & Catalog

- `stems.uploaded`
  - owner: Ingestion Service
  - payload: track_id, artist_id, file_uris, checksum
- `stems.processed`
  - owner: Ingestion Service
  - payload: track_id, stem_ids, model_version, duration_ms
- `ipnft.minted`
  - owner: Catalog Service
  - payload: stem_id, token_id, chain_id, tx_hash
- `catalog.updated`
  - owner: Catalog Service
  - payload: track_id, status, version

### Session & Licensing

- `session.started`
  - owner: Session Service
  - payload: session_id, user_id, budget_cap, preferences
- `license.granted`
  - owner: Rights Service
  - payload: license_id, type, price, session_id, track_id
- `session.ended`
  - owner: Session Service
  - payload: session_id, spent_total, reason

### Payments & Analytics

- `payment.initiated`
  - owner: Payments Service
  - payload: payment_id, amount, session_id, chain_id
- `payment.settled`
  - owner: Payments Service
  - payload: payment_id, tx_hash, status
- `analytics.ingested`
  - owner: Analytics Pipeline
  - payload: event_name, event_id, processed_at

### Playback & Engagement

- `playback.started`
  - owner: Playback Service
  - payload: track_id, artist_id, session_id, source, listener_cohort_id
- `playback.completed`
  - owner: Playback Service
  - payload: track_id, artist_id, session_id, completion_ratio, duration_ms
- `library.saved`
  - owner: Library Service
  - payload: user_cohort_id, track_id, release_id, source

### Commerce & Settlement

- `commerce.settled`
  - owner: Payments Service
  - payload: payment_id, artist_id, track_id, canonical_amount_usd, settlement_asset, tx_hash

### Rights, Agents, And Experiments

- `rights.route_decided`
  - owner: Rights Service
  - payload: release_id, artist_id, route, evidence_types, decision_reason
- `agent.recommendation_selected`
  - owner: Agent Runtime
  - payload: agent_id, session_id, track_id, strategy, candidate_count
- `generation.created`
  - owner: Generation Service
  - payload: generation_id, user_id, track_id, artist_id, model, prompt_policy
- `experiment.exposed`
  - owner: Experiment Service
  - payload: experiment_key, variant_key, subject_cohort_id, surface

## Versioning Strategy

- Use `event_version` as a semantic integer (v1, v2...).
- Backward-compatible changes only within the same version.
- Breaking changes require a new version and parallel support.

## Open Questions

- Which events must be published to external partners?
- Do we need PII redaction at event source or sink?
- Which event families should become public partner/export contracts first?
