# Local Account Abstraction Development

This repository still owns the AA smart contracts, config update scripts, and app runtime.
The local infrastructure stack that used to live here now lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).

## What Runs Where

| Concern | Repository |
| --- | --- |
| Postgres, Redis, Pub/Sub emulator | `resonate` |
| Anvil, Alto bundler, Demucs worker | environment-specific / see local runtime notes |
| AA contracts, protocol contracts, backend, frontend, env refresh helpers | `resonate` |

## Prerequisites

- Docker
- Node.js 20+
- Foundry (`forge`, `cast`)
- `jq`
- Local runtime basics started with `make dev-up` from `resonate`

## Install App Dependencies

```bash
cd contracts && ./scripts/install-deps.sh
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..
```

## Forked Sepolia Mode

This is the preferred development workflow.

Use this mode when you already have:

- a Sepolia fork on `http://localhost:8545`
- a bundler on `http://localhost:4337`
- local Postgres / Redis / PubSub started via `make dev-up`

```bash
export SEPOLIA_RPC_URL=https://sepolia.drpc.org

make dev-up
make local-aa-fork
make deploy-contracts

make backend-dev
make web-dev-fork
```

`make local-aa-fork` only refreshes local `.env` files for fork mode. Keep using `make web-dev-fork` afterward so the frontend stays on chain `11155111`.

## Local-Only Mode

Use this only when you explicitly want a plain `31337` local environment or need offline development.

Use this mode when you already have a plain local Anvil + bundler:

```bash
make dev-up
make contracts-deploy-local

make backend-dev
make web-dev-local
```

`make contracts-deploy-local` runs:

1. `make local-aa-deploy`
2. `make deploy-contracts`

It assumes `localhost:8545` is already available.

## Config Refresh Helpers

The config scripts now live under `contracts/scripts/`:

| Script | Purpose |
| --- | --- |
| `contracts/scripts/update-aa-config.sh` | Refresh AA addresses in `backend/.env` and `web/.env.local` |
| `contracts/scripts/update-protocol-config.sh` | Refresh protocol contract addresses in app env files |
| `contracts/scripts/deploy-sepolia.sh` | Deploy protocol contracts to Sepolia |

You can run the helpers directly if needed:

```bash
./contracts/scripts/update-aa-config.sh
./contracts/scripts/update-aa-config.sh --mode fork
./contracts/scripts/update-protocol-config.sh
```

## Local App Commands

| Command | Purpose |
| --- | --- |
| `make backend-dev` | Start NestJS on port `3000` |
| `make web-dev-local` | Start Next.js against local Anvil (`31337`) |
| `make web-dev-fork` | Start Next.js against a Sepolia fork (`11155111`) |
| `make pubsub-init` | Recreate emulator topics/subscriptions |
| `make worker-health` | Check Demucs worker health |

## Troubleshooting

### Bundler or RPC mismatch

If your app env files are out of sync with the running local RPC or bundler:

```bash
make local-aa-config
make deploy-contracts
```

### Stale frontend contract addresses

`make deploy-contracts`, `make web-dev-local`, and `make web-dev-fork` clear `web/.next` before startup. If you manually edit `web/.env.local`, remove `web/.next/` before restarting the frontend.

### Pub/Sub emulator lost its topics

```bash
make pubsub-init
```

### Infra lifecycle

Start, stop, rebuild, and inspect the Dockerized local stack from `resonate-iac`, not from this repo.
