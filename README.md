<div align="center">

# 🎵 Resonate

### The Agentic Audio Protocol

**Decentralized • AI-Native • Stem-Level Monetization**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Solidity](https://img.shields.io/badge/Solidity-363636?style=for-the-badge&logo=solidity&logoColor=white)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Foundry-1C1C1C?style=for-the-badge&logo=ethereum&logoColor=white)](https://book.getfoundry.sh/)

<br/>

> **🚧 Work in Progress** — This is an experimental project under active development. Not production-ready.

</div>

---

## 🌟 Overview

Resonate is a decentralized music streaming protocol where artists monetize audio **stems** (vocals, drums, bass) as programmable IP, and users deploy **AI agents** to curate, remix, and negotiate usage rights in real-time.

### Key Features

- **🎛️ Stem-Level IP** — Artists upload stems as ERC-1155 NFTs with granular licensing
- **🤖 AI Agent Wallets** — ERC-4337 smart accounts with autonomous micro-payment capabilities
- **💳 x402 Payments** — AI agents purchase stems via HTTP using USDC — no account required
- **💰 Transparent Royalties** — On-chain payment splitting with real-time analytics
- **🔀 Remix Engine** — Composable smart contracts for derivative works

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph Frontend
        Web[Next.js App]
    end

    subgraph Backend
        API[NestJS API]
        Worker[Demucs Worker]
        Redis[(Redis Queue)]
        PubSub[GCP Pub/Sub]
    end

    subgraph Blockchain
        AA[ERC-4337 Accounts]
        NFT[Stem NFTs]
        Split[Payment Splitter]
    end

    subgraph Storage
        DB[(PostgreSQL)]
        IPFS[IPFS/GCS]
    end

    Web --> API
    API --> DB
    API --> Redis
    API -->|stem-separate| PubSub
    PubSub -->|pull| Worker
    Worker -->|stem-results| PubSub
    PubSub -->|pull| API
    API --> AA
    Worker --> IPFS
    AA --> NFT
    NFT --> Split
```

---

## 🚀 Quick Start

### Prerequisites

| Tool                                    | Install                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| **Node.js** 18+                         | [nodejs.org](https://nodejs.org/) or `nvm install 18`         |
| **Docker**                              | [docker.com/get-started](https://www.docker.com/get-started/) |
| **Redis**                               | Starts via Docker (port 6379)                                 |
| **Make**                                | Pre-installed on macOS/Linux; Windows: use WSL                |
| **Foundry** _(for contract deployment)_ | [getfoundry.sh](https://getfoundry.sh/)                       |

### Run Locally

Two AA modes are available — see [AA Integration](docs/account-abstraction/account-abstraction.md) for architecture and [Local AA Development](docs/account-abstraction/local-aa-development.md) for setup.

#### Forked Sepolia (recommended — session keys, full AA)

```bash
# 1. Set env vars
export SEPOLIA_RPC_URL=https://sepolia.drpc.org

# 2. Start infrastructure (Postgres, Redis, Pub/Sub emulator, Demucs worker)
make dev-up                     # use `make dev-up-build` after worker code changes
                                # check the container status summary — all should show ✅
make local-aa-fork              # Forks Sepolia, configures .env (AA infra already on-chain)
make deploy-contracts           # Configures .env with Sepolia contract addresses
                                # (contracts already exist on the fork — no new deployment)

# 3. Start services (separate terminals)
make backend-dev     # NestJS API on port 3000
make web-dev-fork    # Next.js on port 3001 (chainId 11155111, local RPC)
```

> **Note:** On a Sepolia fork, `make deploy-contracts` detects the fork and uses the existing Sepolia deployment addresses from `contracts/deployments/sepolia.json` — no new contracts are deployed. For local-only mode (chain 31337), it deploys fresh contracts via Forge.

#### Local-Only (offline, no internet required)

```bash
# 1. Deploy everything (Docker + Anvil + all contracts)
# This starts Postgres, Redis, Pub/Sub emulator, and Demucs worker
make dev-up
make contracts-deploy-local  # Deploys AA + StemNFT + Marketplace + TransferValidator

# 2. Start services (separate terminals)
make backend-dev     # NestJS API on port 3000
make web-dev-local   # Next.js on port 3001 (chainId 31337)

# 3. (Optional) View Demucs worker logs
docker compose logs -f demucs-worker
```

### Stop & Clean

```bash
make db-reset        # Reset database (requires Docker running)
make dev-down        # Stop Docker containers
make local-aa-down   # Stop Anvil + bundler
```

### 📤 Upload Processing Flow

When an artist uploads a release, the following pipeline executes:

```
Upload → Validation → Pub/Sub → Stem Separation → Encryption → Storage → Ready
```

| Stage        | Status | Description                            |
| ------------ | ------ | -------------------------------------- |
| `pending`    | 🔵     | Track queued for processing            |
| `separating` | 🟡     | Demucs AI splitting audio into 6 stems |
| `uploading`  | 🟡     | Uploading stems to IPFS/storage        |
| `complete`   | 🟢     | Ready for playback and minting         |
| `failed`     | 🔴     | Processing error (check worker logs)   |

**Stems generated:** vocals, drums, bass, guitar, piano, other

The release page displays track status in real-time, with stems appearing as they complete processing.

### 🎛️ AI Stem Separation (Demucs)

The Demucs worker uses Facebook's [htdemucs_6s](https://github.com/facebookresearch/demucs) model to separate audio into 6 stems: **vocals, drums, bass, guitar, piano, other**.

> **GPU acceleration is enabled by default** — `make dev-up` launches the worker with NVIDIA GPU support via `docker-compose.gpu.yml`.

**Performance comparison:**
| Hardware | 3-min song | Notes |
|----------|------------|-------|
| CPU (8 cores) | ~10 min | Fallback if no GPU available |
| NVIDIA GPU (RTX 3080) | ~45 sec | 10-15x faster |

**Model caching:** The ~52MB htdemucs_6s model is pre-downloaded during Docker build.

```bash
# View worker logs
make worker-logs

# Check worker health
make worker-health

# Rebuild worker (after code changes)
make worker-rebuild

# Quick build (skip model pre-cache, downloads on first use)
make worker-quick-build
```

### ⚡ GPU Prerequisites

`make dev-up` attempts GPU mode first. If the worker fails to start (no NVIDIA runtime), it **automatically falls back to CPU mode** — no manual intervention needed. CPU mode works but stem separation takes ~3min instead of ~30s.

To enable GPU acceleration:

1. **NVIDIA GPU** with CUDA support
2. **[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)**

<details>
<summary>📋 NVIDIA Container Toolkit Installation (Ubuntu/Debian/WSL2)</summary>

```bash
# Add NVIDIA package repository
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# Install and configure
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify installation
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

</details>

**Verify GPU in worker:**

```bash
docker compose exec demucs-worker nvidia-smi
```

**Troubleshooting:**

- Worker stays in "Created" state → Run `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`
- `nvidia-smi` fails → Reinstall NVIDIA Container Toolkit
- WSL2 users → Use NVIDIA driver for WSL, not native Linux driver
- Build hangs on apt-get → Rebuild with `make worker-rebuild` (fixed via `DEBIAN_FRONTEND=noninteractive`)

See [`workers/demucs/README.md`](workers/demucs/README.md) for full worker documentation.

### 🔧 Troubleshooting

| Symptom                                    | Cause                                                          | Fix                                                                          |
| ------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Container shows "Created" (not "Up")       | Port conflict — another container or process is using the port | Run `docker ps` to find the conflicting container, then `docker stop <name>` |
| Redis won't start (port 6379)              | Stale Redis from another project                               | `docker stop <old-redis-container>` then `make dev-up`                       |
| Track stuck at "🔵 Pending" forever        | `PUBSUB_EMULATOR_HOST` missing from `backend/.env`             | Run `make pubsub-init` then restart backend; `make backend-dev` auto-adds it |
| Worker logs: "Subscription does not exist" | PubSub emulator has no topics (emulator restarted)             | Run `make pubsub-init` then `docker restart resonate2-demucs-worker-1`       |
| Track stuck at "🟡 Separating..."          | Demucs worker not running or import errors                     | Check `make worker-logs` for errors; rebuild with `make worker-rebuild`      |
| No progress % during separation            | Worker can't POST progress back to backend                     | Verify `BACKEND_URL=http://host.docker.internal:3000` in `backend/.env`      |
| `SEPOLIA_RPC_URL` warning in Docker logs   | Env var not exported in current shell                          | Run `export SEPOLIA_RPC_URL=https://sepolia.drpc.org` before `make dev-up`   |

---

## 📖 Documentation

| Document                                                                   | Description                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [Project Specification](docs/rfc/RESONATE_SPECS.md)                        | Vision, architecture, and roadmap              |
| [Deployment Guide](docs/smart-contracts/deployment.md)                     | Infrastructure, storage, and environment setup |
| [Local AA Development](docs/account-abstraction/local-aa-development.md)   | Account abstraction setup guide                |
| [Demucs Worker](workers/demucs/README.md)                                  | GPU stem separation setup and troubleshooting  |
| [Core Contracts](docs/smart-contracts/core_contracts.md)                   | Stem NFT and marketplace contracts             |
| [Marketplace Integration](docs/smart-contracts/marketplace_integration.md) | Frontend/backend integration                   |
| [x402 Payments](docs/architecture/x402_payments.md)                        | Machine-to-machine stem purchases via x402     |
| [Contributing](CONTRIBUTING.md)                                            | Contribution guidelines                        |

---

## 🛠️ Tech Stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Frontend       | Next.js 15, TanStack Query, Viem/Wagmi          |
| Backend        | NestJS, Prisma, BullMQ, GCP Pub/Sub, PostgreSQL |
| Blockchain     | Solidity, Foundry, ERC-4337, ZeroDev            |
| AI             | Demucs (htdemucs_6s), Vertex AI                 |
| Infrastructure | Docker, Redis, GCP Pub/Sub, GitHub Actions      |

---

## 📄 License

MIT © 2024-2026
