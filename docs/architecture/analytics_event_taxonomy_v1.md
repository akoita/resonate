---
title: "Analytics Event Taxonomy v1"
status: implemented
owner: "@akoita"
issue: 960
---

# Analytics Event Taxonomy v1

This is the canonical event vocabulary for Resonate analytics producers,
warehouse transforms, and future reports. The goal is not to predict every
report now. The goal is to capture stable, privacy-safe product and protocol
facts so future listener, artist, marketplace, rights, agent, and operator
analytics can be built from history instead of guesses.

Use this document with:

- [Analytics Event Ledger](../features/analytics_event_ledger.md)
- [Long-Term Analytics Event Ledger RFC](../rfc/analytics-event-ledger.md)
- [Event Taxonomy & Domain Model](event_taxonomy_domain_model.md)

## Envelope Contract

Every analytics event uses the shared envelope from
`backend/src/modules/analytics/analytics_event.ts`.

| Field | Required | Semantics |
| --- | --- | --- |
| `eventId` | yes | Globally unique idempotency key. Producers may supply it, otherwise backend ingestion derives one. |
| `eventName` | yes | Stable dotted name, `family.action`, for example `playback.completed`. |
| `eventVersion` | yes | Positive integer schema version. v1 changes must be additive. |
| `occurredAt` | yes | Source timestamp for the product/domain action. |
| `receivedAt` | backend | Ingestion timestamp. |
| `producer` | yes | Service, worker, indexer, or first-party client producer. |
| `environment` | yes | `local`, `dev`, `staging`, or `prod`. |
| `privacyTier` | yes | `anonymous`, `pseudonymous`, `personal`, or `sensitive`. |
| `subjectType` / `subjectId` | paired | Main entity acted on. Provide both or neither. |
| `actorId` | optional | Pseudonymous actor when behavior should be cohortable by user/account/agent. |
| `sessionId` | optional | Product, playback, checkout, or agent session correlation id. |
| `traceId` | optional | Request/job/runtime trace id. |
| `schemaUri` | optional | Stable schema key when a generated schema exists. |
| `consentBasis` | required for personal/sensitive | Consent or legal-basis snapshot. |
| `payload` | yes | Versioned, compact event facts. |
| `sourceRefs` | optional | Durable source references for replay, idempotency, and audit. |

## Naming Rules

- Use lowercase dotted event names: `family.action`.
- Preserve existing domain event names when a backend EventBus event already
  has a clear owner.
- Use past-tense facts for durable outcomes, for example
  `payment.settled`, `playlist.track_added`, `artist.upload_step_completed`.
- Use present-tense lifecycle names only when the event is inherently a state
  observation, for example `playback.heartbeat`.
- Do not encode UI wording, button text, experiment copy, or route paths in
  `eventName`; put stable dimensions in `payload`.
- New event families require adding support to both backend warehouse export
  and Dataflow before production emission.

## Actor And Subject Semantics

| Concept | Use |
| --- | --- |
| `actorId` | The pseudonymous user, artist account, wallet, curator, agent, or contract participant that caused the event. Frontend clients must not submit actor IDs; backend controllers derive them from auth. |
| `subjectType` | Entity type that the event is about: `track`, `release`, `playlist`, `payment`, `listing`, `generation_job`, `session`, `user_wallet`, `dispute`, `token`, `notification`, `address`. |
| `subjectId` | Stable id for the subject entity. Use a pseudonymous or protocol-safe id when needed. |
| `sessionId` | Correlates behavior in time. It is not a replacement for `actorId`; it answers "during which journey?" rather than "which cohort/user?". |
| `sourceRefs` | References durable source records, transactions, client event ids, block numbers, job ids, or idempotency keys. |

For multi-party events, choose the primary actor that initiated the action and
keep counterparties in payload/source refs only when they are necessary for
reporting or audit.

## Privacy Tiers

| Tier | Examples | Default Handling |
| --- | --- | --- |
| `anonymous` | Aggregate counters, unauthenticated public page impressions without session linkage. | No user-level actor. Long retention is usually acceptable. |
| `pseudonymous` | Playback, product funnels, playlist actions, wallet budget changes, purchase behavior keyed by pseudonymous actor. | Default for product analytics. Governed long-term facts are allowed. |
| `personal` | Email-linked identity events, generation prompts, exact user support data. | Requires `consentBasis`; minimize and shorten raw retention. |
| `sensitive` | Legal, biometric, abuse, or high-risk personal data. | Avoid unless explicitly approved; requires `consentBasis` and stricter retention. |

Most analytics should be `pseudonymous`. Do not downgrade personal content by
hashing it into a pseudonymous payload; remove the content or produce a
separate governed personal event.

## Do Not Collect

Analytics payloads must not include:

- secrets, API keys, private keys, session cookies, auth tokens, or passkeys
- raw prompts, notification bodies, support messages, lyrics, or user free text
- browser fingerprints, exact IP addresses, or raw user-agent strings
- realtime audio chunks or unbounded media metadata
- raw wallet private data or seed material
- full files, buffers, stems, artwork, or large nested objects
- exact location unless a privacy review approves it; prefer coarse regions

When in doubt, collect a stable category or count instead of raw content.

## Source Refs And Idempotency

`sourceRefs` should include the smallest stable set of fields needed to dedupe
or audit an event:

- database row ids: `paymentId`, `releaseId`, `playlistId`
- chain refs: `chainId`, `contractAddress`, `transactionHash`, `blockNumber`
- product refs: `sessionId`, `playbackInstanceId`, `clientEventId`
- job refs: `jobId`, `modelVersion`

Avoid timestamps as the only source ref. For frontend product events, include a
client-generated `clientEventId` when repeated clicks or retries are possible.

## Versioning

Event v1 schemas may add optional fields. Breaking changes require a new
`eventVersion` and parallel support in:

- backend event validation/examples
- warehouse export
- Dataflow transform
- BigQuery marts/views that read the event
- docs and tests

Do not repurpose an existing field with a new meaning.

## Canonical Families

| Family | Owner | Purpose |
| --- | --- | --- |
| `identity.*` | Auth/account services | Signup, auth, account, role, passkey, profile milestones. |
| `onboarding.*` | Web app/auth | First-run and guided setup funnels. |
| `wallet.*` | Wallet service | Funding, spend, budget, account abstraction wallet state. |
| `catalog.*` | Catalog service | Release/track metadata, status, publish readiness, visibility. |
| `artist.*` | Web app/catalog | Artist-facing UI funnels, uploads, catalog views. |
| `stems.*` | Ingestion/stem services | Upload, separation, encryption, storage, processing outcomes. |
| `ipnft.*` | Catalog/contracts | Tokenization and provenance observations. |
| `session.*` | Session/agent runtime | Listener and agent commerce session lifecycle. |
| `playback.*` | Playback service/web player | Starts, heartbeats, completions, skip/quality signals. |
| `playlist.*` | Web app/library | Playlist creation, edits, additions, removals, plays. |
| `library.*` | Library service/web app | Saves, removes, follows, listener collection actions. |
| `search.*` | Web app/search | Search submissions and result clicks. |
| `marketplace.*` | Marketplace/storefront | Listing views, checkout starts, purchase intent, notifications. |
| `community.*` | Community service/web app | Profile visibility, artist rooms, holder access, benefits, messages, reports, and moderation actions. |
| `commerce.*` | Commerce/payments | Quotes, purchases, settlement, refunds, revenue events. |
| `payment.*` | Payments service | Payment initiation, settlement, accounting rails. |
| `contract.*` | Contract indexers | On-chain mint/list/sale/royalty/stake/dispute/escrow observations. |
| `x402.*` | x402 service | Challenge, verification, settlement, replay protection. |
| `license.*` | Session/rights services | License grants and license lifecycle. |
| `rights.*` | Rights service | Rights routing, evidence, disputes, moderation decisions. |
| `release_rights.*` | Rights service | Release-scoped rights request workflow. |
| `agent.*` | Agent runtime/wallet | Selections, evaluations, decisions, purchases, budget alerts. |
| `recommendation.*` | Recommendation service | Candidate generation and preference updates outside agent runtime. |
| `curator.*` | Curation service | Curator stake, reports, review, reputation. |
| `remix.*` | Remix service | Remix creation, eligibility, lineage, minting. |
| `generation.*` | Generation service | AI generation lifecycle and publish outcomes. |
| `notification.*` | Notification service | Notification creation, delivery, preference, status. |
| `realtime.*` | Realtime service | Realtime transport/session status without audio payloads. |
| `experiment.*` | Experiment framework | Assignment, exposure, conversion. |
| `system.*` | Platform jobs | Imports, exports, backfills, pipeline health. |

## Canonical Event List

The table below defines the current v1 vocabulary. `Required payload` lists the
fields expected in long-lived facts. Optional fields may be added as needed
when they follow the privacy and versioning rules above.

| Event | Producer | Subject | Actor | Required payload | Optional payload/source refs |
| --- | --- | --- | --- | --- | --- |
| `onboarding.started` | `web-app` | none | auth user | `source` | `step`, `surface`, `clientEventId` |
| `onboarding.step_viewed` | `web-app` | none | auth user | `step`, `source` | `surface`, `clientEventId` |
| `onboarding.step_completed` | `web-app` | none | auth user | `step`, `source` | `surface`, `durationMs`, `clientEventId` |
| `onboarding.completed` | `web-app` | none | auth user | `source` | `durationMs`, `stepsCompleted`, `clientEventId` |
| `onboarding.abandoned` | `web-app` | none | auth user | `step`, `source` | `durationMs`, `reasonCategory`, `clientEventId` |
| `wallet.connected` | `web-app` | `user_wallet` | auth user | `source` | `provider`, `chainId`, `clientEventId` |
| `wallet.faucet_requested` | `web-app` | `user_wallet` | auth user | `source` | `chainId`, `assetSymbol`, `clientEventId` |
| `wallet.budget_set` | `wallet-service` | `user_wallet` | `userId` | `userId`, `monthlyCapUsd` | `source`, `clientEventId` |
| `wallet.funded` | `wallet-service` | `user_wallet` | `userId` | `userId`, `amountUsd`, `balanceUsd` | `asset`, `chainId`, `txHash` |
| `wallet.spent` | `wallet-service` | `user_wallet` | `userId` | `userId`, `amountUsd`, `spentUsd`, `balanceUsd` | `asset`, `paymentId` |
| `artist.upload_started` | `web-app` | `release` when known | auth user | `source` | `releaseId`, `entryPoint`, `clientEventId` |
| `artist.upload_step_completed` | `web-app` | `release` when known | auth user | `step`, `source` | `releaseId`, `fileCount`, `trackCount`, `stemCount`, `clientEventId` |
| `artist.catalog_viewed` | `web-app` | `artist` | auth user | `source` | `releaseCount`, `filter`, `clientEventId` |
| `stems.uploaded` | `ingestion-service` | `release` | `artistId` | `releaseId`, `artistId`, `sourceType`, `trackIds` | `trackCount`, `stemCount`, `retry` |
| `stems.processed` | `ingestion-service` | `release` | `artistId` | `releaseId`, `artistId`, `modelVersion`, `trackIds`, `stemIds` | `trackCount`, `stemCount` |
| `stems.failed` | `ingestion-service` | `release` | `artistId` | `releaseId`, `artistId`, `status`, `error` | none |
| `catalog.track_status` | `catalog-service` | `track` | none | `releaseId`, `trackId`, `status` | `error` |
| `catalog.release_ready` | `catalog-service` | `release` | `artistId` | `releaseId`, `artistId`, `status`, `trackIds` | `trackCount`, `stemCount` |
| `playlist.created` | `web-app` | `playlist` | auth user | `playlistId`, `source` | `trackCount`, `clientEventId` |
| `playlist.updated` | `web-app` | `playlist` | auth user | `playlistId`, `source` | `field`, `trackCount`, `clientEventId` |
| `playlist.track_added` | `web-app` | `playlist` | auth user | `playlistId`, `trackId`, `source` | `position`, `releaseId`, `artistId`, `clientEventId` |
| `playlist.track_removed` | `web-app` | `playlist` | auth user | `playlistId`, `trackId`, `source` | `position`, `clientEventId` |
| `playlist.played` | `web-app` | `playlist` | auth user | `playlistId`, `source` | `trackCount`, `shuffle`, `clientEventId` |
| `library.saved` | `library-service` / `web-app` | `track` | user cohort/auth user | `trackId`, `source` | `releaseId`, `playlistId`, `clientEventId` |
| `library.removed` | `web-app` | `track` | auth user | `trackId`, `source` | `releaseId`, `clientEventId` |
| `search.submitted` | `web-app` | none | auth user | `source` | `queryLength`, `resultCount`, `surface`, `clientEventId` |
| `search.result_clicked` | `web-app` | `track` / `release` / `artist` | auth user | `resultType`, `resultId`, `source` | `rank`, `queryLength`, `clientEventId` |
| `playback.started` | `playback-service` | `track` | auth user | `trackId`, `playbackInstanceId`, `source` | `artistId`, `releaseId`, `queueIndex`, `queueLength`, `repeatMode`, `shuffle` |
| `playback.heartbeat` | `playback-service` | `track` | auth user | `trackId`, `playbackInstanceId`, `positionMs`, `heartbeatIntervalMs` | `artistId`, `releaseId`, `durationMs` |
| `playback.completed` | `playback-service` | `track` | auth user | `trackId`, `completionRatio`, `source` | `artistId`, `releaseId`, `durationMs` |
| `marketplace.listing_viewed` | `web-app` | `listing` | auth user | `listingId`, `source` | `tokenId`, `licenseType`, `priceUsd`, `clientEventId` |
| `marketplace.checkout_started` | `web-app` | `listing` | auth user | `listingId`, `source` | `licenseType`, `priceUsd`, `paymentAssetSymbol`, `clientEventId` |
| `marketplace.purchase_intent` | `web-app` | `listing` | auth user | `listingId`, `source` | `licenseType`, `priceUsd`, `rail`, `clientEventId` |
| `marketplace.listing_notify` | `marketplace-service` | `listing` | seller address | `tokenId`, `sellerAddress`, `amount`, `pricePerUnit` | `listingId`, `paymentToken`, `licenseType`, `stemId`, `transactionHash` |
| `license.granted` | `sessions-service` | `license` | none/session user | `licenseId`, `type`, `priceUsd`, `sessionId`, `trackId` | `artistId`, `releaseId`, `title` |
| `payment.initiated` | `payments-service` | `payment` | none/session user | `paymentId`, `amountUsd`, `sessionId` | `trackId`, `artistId`, `releaseId`, `chainId`, `paymentAssetSymbol` |
| `payment.settled` | `payments-service` | `payment` | none/session user | `paymentId`, `txHash`, `status` | `amountUsd`, `trackId`, `artistId`, `releaseId`, `chainId`, `settlementAmount` |
| `commerce.settled` | `payments-service` | `track` when known | none | `paymentId`, `canonicalAmountUsd` | `artistId`, `trackId`, `settlementAsset`, `txHash` |
| `contract.stem_minted` | `contracts-indexer` | `token` | creator address | `tokenId`, `creatorAddress`, `chainId`, `contractAddress`, `transactionHash` | `parentIds`, `blockNumber` |
| `contract.stem_listed` | `contracts-indexer` | `listing` | seller address | `listingId`, `sellerAddress`, `tokenId`, `amount`, `pricePerUnit` | `paymentToken`, `expiresAt`, `chainId`, `contractAddress`, `transactionHash`, `blockNumber` |
| `contract.stem_sold` | `contracts-indexer` | `listing` | buyer address | `listingId`, `buyerAddress`, `amount`, `totalPaid` | `chainId`, `contractAddress`, `transactionHash`, `blockNumber` |
| `contract.royalty_paid` | `contracts-indexer` | `token` | recipient address | `tokenId`, `recipientAddress`, `amount` | `chainId`, `contractAddress`, `transactionHash`, `blockNumber` |
| `contract.stake_deposited` | `contracts-indexer` | `token` | staker address | `tokenId`, `stakerAddress`, `amount` | `paymentToken`, `chainId`, `contractAddress`, `transactionHash` |
| `contract.stake_slashed` | `contracts-indexer` | `token` | reporter address | `tokenId`, `reporterAddress`, `reporterAmount`, `treasuryAmount`, `burnedAmount` | `paymentToken`, `chainId`, `transactionHash` |
| `contract.dispute_filed` | `contracts-indexer` | `dispute` | reporter address | `disputeId`, `tokenId`, `reporterAddress`, `counterStake` | `creatorAddress`, `paymentToken`, `chainId`, `transactionHash` |
| `contract.dispute_resolved` | `contracts-indexer` | `dispute` | resolver address | `disputeId`, `tokenId`, `outcome`, `resolverAddress` | `chainId`, `transactionHash` |
| `rights.route_decided` | `rights-service` | `release` | none/operator when known | `releaseId`, `artistId`, `route`, `evidenceTypes` | `decisionReason` |
| `release_rights.request_updated` | `rights-service` | `release_rights_request` | none/operator when known | `requestId`, `releaseId`, `status` | none |
| `agent.track_selected` | `agent-runtime` | `track` | agent/user when known | `sessionId`, `trackId`, `strategy` | `artistId`, `releaseId`, `source` |
| `agent.intent_viewed` | `web-app` | `agent_session` when known | auth user | `source` | `presetCount`, `intents`, `clientEventId` |
| `agent.intent_selected` | `web-app` | `agent_session` when known | auth user | `intent`, `intentName`, `source` | `mood`, `energy`, `licenseType`, `queueStyle`, `commercePosture`, `clientEventId` |
| `agent.session_started` | `web-app` | `agent_session` | auth user | `source` | `intent`, `intentName`, `mood`, `energy`, `licenseType`, `queueStyle`, `commercePosture`, `clientEventId` |
| `agent.session_stopped` | `web-app` | `agent_session` | auth user | `source` | `intent`, `intentName`, `sessionDurationMs`, `clientEventId` |
| `agent.next_pick_requested` | `web-app` | `agent_session` | auth user | `status`, `source` | `intent`, `intentName`, `trackId`, `runtimeStatus`, `score`, `clientEventId` |
| `agent.evaluated` | `agent-runtime` | `track` | agent/user when known | `sessionId`, `trackId`, `licenseType`, `priceUsd`, `reason` | none |
| `agent.decision_made` | `agent-runtime` | `track` | agent/user when known | `sessionId`, `reason` | `trackId`, `artistId`, `releaseId`, `licenseType`, `priceUsd` |
| `agent.purchase_completed` | `agent-purchase-service` | `listing` | `userId` | `sessionId`, `userId`, `listingId`, `tokenId`, `amount`, `priceUsd`, `txHash` | `mode` |
| `agent.purchase_failed` | `agent-purchase-service` | `listing` | `userId` | `sessionId`, `userId`, `listingId`, `error` | `tokenId`, `amount`, `priceUsd` |
| `recommendation.generated` | `recommendations-service` | none | `userId` | `userId`, `trackIds`, `strategy` | `candidateCount` |
| `recommendation.preferences_updated` | `recommendations-service` | none | `userId` | `userId`, `preferences` | none |
| `generation.started` | `generation-service` | `generation_job` | `userId` | `jobId`, `userId` | `artistId`, `durationSeconds`, `seed` |
| `generation.progress` | `generation-service` | `generation_job` | none | `jobId`, `phase` | none |
| `generation.completed` | `generation-service` | `generation_job` | `userId` | `jobId`, `userId`, `trackId`, `releaseId` | `artistId`, `provider`, `model` |
| `generation.failed` | `generation-service` | `generation_job` | `userId` | `jobId`, `userId`, `error` | `artistId` |
| `generation.created` | `generation-service` | `generation` | `userId` | `generationId`, `userId` | `trackId`, `artistId`, `model`, `promptPolicy` |
| `curator.staked` | `curation-service` | `curator` | `curatorId` | `curatorId`, `amountUsd` | none |
| `curator.reported` | `curation-service` | `report` | `curatorId` | `reportId`, `curatorId`, `trackId`, `reason` | none |
| `remix.created` | `remix-service` | `remix` | `creatorId` | `remixId`, `creatorId`, `sourceTrackId`, `stemIds` | `txHash` |
| `notification.created` | `notification-service` | `notification` | wallet address | `notificationId`, `walletAddress`, `type` | `disputeId`, `releaseId` |
| `settings.updated` | `web-app` | none | auth user | `setting`, `source` | `surface`, `clientEventId` |

## Examples

### Listener Playback Heartbeat

```json
{
  "eventName": "playback.heartbeat",
  "eventVersion": 1,
  "producer": "playback-service",
  "privacyTier": "pseudonymous",
  "subjectType": "track",
  "subjectId": "track_123",
  "actorId": "user_4f7c...",
  "sessionId": "playback_session_abc",
  "payload": {
    "trackId": "track_123",
    "artistId": "artist_123",
    "releaseId": "release_123",
    "playbackInstanceId": "playback_instance_abc",
    "positionMs": 90000,
    "durationMs": 240000,
    "heartbeatIntervalMs": 30000,
    "source": "web_player"
  },
  "sourceRefs": {
    "sessionId": "playback_session_abc",
    "playbackInstanceId": "playback_instance_abc",
    "positionMs": "90000"
  }
}
```

### Artist Upload Step

```json
{
  "eventName": "artist.upload_step_completed",
  "eventVersion": 1,
  "producer": "web-app",
  "privacyTier": "pseudonymous",
  "subjectType": "release",
  "subjectId": "release_123",
  "actorId": "user_9aa2...",
  "payload": {
    "releaseId": "release_123",
    "step": "stems",
    "fileCount": 8,
    "trackCount": 2,
    "stemCount": 8,
    "source": "web_app"
  },
  "sourceRefs": {
    "clientEventId": "client_event_123"
  }
}
```

### Marketplace Purchase Intent

```json
{
  "eventName": "marketplace.purchase_intent",
  "eventVersion": 1,
  "producer": "web-app",
  "privacyTier": "pseudonymous",
  "subjectType": "listing",
  "subjectId": "listing_123",
  "actorId": "user_22cd...",
  "payload": {
    "listingId": "listing_123",
    "licenseType": "personal",
    "priceUsd": 1.25,
    "rail": "x402",
    "source": "web_app"
  },
  "sourceRefs": {
    "clientEventId": "client_event_456"
  }
}
```

### Rights Route Decision

```json
{
  "eventName": "rights.route_decided",
  "eventVersion": 1,
  "producer": "rights-service",
  "privacyTier": "pseudonymous",
  "subjectType": "release",
  "subjectId": "release_123",
  "payload": {
    "releaseId": "release_123",
    "artistId": "artist_123",
    "route": "STANDARD_ESCROW",
    "evidenceTypes": ["rights_metadata"],
    "decisionReason": "verified uploader"
  },
  "sourceRefs": {
    "releaseId": "release_123"
  }
}
```

## Producer Checklist

Before adding a new event:

1. Confirm the family exists in this taxonomy.
2. Choose stable `subjectType` and `subjectId` semantics.
3. Decide whether the actor should be anonymous, pseudonymous, personal, or
   omitted.
4. Add a compact payload with no free-form personal content.
5. Add source refs for idempotency and audit.
6. Add or update tests covering ingestion, warehouse/Dataflow promotion, and
   any report that reads the event.
7. Update this document if the event name or required fields are new.
