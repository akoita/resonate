# Resonate Deployment Guide

Infrastructure-as-code for Resonate now lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).
This repository keeps the application code, smart contracts, and app-local helper scripts.

## Ownership Split

| Area | Repository |
| --- | --- |
| GCP Terraform, Cloud Run deploys, Docker Compose stacks, deploy env files, GitHub deploy workflow | `resonate-iac` |
| Backend, frontend, workers, smart contracts, contract deployment/config helpers | `resonate` |

## Local App Workflow

1. Start local infrastructure from `resonate-iac`.
2. Install app dependencies in this repo.
3. Run app-local commands from this repo:

```bash
cd contracts && ./scripts/install-deps.sh
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..

make backend-dev
make web-dev
```

Useful app-local targets that still live here:

| Command | Purpose |
| --- | --- |
| `make backend-dev` | Start the NestJS API on port `3000` |
| `make web-dev` | Start the Next.js frontend on port `3001` |
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

### Refresh local contract config

Use these commands after deploying to a local Anvil or a local Sepolia fork:

| Command | Purpose |
| --- | --- |
| `make local-aa-config` | Refresh AA addresses from the latest `DeployLocalAA` broadcast |
| `make local-aa-fork` | Configure `.env` files for a running Sepolia fork on `localhost:8545` |
| `make deploy-contracts` | Deploy protocol contracts to the local RPC and refresh app config |
| `make contracts-deploy-local` | Run AA deploy + protocol deploy against an already-running local stack |

## Infrastructure and Cloud Deployment

Use `resonate-iac` for all of the following:

- Terraform init/plan/apply/destroy
- Cloud Run deployment
- Docker Compose startup/shutdown
- GPU Demucs worker lifecycle
- Deploy environment files such as `.env.deploy.*`
- GitHub Actions deployment workflow configuration

## Environment Variables

Application env vars are still documented here when they affect app code or contract tooling.
Infrastructure-only variables now belong in `resonate-iac`.

Core app-side variables:

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Frontend | Defaults to `http://localhost:3001` in local app workflows |
| `NEXT_PUBLIC_CHAIN_ID` | Frontend | `31337` for local Anvil, `11155111` for Sepolia fork mode |
| `NEXT_PUBLIC_RPC_URL` | Frontend | Local RPC for fork/local AA flows |
| `RPC_URL` | Backend | RPC endpoint used by contract-aware backend flows |
| `SEPOLIA_RPC_URL` | Contracts / backend | Required for Sepolia deploys and forked workflows |
| `AGENT_KEY_ENCRYPTION_KEY` | Backend | Generate with `./backend/scripts/generate-agent-encryption-key.sh` for local KMS mode |
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

If these variables are deployed through infrastructure, define them in `resonate-iac` alongside the backend service environment configuration.
