# Resonate Environment Variables

Application environment variables live here when they affect app code, local
runtime behavior, or contract-adjacent tooling. Infrastructure-only variables
belong in `resonate-iac`.

When adding a new environment variable:

1. Document it in the table below.
2. Add it to the relevant Terraform or service configuration in `resonate-iac`
   when it is used by deployed infrastructure.
3. Keep secrets in secret managers or GitHub environment secrets, never in
   source.

## Core App Variables

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Frontend | Defaults to `http://localhost:3001` in local app workflows |
| `NEXT_PUBLIC_CHAIN_ID` | Frontend | `31337` for local Anvil, `11155111` for Sepolia fork mode |
| `NEXT_PUBLIC_RPC_URL` | Frontend | Optional RPC override. Use for local/fork AA flows; deployed builds otherwise fall back to the chain default RPC. |
| `NEXT_PUBLIC_AA_BUNDLER` | Frontend | Optional public bundler override; when unset the browser falls back to `/api/bundler` unless a public Pimlico key is provided |
| `NEXT_PUBLIC_PIMLICO_API_KEY` | Frontend | Optional public Pimlico key. Leave unset when using server-side bundler config via `/api/bundler` |
| `RPC_URL` | Backend | RPC endpoint used by contract-aware backend flows |
| `GCP_PROJECT_ID` | Backend | Recommended explicit GCP project for Pub/Sub-backed ingestion; when unset in Cloud Run the backend can also derive the project from Application Default Credentials |
| `AA_BUNDLER` | Backend / frontend server runtime | Server-side bundler URL used by account-abstraction flows and the `/api/bundler` proxy |
| `PIMLICO_API_KEY` | Frontend server runtime | Optional server-side Pimlico key used by `/api/bundler` without exposing it to the browser |
| `SEPOLIA_RPC_URL` | Contracts / backend | Required for Sepolia deploys and forked workflows |
| `TRUST_STAKE_WEI_NEW` | Backend | Optional override for the new-creator content-protection stake requirement |
| `TRUST_STAKE_WEI_ESTABLISHED` | Backend | Optional override for the established-tier content-protection stake requirement |
| `TRUST_STAKE_WEI_TRUSTED` | Backend | Optional override for the trusted-tier content-protection stake requirement |
| `AGENT_KEY_ENCRYPTION_KEY` | Backend | Generate with `./backend/scripts/generate-agent-encryption-key.sh` for local KMS mode |
| `X402_ENABLED` | Backend | Enables the x402 payment and storefront purchase surfaces |
| `X402_PAYOUT_ADDRESS` | Backend | Required when x402 is enabled; receives USDC payments |
| `X402_NETWORK` | Backend | CAIP-2 network id for x402 (`eip155:84532` Base Sepolia or `eip155:8453` Base mainnet) |
| `X402_FACILITATOR_URL` | Backend | x402 verify/settle endpoint; set explicitly for Base mainnet |
| `HUMAN_VERIFICATION_PROVIDER` | Backend | `mock`, `passport`, or `worldcoin`; defaults to `mock` locally |
| `HUMAN_VERIFICATION_REQUIRED_REPORTS` | Backend | Report count threshold that triggers proof-of-humanity gating |
| `CURATOR_REPUTATION_DECAY_DAYS` | Backend | Days per inactivity decay window for curator effective score |
| `CURATOR_REPUTATION_DECAY_POINTS` | Backend | Reputation points removed per decay window |
| `GITCOIN_PASSPORT_API_KEY` | Backend | API key for Passport score lookups |
| `GITCOIN_PASSPORT_SCORER_ID` | Backend | Passport scorer used for curator verification |
| `GITCOIN_PASSPORT_THRESHOLD` | Backend | Minimum Passport score treated as verified |
| `WORLD_ID_APP_ID` | Backend | World ID app identifier for verify calls |
| `WORLD_ID_ACTION` | Backend | World ID action string used by the verification payload |
| `WORLD_ID_API_URL` | Backend | Optional override for the World ID verification base URL |
| `WORLD_ID_VERIFICATION_LEVEL` | Backend | Optional verification level such as `orb` |
| `INTERNAL_SERVICE_KEY` | Backend + internal workers | Shared secret for backend-originated privileged requests and Demucs callback authentication; required in production for internal worker callbacks |
| `STEM_WATCHDOG_TIMEOUT_MS` | Backend | Optional timeout before active stem-processing tracks are failed as stale; defaults to `900000` locally |
| `STEM_WATCHDOG_INTERVAL_MS` | Backend | Optional watchdog sweep interval for stale stem-processing tracks; defaults to `60000` locally |
| `SIGNUP_SEPOLIA_FAUCET_ENABLED` | Backend | Enables the signup faucet. Defaults to `false`; set `true` only in staging/testnet environments |
| `SIGNUP_SEPOLIA_FAUCET_AMOUNT_ETH` | Backend | Sepolia ETH amount sent to new signup wallets when the faucet is enabled; defaults to `0.1` |
| `SIGNUP_SEPOLIA_FAUCET_CHAIN_ID` | Backend | Faucet chain guard; defaults to Sepolia `11155111` |
| `SIGNUP_SEPOLIA_FAUCET_RPC_URL` | Backend | Optional faucet RPC override; falls back to `RPC_URL` / `SEPOLIA_RPC_URL` |
| `SIGNUP_SEPOLIA_FAUCET_FUNDER_PRIVATE_KEY` | Backend secret | Optional faucet funding key; falls back to the deployer `PRIVATE_KEY`. Store in secret manager/GitHub environment secrets, never source |
| `LANGFUSE_ENABLED` | Backend | Optional agent observability switch. Set to `true` only when Langfuse credentials and host are configured |
| `LANGFUSE_BASE_URL` | Backend | Langfuse base URL for trace ingestion. Required only when `LANGFUSE_ENABLED=true` |
| `LANGFUSE_HOST` | Backend | Backward-compatible alias for `LANGFUSE_BASE_URL` |
| `LANGFUSE_PUBLIC_KEY` | Backend secret | Langfuse public key for Basic Auth ingestion. Required only when tracing is enabled |
| `LANGFUSE_SECRET_KEY` | Backend secret | Langfuse secret key for Basic Auth ingestion. Store in secret manager/GitHub environment secrets, never source |
| `LANGFUSE_ENVIRONMENT` | Backend | Optional lowercase trace environment label; falls back to `NODE_ENV` when unset |

## Lyria Auth Modes

- Preferred for Cloud Run / GCE 30-second generation: set `LYRIA_PROJECT_ID`
  and `LYRIA_LOCATION` and let Application Default Credentials from the
  attached service account authenticate Vertex AI `lyria-002` requests.
- Longer-form Lyria 3 generation currently still uses the Google AI Studio /
  Gemini API path, so keep `GOOGLE_AI_API_KEY` configured when you want 1-3
  minute generations.
- Local / non-Vertex fallback: set `GOOGLE_AI_API_KEY` to use the Google AI
  Studio Gemini API path when ADC/Vertex is not available.

## Pub/Sub Auth Modes

- Local development: set `PUBSUB_EMULATOR_HOST` via `make dev-up`.
- Cloud Run / GCE: attach a service account and let Application Default
  Credentials resolve automatically.
- Other non-local environments: use Application Default Credentials via
  `GOOGLE_APPLICATION_CREDENTIALS` if metadata-server auth is not available.

If these variables are deployed through infrastructure, define them in
`resonate-iac` alongside the backend service environment configuration.

## Local x402 Profiles

Base Sepolia:

```env
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAYOUT_ADDRESS=<base-sepolia-wallet>
```

Base mainnet with AgentCash:

```env
X402_ENABLED=true
X402_NETWORK=eip155:8453
X402_FACILITATOR_URL=https://facilitator.payai.network
X402_PAYOUT_ADDRESS=<base-mainnet-wallet>
```

The backend refuses to boot with `X402_NETWORK=eip155:8453` unless
`X402_FACILITATOR_URL` is set explicitly, which prevents accidentally pairing
the Base mainnet flow with the default testnet facilitator.

## Enabling Proof-of-Humanity Providers

The curator verification card enables providers dynamically from backend config.
If a provider is missing required credentials, it is shown as disabled in the UI.

### Local Development Defaults

Local development defaults to `mock` mode:

```env
HUMAN_VERIFICATION_PROVIDER=mock
HUMAN_VERIFICATION_MOCK_PROOF=resonate-human
```

This is why Gitcoin Passport and World ID appear disabled in an unconfigured
local environment.

### Enable Gitcoin Passport

1. Create or identify the Passport scorer you want to query.
2. Obtain the Passport API key for backend score lookups.
3. Set these backend env vars:

```env
HUMAN_VERIFICATION_PROVIDER=passport
GITCOIN_PASSPORT_API_KEY=...
GITCOIN_PASSPORT_SCORER_ID=...
GITCOIN_PASSPORT_THRESHOLD=20
```

4. Restart the backend.
5. Refresh the curator verification UI. Gitcoin Passport should now be selectable.

Notes:

- Passport verification is backend-driven. The frontend does not ask the user to
  paste a proof payload.
- The backend checks whether both `GITCOIN_PASSPORT_API_KEY` and
  `GITCOIN_PASSPORT_SCORER_ID` are present before exposing the provider.

### Enable World ID

1. Create a World ID app and action in the World developer dashboard.
2. Set these backend env vars:

```env
HUMAN_VERIFICATION_PROVIDER=worldcoin
WORLD_ID_APP_ID=...
WORLD_ID_ACTION=...
WORLD_ID_VERIFICATION_LEVEL=orb
```

3. Restart the backend.
4. Refresh the curator verification UI. World ID should now be selectable.

Notes:

- World ID verification expects the frontend/client to submit a proof JSON
  payload.
- The backend checks whether both `WORLD_ID_APP_ID` and `WORLD_ID_ACTION` are
  present before exposing the provider.

### Troubleshooting Disabled Providers

If a provider is shown as unavailable:

- Gitcoin Passport requires both `GITCOIN_PASSPORT_API_KEY` and
  `GITCOIN_PASSPORT_SCORER_ID`
- World ID requires both `WORLD_ID_APP_ID` and `WORLD_ID_ACTION`
- `HUMAN_VERIFICATION_PROVIDER` only sets the preferred default; it does not
  force-enable an unconfigured provider
- restart the backend after changing env vars
- if upstream requests hang, check `HUMAN_VERIFICATION_TIMEOUT_MS`

### Important Scope Note

These providers support **proof-of-humanity / anti-sybil checks for curators**.
They do **not** prove rights ownership for uploaded recordings.
