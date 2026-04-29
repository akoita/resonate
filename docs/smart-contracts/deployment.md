# Resonate Deployment Guide

Infrastructure-as-code for Resonate now lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).
This repository keeps the application code, smart contracts, and local development helpers.

## Ownership Split

| Area | Repository |
| --- | --- |
| GCP Terraform, Cloud Run deploys, deploy env files, GitHub deploy workflow | `resonate-iac` |
| Backend, frontend, AA local runtime, smart contracts, contract deployment/config helpers | `resonate` |
| Demucs worker infrastructure | `resonate-iac` |

## Local App Workflow

1. Start local app-runtime infrastructure from this repo with `make dev-up`.
2. Install app dependencies in this repo.
3. Run app-local commands from this repo. For AA development, prefer the forked Sepolia flow and use `make web-dev-fork` after `make local-aa-fork` + `make deploy-contracts`.

```bash
cd contracts && ./scripts/install-deps.sh
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..

make backend-dev
make web-dev-local   # or make web-dev-fork when targeting a Sepolia fork on localhost:8545
```

`make dev-up` starts local Postgres, Redis, and the Pub/Sub emulator. `make local-aa-fork` starts the Sepolia fork plus local Alto bundler, and `make local-aa-up` starts the plain `31337` Anvil + bundler pair. `make backend-dev` expects the app-side services on `localhost` and exits early with a targeted message if Postgres is missing.

Useful app-local targets that still live here:

| Command | Purpose |
| --- | --- |
| `make backend-dev` | Start the NestJS API on port `3000` |
| `make web-dev` | Start the Next.js frontend on port `3001` |
| `make local-aa-fork` | Start the recommended Sepolia fork + local Alto bundler and refresh fork-mode env |
| `make local-aa-up` | Start a plain local `31337` Anvil + local Alto bundler |
| `make deploy-base-sepolia` | Deploy protocol contracts to Base Sepolia and refresh app-local contract config |
| `make local-aa-down` | Stop the local AA runtime |
| `make db-reset` | Reset the local Prisma database |
| `make pubsub-init` | Recreate emulator topics/subscriptions on `localhost:8085` |
| `make worker-health` | Check the Demucs worker health endpoint on `localhost:8000` |

## Contract Deployment

### Deploy protocol contracts to Sepolia

```bash
export PRIVATE_KEY=<deployer-private-key>
export SEPOLIA_RPC_URL=<sepolia-rpc-url>
export ETHERSCAN_API_KEY=<etherscan-api-key>

make deploy-sepolia
```

This runs [`contracts/scripts/deploy-sepolia.sh`](../../contracts/scripts/deploy-sepolia.sh), writes a deployment record to `contracts/deployments/sepolia.json`, and refreshes local app config via `contracts/scripts/update-protocol-config.sh`.

The protocol deploy script also grants both `StemMarketplaceV2` and `StemNFT` registrar access in `ContentProtection` so protected mint flows and later marketplace listings resolve the correct stake root.

### Deploy protocol contracts to Base Sepolia

Use this for single-chain x402 staging, where the marketplace contracts, Kernel
smart accounts, USDC settlement, and x402 facilitator all target Base Sepolia.

```bash
export PRIVATE_KEY=<deployer-private-key>
export BASE_SEPOLIA_RPC_URL=<base-sepolia-rpc-url>

make deploy-base-sepolia
```

This runs [`contracts/scripts/deploy-base-sepolia.sh`](../../contracts/scripts/deploy-base-sepolia.sh), writes a deployment record to `contracts/deployments/base-sepolia.json`, writes a copyable remote environment handoff to `contracts/deployments/base-sepolia.remote.env`, and refreshes local app config via `contracts/scripts/update-protocol-config.sh`.

Sourcify verification does not require an API key and is the preferred Base
Sepolia verification path:

```bash
make verify-base-sepolia-sourcify
```

BaseScan verification can also run automatically when `ETHERSCAN_API_KEY` is
set. Use an Etherscan API v2 key with Base Sepolia access:

```bash
export ETHERSCAN_API_KEY=<etherscan-v2-api-key>
make deploy-base-sepolia
```

To force deployment without BaseScan verification, set `VERIFY_CONTRACTS=false`.
Verification failures do not block the deployment record or remote environment
handoff after on-chain execution has completed. If BaseScan verification fails
after a successful deploy, retry without redeploying with `make
verify-base-sepolia`; for Sourcify, use `make verify-base-sepolia-sourcify`.

Both retry commands read `contracts/broadcast/DeployProtocol.s.sol/84532/run-latest.json`.
To verify an older broadcast, pass `BROADCAST_FILE=contracts/broadcast/DeployProtocol.s.sol/84532/run-<timestamp>.json`.

After a successful deploy, copy `contracts/deployments/base-sepolia.remote.env`
into the environment managed by `resonate-iac`, filling in the RPC URL, x402
payout address, and any service-specific secrets there. The handoff keeps
`NEXT_PUBLIC_CHAIN_ID=84532` and `X402_NETWORK=eip155:84532` together so x402
challenges, recorded purchase events, and frontend wallet state all refer to
the same chain.

### Refresh local contract config

Use these commands after deploying to a local Anvil or a local Sepolia fork:

| Command | Purpose |
| --- | --- |
| `make local-aa-config` | Refresh AA addresses from the latest `DeployLocalAA` broadcast |
| `make local-aa-fork` | Start a Sepolia fork on `localhost:8545`, start the local bundler on `localhost:4337`, and refresh fork-mode `.env` files |
| `make deploy-contracts` | Deploy protocol contracts to the local RPC and refresh app config |
| `make contracts-deploy-local` | Start local AA infra, then run AA deploy + protocol deploy against it |

## Infrastructure and Cloud Deployment

Use `resonate-iac` for all of the following:

- Terraform init/plan/apply/destroy
- Cloud Run deployment
- GPU Demucs worker lifecycle
- Deploy environment files such as `.env.deploy.*`
- GitHub Actions deployment workflow configuration

### GitHub delivery -> deploy handoff

Application CI still runs in this repo. Successful push-based CI on:

- `develop`
- `main`

now sends deploy intent to `resonate-iac` through GitHub `repository_dispatch`.

Automatic handoff mapping:

- `develop` -> `dev`
- `main` -> `staging`

Production remains manual-only in `resonate-iac`.

The sender workflow in this repo passes:

- `environment`
- `services`
- `source_ref`
- `release_sha`
- `release_id`
- `trigger_branch`
- `backend_image`
- `frontend_image`
- `demucs_image`

It intentionally does not pass `source_repository`, because `resonate-iac`
already knows the default source repository and GitHub repository dispatch
payloads are limited to 10 properties.

Required sender secret in `resonate`:

- `RESONATE_IAC_DISPATCH_TOKEN`
  - GitHub token with permission to trigger repository dispatch events on
    `akoita/resonate-iac`

Deployable image publication now runs through GCP Cloud Build. Backend and Demucs
images are still built from the exact GitHub commit being deployed. Frontend image
publication now reuses an environment-scoped GitHub Actions build artifact and only
uses Cloud Build to package the runtime image, which removes a second `next build`
from the deploy path while keeping immutable image refs in the deploy manifest.

Required image-publish auth secrets in deployable GitHub environments for `resonate`:

- `GCP_WIF_PROVIDER`
  - workload identity provider used by GitHub Actions to submit Cloud Build jobs
- `GCP_ARTIFACT_REGISTRY_SA_EMAIL`
  - dedicated Cloud Build publisher service account email
  - GitHub Actions authenticates as this identity and passes it explicitly to
    `gcloud builds submit --service-account` so Cloud Build does not fall back to
    the project default build identity

Additional GCP requirement:

- Cloud Build must be enabled in the target project, and the effective build service
  account must have permission to push into the target Artifact Registry repository.
- Backend and Demucs publication require the repository source to remain reachable
  from GCP for the commit being published, since those images are built against the
  GitHub repo URL and commit SHA.
- Frontend publication uploads only the prepared runtime artifact context to Cloud Build,
  so the effective build identity also needs access to the Cloud Build staging bucket.
- The Cloud Build submit wrapper passes an explicit billing/quota project and
  source staging directory. `GCP_BILLING_QUOTA_PROJECT` and
  `GCP_CLOUD_BUILD_SOURCE_STAGING_DIR` can override those values when an
  environment does not follow the default IaC bucket convention.

Required deployable GitHub environment variables in `resonate`:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_ZERODEV_PROJECT_ID`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_STEM_NFT_ADDRESS`
- `NEXT_PUBLIC_MARKETPLACE_ADDRESS`
- `NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS`
- `NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS`
- `NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS`
- `NEXT_PUBLIC_CURATION_REWARDS_ADDRESS`

The receiver-side contract and deploy execution live in `resonate-iac`.

## Environment Variables

General app environment variables now live in
[`docs/deployment/environment.md`](../deployment/environment.md). Keep this
document focused on contract deployment and contract-adjacent local workflows.

ERC-8004 agent identity writes are backend runtime configuration, not protocol
deployment inputs. When a deployed environment should register agents on-chain,
set `ERC8004_ENABLED` and any chain/RPC overrides in the service configuration
managed by `resonate-iac`. `ERC8004_IDENTITY_REGISTRY_ADDRESS` is only required
for a fork or custom registry; otherwise the backend selects the official
ERC-8004 mainnet or testnet Identity Registry for supported chain IDs. The
variable reference lives in
[`docs/deployment/environment.md`](../deployment/environment.md).

The standalone agent runtime worker is also backend runtime configuration. Set
`AGENT_RUNTIME_WORKER_URL`, `AGENT_RUNTIME_WORKER_TIMEOUT_MS`, and
`AGENT_RUNTIME_WORKER_REQUIRED` in the backend service configuration when a
deployed environment should route agent execution to a separate worker. The
worker and backend share `INTERNAL_SERVICE_KEY` for internal requests.
