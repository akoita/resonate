# Getting Started — Development Setup

This guide walks you through setting up a local Resonate development
environment from a fresh clone to a running stack.

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 22.12+ | Runtime for backend + frontend |
| [Docker](https://docs.docker.com/get-docker/) | Latest | Postgres, Redis, Pub/Sub emulator, Demucs worker |
| [Make](https://www.gnu.org/software/make/) | Any | Orchestration shortcuts (`Makefile`) |
| [Foundry](https://book.getfoundry.sh/) | Latest | Smart-contract compilation and local Anvil chain |

## Install Dependencies

```bash
# Smart contracts
cd contracts && npm install && cd ..

# Backend
cd backend && npm install && npx prisma generate && cd ..

# Frontend (web)
cd web && npm install && cd ..

# Desktop (optional)
cd desktop && npm install && cd ..
```

## Account Abstraction Modes

Resonate supports two local Account Abstraction (AA) modes. Pick the one that
fits your workflow.

### Forked Sepolia (recommended)

This mode forks Sepolia so your local chain uses chain ID `11155111` and
inherits real Sepolia state. It is the closest path to the intended production
AA setup.

```bash
# 1. Start the Sepolia fork + local bundler
make local-aa-fork

# 2. Deploy contracts to the fork
make deploy-contracts

# 3. Start infrastructure (Postgres, Redis, Pub/Sub emulator)
make dev-up

# 4. Start backend
make backend-dev

# 5. Start frontend (fork mode)
make web-dev-fork
```

> [!NOTE]
> `make local-aa-fork` starts a Sepolia fork on `localhost:8545`, starts the
> local Alto bundler on `localhost:4337`, and refreshes AA env vars for fork
> mode. Then `make deploy-contracts` deploys a fresh copy of the Resonate
> protocol contracts to that local fork and updates `backend/.env` and
> `web/.env.local` with those fork-local addresses. `make web-dev-fork` is the
> correct frontend command for this mode because it targets chain `11155111`
> while still using your local RPC at `localhost:8545`.

> [!TIP]
> Prefer this forked workflow for day-to-day development unless you specifically
> need isolated `31337` local-only behavior.

> [!IMPORTANT]
> Cloud/deployment infrastructure lives in
> [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac). Local
> developer runtime lives in this repo.

### Local-Only (chain ID 31337)

Use this mode when you need a fully isolated local chain with no external
dependencies.

```bash
# 1. Start local Anvil chain + bundler
make local-aa-up

# 2. Deploy contracts
make deploy-contracts

# 3. Start infrastructure
make dev-up

# 4. Start backend
make backend-dev

# 5. Start frontend (local mode)
make web-dev
```

## Demucs Worker Integration

The default local workflow includes the Demucs worker for end-to-end release
uploads with stem separation. The worker runs as a Docker container and
processes audio separation jobs via Pub/Sub.

```bash
# Start the Demucs worker (GPU-accelerated)
make worker-gpu

# Check worker health
make worker-health
```

See [`workers/demucs/README.md`](../workers/demucs/README.md) for the full
GPU setup guide, image rebuilds, and worker-specific troubleshooting.

## Stop & Clean

```bash
# Reset the database (wipes Postgres data and re-runs migrations)
make db-reset

# Stop infrastructure containers (Postgres, Redis, Pub/Sub)
make dev-down

# Stop AA stack (Anvil + bundler)
make local-aa-down
```

## Port Conventions

| Service | Port |
| --- | --- |
| Backend (NestJS) | 3000 |
| Frontend (Next.js) | 3001 |
| Demucs Worker | 8000 |
| Anvil (local chain) | 8545 |
| AA Bundler (Alto) | 4337 |

## Further Reading

- [Account Abstraction overview](account-abstraction/account-abstraction.md)
- [Local AA development guide](account-abstraction/local-aa-development.md)
- [Troubleshooting](troubleshooting.md)
- [Main README](../README.md)
