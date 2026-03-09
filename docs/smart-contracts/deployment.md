# Resonate — Deployment Guide

> **⚠️ Security**: Never commit private keys, API keys, or passwords to this repository.
> All sensitive values are managed via GCP Secret Manager and environment variables.

## Quick Reference

| Command               | Description                         |
| --------------------- | ----------------------------------- |
| `make docker-build`   | Build Docker images locally         |
| `make docker-up`      | Start production-like stack locally |
| `make docker-down`    | Stop production stack               |
| `make deploy-sepolia` | Deploy contracts to Sepolia testnet |
| `make infra-init`     | Initialize Terraform                |
| `make infra-plan`     | Preview infrastructure changes      |
| `make infra-apply`    | Apply infrastructure changes        |
| `make infra-destroy`  | Tear down all GCP infrastructure    |
| `make worker-health`  | Check Demucs worker health          |
| `make worker-gpu`     | Start Demucs worker with GPU        |

---

## Local Development

### Prerequisites

- Node.js 20+, Docker, npm
- (Optional) NVIDIA GPU + [Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) for GPU acceleration

### Quick Start

```bash
# 1. Start infrastructure (Postgres, Redis, Pub/Sub, Demucs worker)
make dev-up           # first time, or after worker code changes: make dev-up-build

# 2. Set up backend (first time: copy .env)
cp backend/.env.example backend/.env
make backend-dev    # runs migrations + dev server on :3000

# 3. Start frontend
make web-dev        # Next.js dev server on :3001
```

> **Note:** `make dev-up` always rebuilds Docker images to pick up code changes.
> Use `make dev-up-quick` to skip rebuilds when you know images are current.

### Useful Commands

| Command               | Description                                    |
| --------------------- | ---------------------------------------------- |
| `make dev-up`         | Start infra (Postgres, Redis, Pub/Sub, Demucs) |
| `make dev-up-build`   | Start infra + rebuild Docker images            |
| `make dev-down`       | Stop all services + remove volumes             |
| `make backend-dev`    | Backend dev server (:3000)                     |
| `make web-dev`        | Frontend dev server (:3001)                    |
| `make worker-health`  | Check Demucs worker status                     |
| `make worker-logs`    | Tail Demucs worker logs                        |
| `make worker-rebuild` | Rebuild worker image (no-cache)                |
| `make db-reset`       | Reset database (drops all data)                |

---

## Architecture Overview

```mermaid
graph TB
    subgraph Internet
        DEV["Developer Browser"]
    end

    subgraph "GCP Project"
        subgraph "Edge Layer"
            IAP["Identity-Aware Proxy<br/>Google account auth"]
        end

        subgraph "Cloud Run Services"
            FE["Frontend<br/>Next.js standalone<br/>Port 3000"]
            BE["Backend<br/>NestJS + Prisma<br/>Port 3000"]
        end

        subgraph "GPU Worker"
            DW["Demucs Worker<br/>FastAPI + Pub/Sub Consumer<br/>GCE T4 GPU :8000"]
        end

        subgraph "Private VPC — 10.0.0.0/20"
            VPCC["VPC Connector<br/>10.8.0.0/28"]
            SQL[("Cloud SQL<br/>PostgreSQL 16<br/>Private IP only")]
            REDIS[("Memorystore<br/>Redis 7<br/>Private IP only")]
        end

        subgraph "Storage"
            GCS[("GCS Bucket<br/>Stem files")]
            SM["Secret Manager<br/>JWT, DB pass, API keys"]
            AR["Artifact Registry<br/>Docker images"]
        end
    end

    subgraph "External Services"
        SEP["Sepolia Testnet<br/>Alchemy RPC"]
        IPFS["Lighthouse IPFS"]
        ZD["ZeroDev<br/>ERC-4337 Bundler"]
    end

    subgraph "CI/CD"
        GH["GitHub Actions<br/>Workload Identity Federation"]
    end

    DEV -->|"Authenticated only"| IAP
    IAP --> FE
    IAP --> BE
    FE -->|"NEXT_PUBLIC_API_URL"| BE
    BE --> VPCC
    VPCC --> SQL
    VPCC --> REDIS
    BE -->|"Pub/Sub: stem-separate"| PS["GCP Pub/Sub"]
    PS -->|"Pull subscription"| DW
    DW -->|"Pub/Sub: stem-results"| PS
    PS -->|"Pull subscription"| BE
    DW -->|"Upload stems"| GCS
    BE -->|"Download stems"| GCS
    BE -->|"RPC_URL"| SEP
    BE -->|"IPFS upload/pin"| IPFS
    FE -->|"Passkey auth"| ZD
    SM -.->|"Secrets injected"| BE
    GH -->|"Build + Push"| AR
    GH -->|"Deploy"| FE
    GH -->|"Deploy"| BE
```

### Backend Module Architecture

The NestJS backend is organized into 20+ modules. Here are the main components grouped by domain:

```mermaid
graph LR
    subgraph "Core Services"
        AUTH["Auth<br/>JWT + Passkeys"]
        IDENTITY["Identity<br/>User profiles, wallets"]
        CATALOG["Catalog<br/>Releases, tracks, stems"]
        LIBRARY["Library<br/>User collections"]
    end

    subgraph "AI & Audio Pipeline"
        INGESTION["Ingestion<br/>Upload → BullMQ queue<br/>→ Pub/Sub → Demucs<br/>→ encrypt → store"]
        CURATION["Curation<br/>AI agent for release<br/>quality scoring"]
        EMBEDDINGS["Embeddings<br/>Audio feature vectors"]
        AGENTS["Agents<br/>ADK / Vertex AI<br/>runtime adapter"]
    end

    subgraph "Web3 Layer"
        CONTRACTS["Contracts<br/>StemNFT, Marketplace<br/>event indexing"]
        PAYMENTS["Payments<br/>On-chain transactions"]
        PRICING["Pricing<br/>Dynamic stem pricing"]
    end

    subgraph "Platform"
        STORAGE["Storage<br/>Local / IPFS / GCS<br/>provider abstraction"]
        ENCRYPTION["Encryption<br/>Stem encryption<br/>access control"]
        SESSIONS["Sessions<br/>WebSocket gateway<br/>real-time events"]
        ANALYTICS["Analytics<br/>Play counts, trends"]
        RECOMMENDATIONS["Recommendations<br/>Personalized discovery"]
    end

    INGESTION -->|"separate audio"| AGENTS
    INGESTION -->|"encrypt stems"| ENCRYPTION
    INGESTION -->|"upload files"| STORAGE
    INGESTION -->|"emit events"| SESSIONS
    CATALOG -->|"read/write"| STORAGE
    CONTRACTS -->|"index events"| CATALOG
    CURATION -->|"score releases"| AGENTS
```

#### Module Responsibilities

| Module              | Purpose                                                  | Key Files                                                                                             |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Ingestion**       | Upload → queue → Pub/Sub → Demucs → encrypt → store      | `ingestion.service.ts`, `stems.processor.ts`, `stem-pubsub.publisher.ts`, `stem-result.subscriber.ts` |
| **Catalog**         | CRUD for releases, tracks, stems                         | `catalog.service.ts`, `catalog.controller.ts`                                                         |
| **Auth**            | JWT tokens, passkey verification, role guards            | `auth.service.ts`, `roles.guard.ts`                                                                   |
| **Identity**        | User profiles, wallet linking, artist onboarding         | `identity.service.ts`                                                                                 |
| **Contracts**       | On-chain StemNFT minting, marketplace ops, event indexer | `contracts.service.ts`, `indexer.service.ts`                                                          |
| **Trust**           | Creator trust tiers, stake requirements, clean history   | `trust.service.ts`, `trust.controller.ts`                                                             |
| **Fingerprint**     | Audio fingerprinting for content protection              | `fingerprint.service.ts`, `fingerprint.controller.ts`                                                 |
| **Storage**         | Abstraction over Local / Lighthouse IPFS providers       | `storage_provider.ts`, `local_storage_provider.ts`                                                    |
| **Encryption**      | Stem-level encryption with access control metadata       | `encryption.service.ts`                                                                               |
| **Sessions**        | WebSocket gateway for real-time progress & events        | `events.gateway.ts`                                                                                   |
| **Agents**          | AI runtime adapter (ADK / Vertex / LangGraph / local)    | `agent_runtime.service.ts`, `adk_adapter.ts`                                                          |
| **Curation**        | AI-powered release quality scoring                       | `curation.service.ts`                                                                                 |
| **Payments**        | Transaction handling for stem purchases                  | `payments.service.ts`                                                                                 |
| **Pricing**         | Dynamic stem pricing with edition strategies             | `stem-pricing.service.ts`                                                                             |
| **Recommendations** | Personalized music discovery                             | `recommendations.service.ts`                                                                          |
| **Analytics**       | Play counts, trending stems, artist stats                | `analytics.service.ts`                                                                                |

#### Storage Provider Configuration

The storage layer is abstracted via `StorageProvider` (`backend/src/modules/storage/`). All providers implement the same interface (`upload`, `download`, `delete`), so they're fully interchangeable.

Set the backend env var `STORAGE_PROVIDER` to choose which provider to use:

| Value                | Provider                    | Status                     | Description                                                            |
| -------------------- | --------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `local` (default)    | `LocalStorageProvider`      | ✅ Production-ready (dev)  | Stores files in `backend/uploads/stems/`. No config needed.            |
| `ipfs` or `filecoin` | `LighthouseStorageProvider` | ⚠️ Functional with caveats | Uploads to Lighthouse (IPFS/Filecoin pinning). Returns `ipfs://` CIDs. |
| `gcs`                | `GcsStorageProvider`        | ⚠️ Functional with caveats | Google Cloud Storage via JSON API. Auth via GCE metadata server.       |

**Environment variables by provider:**

| Variable             | Provider | Required | Description                                                                                          |
| -------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`   | All      | No       | Provider selection: `local`, `ipfs`, `filecoin`, `gcs`. Default: `local`                             |
| `LIGHTHOUSE_API_KEY` | IPFS     | **Yes**  | Lighthouse Web3 SDK API key. Get one at [files.lighthouse.storage](https://files.lighthouse.storage) |
| `GCS_STEMS_BUCKET`   | GCS      | No       | GCS bucket name. Default: `resonate-stems-dev`                                                       |

**Known gaps:**

| Provider | Issue                                                                   | Impact                                      |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| **IPFS** | Returns mock CIDs if `LIGHTHOUSE_API_KEY` is missing instead of failing | Stems appear "stored" but are unplayable    |
| **IPFS** | `delete()` is a no-op stub                                              | Minor — IPFS content is immutable by design |
| **GCS**  | Returns `provider: 'local'` instead of `'gcs'` in `StorageResult`       | Misleading provider tracking in DB          |
| **GCS**  | `StorageResult` type doesn't include `'gcs'` as valid provider          | TypeScript type safety gap                  |
| **GCS**  | Auth only works on GCE/Cloud Run (metadata server)                      | Cannot test GCS locally without emulator    |

> **Note:** Stem URIs and artwork URLs are stored as **relative paths** in the database (e.g., `/catalog/stems/{id}/blob`).
> The frontend prepends `API_BASE` for browser access, and the NFT metadata controller prepends `BACKEND_URL` for on-chain consumers.
> IPFS URIs (`ipfs://...`) are the exception — they pass through as absolute gateway URLs.

### Security Layers

| Layer                  | Mechanism                              | Detail                                                       |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------ |
| **External access**    | IAP (Identity-Aware Proxy)             | Only whitelisted Google accounts — no VPN needed             |
| **Service networking** | VPC connector + private IPs            | Cloud SQL and Redis have zero public exposure                |
| **Secrets**            | GCP Secret Manager                     | Injected at runtime, never in env vars or code               |
| **Agent key encrypt**  | AES-256-GCM / GCP Cloud KMS            | Private keys encrypted at rest, zeroed from memory after use |
| **Agent key audit**    | KeyAuditLog (append-only)              | Every decrypt, sign, rotate, and revoke is logged            |
| **Docker images**      | Private Artifact Registry              | Not publicly accessible                                      |
| **CI/CD auth**         | Workload Identity Federation           | Keyless GitHub → GCP, no service account JSON                |
| **Network firewall**   | Deny-all ingress + internal-only allow | Custom VPC, no default network                               |
| **Database**           | Daily backups + PITR                   | Point-in-time recovery, 7-day retention                      |

> See [Agent Wallet Security](agent-wallet-security.md) for encryption setup, key rotation, and audit logging.

---

## Phase 1: Deploy Contracts to Sepolia

### Prerequisites

1. Fund the deployer wallet with Sepolia ETH (check the address with `cast wallet address $PRIVATE_KEY`)
   - Faucet: https://www.alchemy.com/faucets/ethereum-sepolia
   - Minimum: 0.05 ETH recommended
2. Get a Sepolia RPC URL (free): https://dashboard.alchemy.com
3. Get an Etherscan API key (free): https://etherscan.io/myapikey

### Deploy

```bash
# Set environment variables (NEVER commit these)
export PRIVATE_KEY=<your-deployer-private-key>
export SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>
export ETHERSCAN_API_KEY=<your-etherscan-key>

# Run deployment
make deploy-sepolia
```

The script will:

1. Check deployer wallet balance
2. Deploy TransferValidator (module)
3. Deploy ContentProtection as UUPS proxy (implementation + ERC1967Proxy)
4. Deploy RevenueEscrow (with escrow period)
5. Deploy StemNFT and StemMarketplaceV2 (core)
6. Configure: link modules (validator ↔ StemNFT, ContentProtection ↔ StemNFT, ContentProtection ↔ TransferValidator, marketplace whitelist)
7. Verify contracts on Etherscan
8. Save addresses to `contracts/deployments/sepolia.json`
9. Update `backend/.env` and `web/.env.local` with new addresses

**Environment variables** (set before deploy):

| Variable           | Default      | Description                             |
| ------------------ | ------------ | --------------------------------------- |
| `STAKE_AMOUNT`     | `0.01 ether` | Default stake for new creators          |
| `ESCROW_PERIOD`    | `30 days`    | Revenue escrow hold duration            |
| `FEE_RECIPIENT`    | Deployer     | Protocol fee + slash treasury recipient |
| `PROTOCOL_FEE_BPS` | `250` (2.5%) | Marketplace fee in basis points         |

See [contracts/README.md](../../contracts/README.md) for full env vars, `cast` admin commands, and upgrade instructions.

---

## Phase 2: Provision GCP Infrastructure

### Prerequisites

1. Install `gcloud` CLI: https://cloud.google.com/sdk/docs/install
2. Install `terraform` (>= 1.5): https://developer.hashicorp.com/terraform/install
3. Ensure billing is enabled on your GCP project

### Step 1: Authenticate with GCP

```bash
# Login to gcloud (opens browser)
gcloud auth login

# Set your project (must match project_id in terraform.tfvars)
gcloud config set project YOUR_GCP_PROJECT_ID

# Set Application Default Credentials (used by Terraform)
gcloud auth application-default login

# Configure Docker to push to Artifact Registry
gcloud auth configure-docker europe-west1-docker.pkg.dev --quiet
```

> **⚠️ Token Expiry**: If any step fails with auth errors, re-run
> `gcloud auth login` and `gcloud auth application-default login`.
> Tokens expire after ~1 hour of inactivity.

### Step 2: Configure Terraform Variables

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
# Edit terraform.tfvars with your actual values (it's gitignored)
```

### Step 3: Create Registry & Network (partial apply)

Cloud Run requires Docker images to exist before deployment.
First, provision the Artifact Registry so you can push images:

```bash
make infra-init

# Apply ONLY the registry + core infra (before pushing images)
terraform -chdir=infra/terraform apply -target=google_artifact_registry_repository.docker
```

### Step 4: Build & Push Docker Images

```bash
# Get your registry URL
REGISTRY=$(terraform -chdir=infra/terraform output -raw docker_registry)

# Build and push backend
docker build -t $REGISTRY/backend:latest -f backend/Dockerfile backend/
docker push $REGISTRY/backend:latest

# Build and push frontend
# ⚠️ NEXT_PUBLIC_* vars are compile-time in Next.js — must be passed as --build-arg
BACKEND_URL=$(terraform -chdir=infra/terraform output -raw backend_url)
docker build -t $REGISTRY/frontend:latest \
  --build-arg NEXT_PUBLIC_API_URL="$BACKEND_URL" \
  --build-arg NEXT_PUBLIC_ZERODEV_PROJECT_ID="<your-zerodev-project-id>" \
  --build-arg NEXT_PUBLIC_CHAIN_ID="11155111" \
  --build-arg NEXT_PUBLIC_STEM_NFT_ADDRESS="$(terraform -chdir=infra/terraform output -raw stem_nft_address 2>/dev/null)" \
  --build-arg NEXT_PUBLIC_MARKETPLACE_ADDRESS="$(terraform -chdir=infra/terraform output -raw marketplace_address 2>/dev/null)" \
  -f web/Dockerfile web/
docker push $REGISTRY/frontend:latest
```

### Step 5: Apply Full Infrastructure

Now that images exist in the registry, deploy everything:

```bash
make infra-plan    # review what will be created
make infra-apply   # provisions all GCP resources (~20 min first time)
```

> **Note**: Cloud SQL creation takes 15–20 minutes. If the apply times out
> or fails with auth errors, re-authenticate and re-run `make infra-apply` —
> Terraform resumes from where it left off.

### What Gets Created

- **VPC** with private subnet and VPC connector
- **Cloud SQL** PostgreSQL 16 (private IP, daily backups)
- **Memorystore** Redis 7 (private network)
- **Artifact Registry** for Docker images
- **Cloud Run** backend + frontend services
- **Secret Manager** entries for all sensitive config
- **IAP** access control (Google account auth)
- **Monitoring** uptime checks + alerts
- **Workload Identity Federation** for CI/CD

### Updating Deployments

After the initial setup, to deploy new code:

```bash
REGISTRY=$(terraform -chdir=infra/terraform output -raw docker_registry)

# Rebuild and push updated backend
docker build -t $REGISTRY/backend:latest -f backend/Dockerfile backend/
docker push $REGISTRY/backend:latest

# Update the Cloud Run service
gcloud run services update resonate-dev-backend \
  --image=$REGISTRY/backend:latest \
  --region=europe-west1
```

> **Note**: For frontend rebuilds, remember to pass `--build-arg` flags
> (see Step 4 above). `NEXT_PUBLIC_*` vars are baked in at compile time.

---

## Phase 3: CI/CD (Automatic After Setup)

Once Terraform is applied, CI/CD is automatic:

1. Push to `main` → CI runs (lint, test, build)
2. CI passes → Deploy workflow triggers
3. Docker images built and pushed to Artifact Registry
4. Cloud Run services updated with new images

### GitHub Secrets Required

Set these in GitHub → Settings → Secrets → Actions:

| Secret             | Description                    | How to Get                          |
| ------------------ | ------------------------------ | ----------------------------------- |
| `GCP_WIF_PROVIDER` | Workload Identity Provider ID  | `terraform output -raw` after apply |
| `GCP_SA_EMAIL`     | GitHub Actions service account | `terraform output -raw` after apply |

---

## Teardown

```bash
# Destroy all GCP resources
make infra-destroy

# This removes: Cloud Run, Cloud SQL, Redis, VPC, secrets, monitoring, IAP
# ⚠️ Database data will be lost — ensure backups if needed
```

---

## Demucs CPU Worker (Cloud Run)

The Demucs stem separation worker can run on Cloud Run with CPU only. Slower than GPU (~5–10 min/track) but no GPU quota needed.

### Enable

Add to `infra/terraform/terraform.tfvars`:

```hcl
demucs_cpu_enabled = true
gcs_stems_bucket   = "resonate-stems-dev"  # unique bucket name
```

### Deploy

```bash
# 1. Apply Terraform (creates Cloud Run service + GCS bucket)
make infra-apply

# 2. Build and push CPU Docker image
REGISTRY=$(terraform -chdir=infra/terraform output -raw docker_registry)
docker build -t $REGISTRY/demucs-worker:latest -f workers/demucs/Dockerfile workers/demucs/
docker push $REGISTRY/demucs-worker:latest

# 3. Update the Cloud Run service with new image
gcloud run services update resonate-dev-demucs \
  --image=$REGISTRY/demucs-worker:latest \
  --region=europe-west1

# 4. Verify deployment
curl -s $(terraform -chdir=infra/terraform output -raw demucs_worker_url)/health
# Should return: {"status":"ok","storage_mode":"gcs"}
```

The backend communicates with the worker via **GCP Pub/Sub** (event-driven, Phase 2). Legacy HTTP mode is available via `STEM_PROCESSING_MODE=sync` and `DEMUCS_WORKER_URL` (set in `backend-service.tf`).

> **⚠️ Container Port**: The worker listens on port 8000 (configured in Terraform via `container_port`). If deploying manually, ensure `--port=8000` is set.

> **Cost**: Cloud Run bills per-request with `min_instance_count = 1` to avoid cold starts (~€0.10/hr idle).

---

## Demucs GPU Worker (GCE Instance)

The Demucs AI stem separation worker can also run on a dedicated GCE instance with an NVIDIA T4 GPU for faster processing (~30s/track). It's opt-in to avoid costs when not needed.

### Enable

Add to `infra/terraform/terraform.tfvars`:

```hcl
demucs_gpu_enabled = true
gcs_stems_bucket   = "resonate-stems-dev"  # unique bucket name
```

### Deploy

```bash
# 1. Apply Terraform (creates GCE instance + GCS bucket)
make infra-apply

# 2. Build and push GPU Docker image
REGISTRY=$(terraform -chdir=infra/terraform output -raw docker_registry)
docker build -t $REGISTRY/demucs-worker:latest \
  -f workers/demucs/Dockerfile.gpu workers/demucs/
docker push $REGISTRY/demucs-worker:latest

# 3. Verify deployment
terraform -chdir=infra/terraform output demucs_worker_ip
```

The backend automatically uses the worker's internal IP via `DEMUCS_WORKER_URL` (set in `backend-service.tf`).

### Environment Variables (Worker)

| Variable           | Description                    | Default                |
| ------------------ | ------------------------------ | ---------------------- |
| `STORAGE_PROVIDER` | `local` (dev) or `gcs` (cloud) | `local`                |
| `GCS_BUCKET`       | GCS bucket for stem uploads    | (required in gcs mode) |
| `OUTPUT_DIR`       | Local output directory         | `/outputs`             |

> **GPU Quota**: Check IAM & Admin → Quotas → `NVIDIA_T4_GPUS`. Default is 0 for new projects.
>
> **Cost**: Spot instance ~€0.35/hr. Not auto-restarted if preempted.

---

## Troubleshooting

### Auth errors during `terraform apply`

- Tokens expire after ~1 hour. Re-run `gcloud auth application-default login`
- Verify correct project: `gcloud config get project` (must match `terraform.tfvars`)
- If you see "wrong project" errors: `gcloud config set project YOUR_PROJECT_ID`

### `Image not found` on Cloud Run

- Images must be pushed **before** `terraform apply`
- Follow Step 3 → Step 4 → Step 5 in Phase 2 above
- Verify images exist: `gcloud artifacts docker images list $REGISTRY`

### `PORT` reserved env variable error

- Cloud Run sets `PORT` automatically — don't define it in Terraform
- Remove any `env { name = "PORT" }` blocks from `backend-service.tf`

### Can't access services

- Check IAP: ensure your Google account is in `iap_authorized_members` in `terraform.tfvars`
- Re-apply: `make infra-apply`

### Database connection issues

- Cloud SQL uses private IP — only accessible via VPC connector
- Check VPC connector status in Cloud Console

### Deployment fails in CI

- Verify GitHub secrets `GCP_WIF_PROVIDER` and `GCP_SA_EMAIL` are set
- Check Workload Identity Federation: `gcloud iam workload-identity-pools list --location=global`
