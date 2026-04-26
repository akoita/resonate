# Agent Identity And Reputation

## Scope

Issues #291 and #261 start the ERC-8004 identity path by making every agent
config carry portable identity metadata, a computed reputation snapshot, and a
verifiable credential export surface. The implementation remains local-first by
default. When ERC-8004 is enabled, the backend can submit identity registration
and reputation metadata transactions through the user's approved agent session
key, using the official public Identity Registry address for supported
mainnet/testnet chain IDs unless an override is supplied.

## Backend

`AgentConfig` owns the identity and reputation state:

- `identityStatus`: `local`, `pending`, `minted`, or `attested`
- `identityChainId`, `identityRegistry`, `identityTokenId`, `identityTxHash`
- `identityCredential`: portable JSON credential for external agents/clients
- `learnedTasteProfile`, `tasteScore`, `tasteUpdatedAt`
- `reputationScore`, `reputationSnapshot`
- `reputationAttestedAt`, `reputationTxHash`

`StemQualityRating` records curator-agent quality work for issue #322:

- `stemId`, `curatorUserId`, and optional `curatorAgentConfigId`
- score plus RMS energy, spectral density, silence ratio, musical salience,
  and confidence metrics
- task metadata fields: `taskType = stem.quality_rating`,
  `analysisMetadata`, `analysisUri`, `onchainMetadataKey`,
  `onchainTaskHash`, `onchainTxHash`, and `onchainStatus`
- validation counters and `reputationDelta` derived from buyer purchase/skip
  signals

`AgentIdentityService` enriches `GET/POST/PATCH /agents/config` responses with a
fresh reputation snapshot. The score is computed from recent agent sessions,
curated licenses, spend against the configured budget, learned taste signals,
and genre diversity. When there are no signal-derived genres yet, selected
vibes seed the local identity profile so the dashboard is useful before the
first run.

Additional endpoints:

- `POST /agents/config/identity/mint` registers the agent with the configured
  ERC-8004 Identity Registry by calling `register(string agentURI)`. If the
  registry is not configured, the response stays local. If the smart-wallet
  session key is missing, the config moves to `pending`.
- `GET /agents/config/identity/reputation-attestation` returns the exact
  deterministic reputation metadata payload the backend would write on-chain,
  plus an `onchain` block that explains whether publishing is enabled, disabled,
  or waiting on a minted token. This keeps Codex, MCP clients, and reviewers able
  to inspect the attestation without a wallet transaction.
- `POST /agents/config/identity/attest` publishes the latest reputation
  snapshot as `setMetadata(agentId, "resonate.reputation", bytes)` on the
  Identity Registry. This uses ERC-8004 metadata rather than Reputation Registry
  feedback because self-feedback by the agent owner is not valid reputation
  feedback under the draft standard.
- `GET /agents/config/identity/registration-file` returns the ERC-8004
  registration file that is encoded into the on-chain `agentURI`.
- `POST /agents/curator/stems/:stemId/quality` runs the curator quality
  analyzer for a stem, stores the score locally, and attempts to publish a
  task-shaped ERC-8004 metadata payload with
  `setMetadata(agentId, "resonate.task.stem.quality_rating.<hash>", bytes)`.
- `GET /agents/curator/stems/:stemId/quality` returns stored quality ratings
  for authenticated buyer agents, clients, and reviewers.

The buyer negotiator reads `StemQualityRating` before purchase execution. It
filters ratings below the conservative default quality threshold, then sorts
remaining listings by quality score, confidence, and stem-type priority. If no
rating exists yet, the listing remains eligible with a neutral quality rank so
the marketplace does not dead-end before curators have covered the catalog.

Curator reputation is part of the normal identity snapshot. Buyer validation is
recorded internally after successful agent purchases and updates
`StemQualityRating.reputationDelta`; the next enriched agent identity snapshot
folds the curator's rating count and accumulated delta into the ERC-8004
reputation surface.

The reputation attestation payload is versioned as
`resonate-agent-reputation/v2` and published under the metadata key
`resonate.reputation`. It is tied to the current `AgentConfig`, ERC-8004 token
link, W3C-style identity credential, and replayable reputation metrics:

- curation: sessions, tracks curated, acceptance rate, quality-rating count,
  and curator reputation delta
- budget: total spend, configured monthly cap, and average budget utilization
- taste: score, tier, taste depth, explored genres, and normalized genre
  breakdown
- trust: a separate block exposing `platformComputedScore` (Resonate-derived),
  `blendedScore` (used for the public tier), and an `independentValidation`
  summary aggregating non-owner feedback by submitter role
- reputation: the full backend snapshot used by Resonate clients

## Independent Validation

Issue #701 adds a non-owner feedback channel so reputation becomes increasingly
credible beyond backend-computed metadata. Validation events are stored in
`AgentReputationFeedback`, separately from the platform-computed
`AgentConfig.reputationSnapshot`, and are replayable.

`AgentReputationFeedbackService` enforces:

- self-feedback rejection: a submitter cannot feed back on the agent they own,
  whether the submitter is identified by their internal user ID or by an
  external wallet/identifier matching the agent owner
- duplicate rejection: the same `(subject, submitter, reference, kind)` tuple
  is hashed into `replayHash`, which is unique
- daily submission cap: each submitter is limited to a fixed number of
  feedback events per 24 hours (default 5)
- weighted contribution: each event carries a `weight` derived from the
  submitter role (`PlatformReviewer 1.0`, `CuratorAgent 0.7`, `BuyerAgent 0.5`,
  `ExternalClient 0.3`) scaled by the submitted score
- role-share cap: when summarized, no single submitter role can contribute
  more than 60% of the weighted score, so a flood of one role cannot dominate
- bounded boost: the weighted summary feeds at most +10 points into the
  blended reputation score, leaving the platform-computed component visible
  in `reputationSnapshot.platformComputedScore`

Endpoints (all under `/agents/:agentConfigId/reputation/feedback`):

- `POST` submits feedback. Requires authenticated submitter; subject is the
  path parameter. Rejects self-feedback with `400`. Rejects duplicates and
  exceeded daily cap with `409`.
- `GET` lists the most recent 200 feedback events for the subject agent.
- `GET summary` returns the aggregated `IndependentValidationSummary` that is
  folded into the next reputation snapshot and the v2 attestation payload.

`onchainStatus` on each feedback row is `Pending` by default and tracks future
publishing to an ERC-8004 Reputation Registry once the deployed interface is
finalized.

`AgentReputationSchedulerService` can refresh this metadata automatically. It is
opt-in and only starts when both `ERC8004_ENABLED=true` and
`ERC8004_REPUTATION_SCHEDULER_ENABLED=true` are set. Each sweep selects active
agents with `identityStatus` of `minted` or `attested`, a non-empty
`identityTokenId`, and no recent `reputationAttestedAt` inside the configured
freshness window. Missing session keys and per-agent failures are logged as
skips/failures without stopping later agents in the batch.

## Frontend

The Agent Taste card displays the computed reputation score, the identity status,
the reputation tier, explored genres, and a credential export action. It also
offers explicit identity mint and reputation attest actions, which are disabled
or return pending/local states when registry configuration or session-key
approval is missing.

## Configuration

ERC-8004 chain writes are disabled unless `ERC8004_ENABLED=true`.

| Variable | Purpose |
| --- | --- |
| `ERC8004_ENABLED` | Enables ERC-8004 identity and reputation writes |
| `ERC8004_IDENTITY_REGISTRY_ADDRESS` | Optional Identity Registry override. When omitted, the backend selects the official ERC-8004 mainnet or testnet registry for supported chain IDs |
| `ERC8004_CHAIN_ID` | Optional chain override; falls back to `AA_CHAIN_ID`, then `CHAIN_ID`, then local Anvil |
| `ERC8004_RPC_URL` | Optional RPC override for receipt reads; falls back to `RPC_URL` / `LOCAL_RPC_URL` |
| `ERC8004_PUBLIC_BASE_URL` | Optional public web/API base used in the registration file services list |
| `ERC8004_REPUTATION_SCHEDULER_ENABLED` | Enables periodic reputation attestation refreshes for active minted agents; requires `ERC8004_ENABLED=true` |
| `ERC8004_REPUTATION_SCHEDULER_INTERVAL_MS` | Optional refresh sweep interval; defaults to 6 hours |
| `ERC8004_REPUTATION_FRESHNESS_MS` | Optional minimum age before refreshing the same agent again; defaults to 24 hours |
| `ERC8004_REPUTATION_SCHEDULER_BATCH_SIZE` | Optional maximum agents refreshed per sweep; defaults to 25 |

Official defaults are centralized in
`backend/src/modules/agents/erc8004_identity.ts`:

- mainnets: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- testnets: `0x8004A818BFB912233c491871b3d84c89A494BD9e`

## ERC-8004 Follow-Up

Follow-up work should update the existing fields instead of introducing a
parallel model:

1. Add an indexer/backfill job for deployments that do not emit a parseable
   `Registered` event in the transaction receipt.
2. Move stem quality tasks from Identity Registry metadata to the ERC-8004
   Validation Registry once the deployed registry interface is finalized for
   Resonate's target chain.
3. Independent non-owner validation is now ingested via
   `AgentReputationFeedback` (issue #701) and folded into the v2 attestation
   payload. The remaining work is wiring the published feedback events to an
   ERC-8004 Reputation Registry once the deployed interface is finalized.
   `AgentReputationFeedback.onchainStatus` is the per-event tracker for that
   handoff.
