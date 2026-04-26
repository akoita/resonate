# Agent Identity And Reputation

## Scope

Issue #291 starts the ERC-8004 identity path by making every agent config carry
portable identity metadata, a computed reputation snapshot, and a verifiable
credential export surface. The first implementation is intentionally registry
ready but local-first: it records the fields a future ERC-8004 mint/attestation
job will fill, without depending on a finalized registry deployment.

## Backend

`AgentConfig` owns the identity and reputation state:

- `identityStatus`: `local`, `pending`, `minted`, or `attested`
- `identityChainId`, `identityRegistry`, `identityTokenId`, `identityTxHash`
- `identityCredential`: portable JSON credential for external agents/clients
- `reputationScore`, `reputationSnapshot`
- `reputationAttestedAt`, `reputationTxHash`

`AgentIdentityService` enriches `GET/POST/PATCH /agents/config` responses with a
fresh reputation snapshot. The score is computed from recent agent sessions,
curated licenses, spend against the configured budget, and genre diversity. When
there are no session-derived genres yet, selected vibes seed the local identity
profile so the dashboard is useful before the first run.

## Frontend

The Agent Taste card displays the computed reputation score, the identity status,
the reputation tier, explored genres, and a credential export action. This
replaces the previous ERC-8004 placeholder while keeping the dashboard honest
about the current `local` identity state.

## ERC-8004 Follow-Up

The future registry integration should update the existing fields instead of
introducing a parallel model:

1. Mint the agent identity NFT on first activation.
2. Store registry address, chain ID, token ID, and transaction hash.
3. Publish periodic reputation attestations from the same snapshot shape.
4. Mark `identityStatus` as `attested` once a reputation transaction confirms.
