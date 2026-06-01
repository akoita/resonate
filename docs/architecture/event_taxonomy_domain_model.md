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

The canonical implementation taxonomy is now
[Analytics Event Taxonomy v1](analytics_event_taxonomy_v1.md). This page is a
Phase 0 domain-model companion and should not be treated as the full
production event contract.

All analytics events are emitted with a stable envelope that includes
`event_id`, `event_name`, `event_version`, `occurred_at`, `received_at`,
`producer`, `privacy_tier`, and schema metadata. See
[Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md) for the
canonical envelope, retention tiers, and warehouse layers.

The warehouse accepts the product/domain family as the analytics family when the
family has a clear owner. Bridges should preserve the original domain
`eventName` and carry any alternate or source-specific name in `payload` or
`sourceRefs`; this keeps replay/debugging simple and avoids silently changing
event meaning.

### Canonical Domain-To-Analytics Family Mapping

| Domain event family | Analytics family | Notes |
| --- | --- | --- |
| `identity.*` | `identity.*` | Signup, auth, role, account, and profile identity events. |
| `wallet.*` | `wallet.*` | Budget, funding, spend, session-key, and account-abstraction wallet events. |
| `catalog.*` | `catalog.*` | Release/track metadata, publish state, and catalog visibility. |
| `stems.*` | `stems.*` | Upload, processing, progress, failure, and separation completion. |
| `ipnft.*` | `ipnft.*` | Tokenization/provenance events tied to catalog assets. |
| `session.*` | `session.*` | Listening or agent commerce session lifecycle. |
| `playback.*` | `playback.*` | Player starts, completions, skips, and listen-quality signals. |
| `library.*` | `library.*` | Saves, follows, playlists, and listener library actions. |
| `community.*` | `community.*` | Profile visibility, holder benefits, artist rooms, access checks, message/report/moderation actions. |
| `commerce.*` | `commerce.*` | Quotes, purchase intent, settlement, refunds, and product commerce. |
| `payment.*` | `payment.*` | Payment initiation, split, settlement, and accounting rails. |
| `contract.*` | `contract.*` | Contract/indexer events such as stem sales and royalty payment observations. |
| `x402.*` | `x402.*` | x402 challenge, verification, replay, and settlement events. |
| `license.*` | `license.*` | License grants and license lifecycle events. |
| `rights.*` | `rights.*` | Rights routing, evidence, dispute, and moderation decisions. |
| `release_rights.*` | `release_rights.*` | Release-scoped rights request/update workflow events. |
| `agent.*` | `agent.*` | Agent runtime decisions, selections, evaluations, and purchases. |
| `recommendation.*` | `recommendation.*` | Recommendation generation and preference updates outside the agent runtime. |
| `curator.*` | `curator.*` | Curator stake, report, review, and reputation events. |
| `remix.*` | `remix.*` | Remix creation, eligibility, minting, and lineage events. |
| `marketplace.*` | `marketplace.*` | Listing lifecycle and storefront marketplace events. |
| `shows.*` | `shows.*` | Show demand signals, campaign lifecycle, pledge intent, pledge confirmation, and city demand events. |
| `generation.*` | `generation.*` | AI generation, prompt, publish, and failure events. |
| `notification.*` | `notification.*` | Notification creation, preference, delivery, and status events. |
| `realtime.*` | `realtime.*` | Realtime music/session transport status and user-control events. |
| `experiment.*` | `experiment.*` | Assignment, exposure, and conversion tracking. |
| `system.*` | `system.*` | Jobs, imports/exports, health, and pipeline lifecycle events. |

### Coarse Geo Demand Dimension

Analytics events may include an optional top-level `geo` dimension for coarse
demand reporting:

```json
{
  "countryCode": "FR",
  "regionCode": "IDF",
  "citySlug": "paris",
  "source": "user_declared",
  "precision": "city"
}
```

The dimension is intentionally not raw location tracking. Producers must not
send raw IP addresses, GPS coordinates, latitude/longitude, or street-level
values in analytics events. IP-derived geography, when enabled, must be
resolved server-side to country or region and the IP must be discarded before
analytics ingestion. City-level values paired with an authenticated actor or
session are privacy-sensitive and must be governed by retention and deletion
rules. Warehouse facts store only the coarse values in
`analytics_facts.dimensions` as `geoCountryCode`, `geoRegionCode`,
`geoCitySlug`, `geoSource`, and `geoPrecision`.

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
- `catalog.release_ready`
  - owner: Catalog Service
  - payload: release_id, artist_id, track_ids, source

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
- `contract.stem_sold`
  - owner: Contracts/Indexer Service
  - payload: stem_id, track_id, token_id, buyer, amount, tx_hash
- `wallet.funded`
  - owner: Wallet Service
  - payload: wallet_id, user_id, chain_id, asset_id, amount
- `x402.payment_settled`
  - owner: x402 Service
  - payload: stem_id, payment_id, facilitator, amount, asset
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

### Shows Demand

- `shows.signal_created`
  - owner: Shows Service
  - payload: campaignId, artistId, campaignLevel, campaignCountryCode, campaignCitySlug
- `shows.campaign_created`
  - owner: Shows Service
  - payload: campaignId, artistId, campaignLevel, artistAuthorityStatus, campaignCountryCode, campaignCitySlug
- `shows.campaign_visuals_updated`
  - owner: Shows Service
  - payload: campaignId, artistId, visualAction, visualSlots, galleryVisualCount, campaignCountryCode, campaignCitySlug
  - note: records which promotional visual slots changed and whether the edit
    was an upload, replace, delete, or reorder action; raw image URLs, storage
    paths, captions, credits, and bytes stay out of the analytics event payload.
- `shows.pledge_intent_created`
  - owner: Shows Service
  - payload: campaignId, pledgeId, artistId, amountUnits, paymentAssetSymbol, tierId
- `shows.pledge_confirmed`
  - owner: Shows Service
  - payload: campaignId, pledgeId, artistId, amountUnits, paymentAssetSymbol, confirmationStatus

### Commerce & Settlement

- `commerce.settled`
  - owner: Payments Service
  - payload: payment_id, artist_id, track_id, canonical_amount_usd, settlement_asset, tx_hash

### Rights, Agents, And Experiments

- `rights.route_decided`
  - owner: Rights Service
  - payload: release_id, artist_id, route, evidence_types, decision_reason
- `release_rights.request_updated`
  - owner: Rights Service
  - payload: release_id, request_id, status, reviewer_id
- `agent.recommendation_selected`
  - owner: Agent Runtime
  - payload: agent_id, session_id, track_id, strategy, candidate_count
- `agent.decision_made`
  - owner: Agent Runtime
  - payload: agent_id, session_id, track_id, decision, reason
- `recommendation.generated`
  - owner: Recommendations Service
  - payload: user_cohort_id, track_ids, strategy, candidate_count
- `curator.staked`
  - owner: Curation Service
  - payload: curator_id, amount_usd
- `remix.created`
  - owner: Remix Service
  - payload: remix_id, creator_id, source_track_id, stem_ids
- `generation.created`
  - owner: Generation Service
  - payload: generation_id, user_id, track_id, artist_id, model, prompt_policy
- `generation.completed`
  - owner: Generation Service
  - payload: generation_id, user_id, track_id, model, duration_ms
- `experiment.exposed`
  - owner: Experiment Service
  - payload: experiment_key, variant_key, subject_cohort_id, surface
- `marketplace.listing_sold`
  - owner: Marketplace/Contracts Service
  - payload: listing_id, token_id, buyer, seller, amount
- `notification.sent`
  - owner: Notification Service
  - payload: notification_id, recipient_id, notification_type, channel
- `realtime.audio`
  - owner: Realtime Generation Service
  - payload: session_id, client_id, chunk_index, model

## Versioning Strategy

- Use `event_version` as a semantic integer (v1, v2...).
- Backward-compatible changes only within the same version.
- Breaking changes require a new version and parallel support.

## Open Questions

- Which events must be published to external partners?
- Do we need PII redaction at event source or sink?
- Which event families should become public partner/export contracts first?
