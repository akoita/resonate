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
npm install -g npm@11.14.1
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

All Forge deployment scripts fail closed on non-local chains when `PRIVATE_KEY`
is unset. The first Anvil private key is allowed only on local chain IDs
`31337` and `1337`. To use that default key against any other RPC, an operator
must set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true` explicitly; do this only for
throwaway forks or disposable test environments.

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

### GitHub Actions contract deployment

Manual smart-contract deployment is available in
`.github/workflows/contracts-deploy.yml` as **Smart Contract Deployment**.
It intentionally runs only through `workflow_dispatch`; no push, pull request,
or repository-dispatch event can deploy contracts.

Recommended operator flow:

1. Open **Actions -> Smart Contract Deployment**.
2. Select `environment=staging` or `environment=dev`.
3. Select `target_network=base-sepolia` for the normal staging path.
4. Run `operation=preflight` first. This builds/tests contracts, checks the RPC
   chain ID, derives the deployer address from the private key, and verifies the
   deployer has at least `0.01 ETH`.
5. Run the narrowest operation that matches the lifecycle you are changing,
   only after preflight passes and the selected GitHub environment approval is
   granted.
6. For Base Sepolia verification retries, run `verify-base-sepolia` or
   `verify-base-sepolia-sourcify`.

Deployment operations:

| Operation | Lifecycle | Redeploy/update behavior | Reference updates required |
| --- | --- | --- | --- |
| `deploy-protocol` | Full marketplace/music-rights protocol graph | Deploys `TransferValidator`, `ContentProtection` proxy, `DisputeResolution`, `CurationRewards`, `RevenueEscrow`, `StemNFT`, `PaymentAssetRegistry`, and `StemMarketplaceV2` together | Script links `StemNFT -> TransferValidator`, `StemNFT -> ContentProtection`, `TransferValidator -> ContentProtection`, `RevenueEscrow -> ContentProtection`, and grants `ContentProtection` registrar access to `StemNFT` and marketplace |
| `deploy-content-protection` | Phase-2 add-on for an existing `StemNFT` + `TransferValidator` deployment | Deploys a new `ContentProtection` proxy and `RevenueEscrow` without replacing `StemNFT` or marketplace | Requires `STEM_NFT_ADDRESS` and `TRANSFER_VALIDATOR_ADDRESS`; script grants the new `ContentProtection` registrar access to `StemNFT`, optionally grants the existing marketplace when `MARKETPLACE_ADDRESS` is set, updates existing `StemNFT`/`TransferValidator` references, and links `RevenueEscrow -> ContentProtection` |
| `upgrade-content-protection` | UUPS implementation upgrade | Keeps the same `ContentProtection` proxy address; deploys a new implementation and calls the configured reinitializer | Requires `CONTENT_PROTECTION_PROXY`; downstream contract references do not change because the proxy address is stable |
| `set-content-protection-stake` | Policy/config update | No redeploy; updates stake amount for an ERC-20 asset | Requires `CONTENT_PROTECTION_ADDRESS` plus `STAKE_ASSET_ADDRESS` or `PAYMENT_USDC_ADDRESS`; no contract reference changes |
| `deploy-show-campaign-escrow` | Resonate Shows campaign escrow | Deploys standalone `ShowCampaignEscrow` with owner from `SHOW_CAMPAIGN_ESCROW_OWNER` or deployer | No existing protocol contract references need updating today; backend/frontend env must receive the deployed escrow address before live pledge execution |
| `verify-base-sepolia` | BaseScan/Etherscan verification retry | No deploy | Reads the selected broadcast file |
| `verify-base-sepolia-sourcify` | Sourcify verification retry | No deploy | Reads the selected broadcast file |

Use a full graph deployment when constructor immutables or tightly coupled
addresses change. Use the narrower operation when the existing address graph can
remain valid or the script explicitly rewires the affected references. Do not
redeploy an address-bearing dependency without also running or documenting the
required downstream setter calls.

Expected GitHub environments:

| Environment | Purpose |
| --- | --- |
| `contracts-dev` | Testnet/dev contract deployment experiments |
| `contracts-staging` | Base Sepolia staging deployment |

Required GitHub environment secrets:

| Secret | Required for | Notes |
| --- | --- | --- |
| `CONTRACT_DEPLOYER_PRIVATE_KEY` | `preflight`, deploy/update operations | Preferred deployer key name. The workflow also accepts legacy `PRIVATE_KEY`, but new environments should use `CONTRACT_DEPLOYER_PRIVATE_KEY`. |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia `preflight`, `deploy-protocol`, BaseScan verify | May be a secret when the RPC provider URL is paid, rate-limited, or account-scoped. |
| `SEPOLIA_RPC_URL` | Sepolia `preflight`, `deploy-protocol` | May be a secret for provider/account privacy. |
| `ETHERSCAN_API_KEY` | Optional BaseScan/Etherscan verification | Etherscan API v2 key with Base Sepolia support. |
| `BASESCAN_API_KEY` | Optional BaseScan verification | Backward-compatible alias used by existing scripts. Prefer `ETHERSCAN_API_KEY`. |

Optional GitHub environment variables:

| Variable | Purpose |
| --- | --- |
| `VERIFY_CONTRACTS` | Usually set from the workflow input. `auto` verifies when an explorer API key is present. |
| `BROADCAST_FILE` | Override the broadcast JSON used by verification retry jobs. |
| `BASESCAN_API_URL` | Override the BaseScan/Etherscan verification API URL. |
| `VERIFY_RETRIES`, `VERIFY_DELAY_SECONDS` | Tune BaseScan verification retry behavior. |
| `SOURCIFY_API_URL`, `SOURCIFY_RETRIES`, `SOURCIFY_DELAY_SECONDS` | Tune Sourcify verification retry behavior. |
| `X402_FACILITATOR_URL` | Written into the Base Sepolia remote environment handoff. |
| `PAYMENT_USDC_ADDRESS`, `PAYMENT_WETH_ADDRESS`, `PAYMENT_ENABLE_WETH` | Optional payment registry deployment inputs. |
| `PAYMENT_REGISTRY_ADMIN` | Optional payment registry admin override. |
| `PAYMENT_ETH_USD_FEED`, `PAYMENT_USDC_USD_FEED`, `PAYMENT_ORACLE_MAX_STALENESS` | Optional oracle deployment inputs. |
| `STEM_NFT_ADDRESS`, `MARKETPLACE_ADDRESS`, `TRANSFER_VALIDATOR_ADDRESS`, `EXISTING_ADMIN` | Required/optional inputs for `deploy-content-protection`. `MARKETPLACE_ADDRESS` should be set when an existing marketplace must register protected content. `EXISTING_ADMIN` is only for local/fork impersonation-style workflows; real testnet runs must be signed by the admin. |
| `CONTENT_PROTECTION_PROXY` | Required for `upgrade-content-protection`. |
| `CONTENT_PROTECTION_ADDRESS`, `STAKE_ASSET_ADDRESS`, `STAKE_ASSET_AMOUNT`, `STAKE_ASSET_SYMBOL` | Inputs for `set-content-protection-stake`. |
| `SHOW_CAMPAIGN_ESCROW_OWNER` | Optional owner/ops multisig for `deploy-show-campaign-escrow`; defaults to the deployer. |

Security guidance:

- Keep this workflow manual-only and environment-protected.
- Require at least one reviewer on `contracts-staging`.
- Restrict `contracts-staging` to trusted branches such as `main` and merge
  queue branches.
- Do not allow unreviewed workflow edits to reach branches that can deploy.
- Do not print private keys or write them to files; the workflow passes them
  only through environment variables consumed by Foundry scripts.
- Do not set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` in GitHub environments. It is
  reserved for local/fork commands that explicitly target `localhost`.
- Treat deployment artifacts as public operational metadata. They should not
  contain secrets.

The workflow can live in this repository with acceptable risk because the
secret boundary is the protected GitHub environment, not the YAML file itself.
Moving contract deployment to private `resonate-iac` is stronger operational
separation and is preferable if deployment authority should be held by a
smaller group than code authors, or if production/mainnet keys are introduced.
For the current testnet/staging flow, keeping the workflow beside the contract
code is simpler and avoids drift, provided the protections above are enabled.

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

`main` should be merged through Mergify's merge queue. In that mode, pull requests
get path-aware feedback, Mergify queue branches run the full validation suite once
for the combined batch, and the post-merge `main` push focuses on deployable image
publication plus deploy-manifest handoff. See
[`docs/operations/merge_queue_ci.md`](../operations/merge_queue_ci.md) for the
required branch protection settings, Mergify setup, and operator flow.

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
