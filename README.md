<div align="center">

# 🎵 Resonate

### On-chain music for artists, listeners, and agents.

**Programmable Stem IP • Human Studio • x402-native API • MCP Server**

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

Resonate is an on-chain music platform where artists publish programmable stem IP and both humans and AI agents can discover, license, and remix it. A machine-first API surface (x402-native, no-account checkout) keeps that same catalog usable by agents as they become first-class consumers alongside the human studio app.

Three first-class audiences, one catalog:

- **Artists** — upload releases, mint stems as NFTs, price them per-license type (personal / remix / commercial), and earn royalties via an on-chain payment splitter.
- **Listeners** — use a full music app: player, library, playlists, marketplace, an AI DJ that curates against the catalog, and curator-resolved dispute flows. Purchases are wallet-native; you own what you buy.
- **Agents** — hit storefront endpoints, inspect licensing-aware quotes, pay over HTTP with x402, and receive machine-readable purchase proof. No account, no OAuth, no dashboard.

### Copy-paste demo: discover -> quote -> pay -> receipt

Set a base URL, a stem ID, and an `X_PAYMENT` proof from the x402-capable client you use to settle the challenge. Raw `curl` is shown here so the underlying protocol stays visible.

```bash
export RESONATE_API_BASE="${RESONATE_API_BASE:-http://localhost:3000}"
export STEM_ID="<stem-id>"
export X_PAYMENT="<payment proof from your x402-capable client>"

curl "$RESONATE_API_BASE/openapi.json"
curl "$RESONATE_API_BASE/api/storefront/stems?limit=3"
curl "$RESONATE_API_BASE/api/storefront/stems/$STEM_ID"
```

```bash
curl "$RESONATE_API_BASE/api/stems/$STEM_ID/x402/info"
curl -i "$RESONATE_API_BASE/api/stems/$STEM_ID/x402"
```

```bash
curl -sS -D /tmp/resonate-headers.txt \
  -H "X-PAYMENT: $X_PAYMENT" \
  "$RESONATE_API_BASE/api/stems/$STEM_ID/x402" \
  -o /tmp/resonate-stem.mp3

node -e 'const fs = require("fs"); const raw = fs.readFileSync("/tmp/resonate-headers.txt", "utf8"); const line = raw.split("\\n").find((entry) => entry.toLowerCase().startsWith("x-resonate-receipt:")); if (!line) { throw new Error("Missing X-Resonate-Receipt header"); } const encoded = line.split(":").slice(1).join(":").trim(); const receipt = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); console.log(JSON.stringify(receipt, null, 2));'
```

Expected flow:

- `openapi.json` and `/api/storefront/stems` expose the discovery surface
- `/api/stems/:stemId/x402/info` returns storefront-grade quote metadata
- the first paid `curl` returns the `402 Payment Required` challenge
- the retried paid `curl` downloads the stem and returns a structured receipt in `X-Resonate-Receipt`
- the final `node` command decodes that receipt into JSON

If you use an x402-capable client such as AgentCash, it can automate the proof exchange for you. The raw `curl` path above is here so reviewers can inspect the underlying commerce surface directly.

### What the agent API surface gives you

- **Public discovery surfaces** — machine-readable catalog, quote, and pricing endpoints
- **MCP tools** — `catalog.search`, `stem.quote`, and `stem.download` over Streamable HTTP at `/mcp`
- **No-account checkout** — x402 payment flow over HTTP using USDC
- **Structured receipts** — purchase proof attached to successful paid downloads
- **Licensing-aware pricing** — personal, remix, and commercial pricing exposed for automation
- **Composable audio IP** — stems remain the core monetizable asset

### Product framing

- **Stems are the primitive** — pricing, receipts, remix lineage, and royalties all compose on top of stem NFTs
- **The app and the API are peers** — the human studio and the x402 storefront API both ride the same on-chain catalog; neither is a subset of the other
- **Why the agent surface matters** — as AI systems become catalog consumers, a commerce path that's just `curl` + USDC + a signed receipt (no dashboard, no account, no OAuth) lands on the right side of how agents actually buy

---

## 🏗️ Architecture

![Resonate deployment architecture](docs/architecture/resonate-deployment-architecture.svg)

Resonate is deployed as a full-stack music and agent-commerce system, not just a
web app. The core runtime combines:

- **Human studio** — Next.js app for artists, listeners, marketplace, wallet UX,
  uploads, playback, disputes, and curation.
- **Agent-native commerce** — public storefront, OpenAPI, MCP tools, x402 quote
  and paid download flow, and structured receipts.
- **GCP runtime** — Cloud Run frontend/backend/Demucs services, Pub/Sub stem
  jobs/results/DLQ, Cloud SQL, Redis, GCS, Secret Manager, Artifact Registry,
  VPC private connectivity, and Cloud Monitoring.
- **On-chain protocol** — ERC-4337 Kernel smart accounts, session keys, bundler,
  EntryPoint, `StemNFT`, `StemMarketplaceV2`, content protection, curation
  disputes, revenue escrow, and payment asset contracts.
- **Separate cloud delivery plane** — application CI publishes immutable images;
  [`resonate-iac`](https://github.com/akoita/resonate-iac) applies
  Terraform-managed environment releases.

See the [deployment architecture doc](docs/architecture/deployment_architecture.md)
for the editable Mermaid model, source references, and component inventory.

For a discoverable index of product and platform capabilities, see the
[feature catalog](docs/features/README.md). It is the first stop for what is
implemented, partial, planned, or retired, and links to usage/testing notes for
each durable feature.

---

## 🚀 Quick Start

### Prerequisites

| Tool                                    | Install                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| **Node.js** 18+                         | [nodejs.org](https://nodejs.org/) or `nvm install 18`         |
| **Docker**                              | [docker.com/get-started](https://www.docker.com/get-started/) |
| **Make**                                | Pre-installed on macOS/Linux; Windows: use WSL                |
| **Foundry** _(for contract deployment)_ | [getfoundry.sh](https://getfoundry.sh/)                       |

### Run Locally

Cloud/deployment infrastructure lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac). Local developer runtime lives in this repo: `make dev-up` starts Postgres, Redis, and the Pub/Sub emulator, while `make local-aa-fork` or `make local-aa-up` start the local Anvil + Alto stack.

> The default local workflow is expected to support release uploads with stem separation.
> That means the standard local setup includes the Demucs worker, not just backend/web/infra.
> The root README covers the important commands; the deeper worker-specific reference lives in
> [`workers/demucs/README.md`](workers/demucs/README.md).

Two AA modes are available — see [AA Integration](docs/account-abstraction/account-abstraction.md) for architecture and [Local AA Development](docs/account-abstraction/local-aa-development.md) for setup.

#### Forked Sepolia (recommended default — session keys, full AA)

```bash
# 0. Install dependencies (once per clone)
cd contracts && ./scripts/install-deps.sh
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..

# 1. Set env vars
export SEPOLIA_RPC_URL=https://sepolia.drpc.org

# 2. Start local runtime dependencies in this repo
make dev-up

# 3. Start the local Demucs worker so uploads work end-to-end
make worker-gpu

# 4. Start the Sepolia fork + bundler in this repo, then deploy protocol contracts
make local-aa-fork
make deploy-contracts

# 5. Start services (separate terminals)
make backend-dev     # NestJS API on port 3000; expects Postgres/Redis/PubSub from make dev-up
make web-dev-fork    # Next.js on port 3001 (chainId 11155111, local RPC)
```

> **Note:** `make local-aa-fork` starts a Sepolia fork on `localhost:8545`, starts the local Alto bundler on `localhost:4337`, and refreshes AA env vars for fork mode. Then `make deploy-contracts` deploys a fresh copy of the Resonate protocol contracts to that local fork and updates `backend/.env` and `web/.env.local` with those fork-local addresses. `make web-dev-fork` is the correct frontend command for this mode because it targets chain `11155111` while still using your local RPC at `localhost:8545`.

> **Recommendation:** Prefer this forked workflow for day-to-day development unless you specifically need isolated `31337` local-only behavior. It is the closest path to the intended production AA setup.

#### Local-Only (fallback / offline development)

```bash
# 1. Start local runtime dependencies, then deploy contracts here
make dev-up
make worker-gpu
make contracts-deploy-local  # Deploys AA + StemNFT + Marketplace + TransferValidator

# 2. Start services (separate terminals)
make backend-dev     # NestJS API on port 3000; expects Postgres/Redis/PubSub from make dev-up
make web-dev-local   # Next.js on port 3001 (chainId 31337)
```

### Stop & Clean

```bash
make db-reset        # Reset database (requires Docker running)
make dev-down        # Stop local Postgres, Redis, Pub/Sub emulator, and Demucs worker
make local-aa-down   # Stop the local Anvil + Alto runtime
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

The Demucs worker is part of the default local app workflow. GPU is the default (10-15x faster):

```bash
make worker-gpu
make worker-health
```

Useful worker commands:

- `make worker-gpu` auto-builds the GPU image if it does not exist yet (requires NVIDIA GPU + Container Toolkit)
- `make worker-up` CPU-only fallback if no GPU is available
- `make worker-logs` to stream logs
- `make worker-rebuild` to force a no-cache rebuild when the image is stale
- `make pubsub-init` only if the Pub/Sub emulator lost its topics/subscriptions after a reset

See [`workers/demucs/README.md`](workers/demucs/README.md) for the deeper Demucs-specific guide:
image internals, direct `docker build` / `docker run`, HTTP smoke tests, and extended troubleshooting.

**Performance comparison:**
| Hardware | 3-min song | Notes |
|----------|------------|-------|
| CPU (8 cores) | ~10 min | Fallback if no GPU available |
| NVIDIA GPU (RTX 3080) | ~45 sec | 10-15x faster |

**Model caching:** The ~52MB htdemucs_6s model is pre-downloaded during Docker build.

```bash
# Check worker health
make worker-health
```

### ⚡ GPU Prerequisites

If you run the local worker in GPU mode, stem separation drops from minutes to well under a minute on a supported card.

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
# Run against the local worker container
docker exec resonate-demucs-local nvidia-smi
```

**Troubleshooting:**

- Worker stays in "Created" state → Run `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`
- `nvidia-smi` fails → Reinstall NVIDIA Container Toolkit
- WSL2 users → Use NVIDIA driver for WSL, not native Linux driver
- Build hangs on apt-get → Run `make worker-rebuild` or use the deeper rebuild steps in [`workers/demucs/README.md`](workers/demucs/README.md)

See [`workers/demucs/README.md`](workers/demucs/README.md) for the full local worker guide, including
repo-local `docker build`, `docker run`, stale-image recovery, and "stuck on Separating..." troubleshooting.

### 🔧 Troubleshooting

| Symptom                                    | Cause                                                          | Fix                                                                          |
| ------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Container shows "Created" (not "Up")       | Port conflict — another container or process is using the port | Run `docker ps` to find the conflicting container, then `docker stop <name>` |
| Redis won't start (port 6379)              | Stale Redis from another project                               | Stop the conflicting container, then rerun `make dev-up` |
| Track stuck at "🔵 Pending" forever        | `PUBSUB_EMULATOR_HOST` missing from `backend/.env`             | Run `make pubsub-init` then restart backend; `make backend-dev` auto-adds it |
| Worker logs: "Subscription does not exist" | PubSub emulator has no topics (emulator restarted)             | Run `make pubsub-init`, then restart the worker with `make worker-gpu` |
| Track stuck at "🟡 Separating..."          | Demucs worker not running, stale image, or import errors       | Check `make worker-health`, then `make worker-logs`, then `make worker-rebuild` if needed |
| No progress % during separation            | Worker can't POST progress back to backend                     | Leave `BACKEND_URL` unset for local fallback or set it to a Docker-reachable backend URL |
| `SEPOLIA_RPC_URL` warning in Docker logs   | Env var not exported in the shell running the AA stack         | Export `SEPOLIA_RPC_URL=https://sepolia.drpc.org` before `make local-aa-fork` |

---

## 📖 Documentation

| Document                                                                   | Description                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [Project Specification](docs/rfc/RESONATE_SPECS.md)                        | Vision, architecture, and roadmap              |
| [Deployment Architecture](docs/architecture/deployment_architecture.md)     | GCP, smart account, blockchain, x402, and delivery topology |
| [Deployment Guide](docs/smart-contracts/deployment.md)                     | Repo split, contract deploys, and contract-adjacent local setup |
| [Environment Variables](docs/deployment/environment.md)                    | App runtime, observability, x402, and provider configuration |
| [Local AA Development](docs/account-abstraction/local-aa-development.md)   | Account abstraction setup guide                |
| [Demucs Worker](workers/demucs/README.md)                                  | GPU stem separation setup and troubleshooting  |
| [Core Contracts](docs/smart-contracts/core_contracts.md)                   | Stem NFT and marketplace contracts             |
| [Marketplace Integration](docs/smart-contracts/marketplace_integration.md) | Frontend/backend integration                   |
| [x402 Payments](docs/architecture/x402_payments.md)                        | Machine-to-machine stem purchases via x402     |
| [MCP Server](docs/architecture/mcp_server.md)                              | Tool discovery and client setup for agents     |
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
