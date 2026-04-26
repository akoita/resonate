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
- `POST /agents/config/identity/attest` publishes the latest reputation
  snapshot as `setMetadata(agentId, "resonate.reputation", bytes)` on the
  Identity Registry. This uses ERC-8004 metadata rather than Reputation Registry
  feedback because self-feedback by the agent owner is not valid reputation
  feedback under the draft standard.
- `GET /agents/config/identity/registration-file` returns the ERC-8004
  registration file that is encoded into the on-chain `agentURI`.

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

Official defaults are centralized in
`backend/src/modules/agents/erc8004_identity.ts`:

- mainnets: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- testnets: `0x8004A818BFB912233c491871b3d84c89A494BD9e`

## ERC-8004 Follow-Up

Follow-up work should update the existing fields instead of introducing a
parallel model:

1. Add a scheduler for periodic reputation metadata refreshes.
2. Add an indexer/backfill job for deployments that do not emit a parseable
   `Registered` event in the transaction receipt.
3. Add ERC-8004 Reputation Registry feedback once Resonate has independent
   curator or client agents that can submit non-owner feedback.
