# Local Account Abstraction Development

This guide explains how to run ERC-4337 Account Abstraction locally. Two modes are available:

> **See also:** [Account Abstraction Integration](account-abstraction.md) for the full architecture, auth flow, session keys, and API reference.

| Mode                             | Use case                   | Setup              |
| -------------------------------- | -------------------------- | ------------------ |
| **Forked Sepolia** (recommended) | Session keys, ZeroDev SDK  | `make anvil-fork`  |
| **Local-Only**                   | Offline, bare contract dev | `make local-aa-up` |

---

## Forked Sepolia Mode (Recommended)

Fork Sepolia so that ZeroDev's deployed contracts (Kernel v3, session key plugins) are available locally. Uses the **Alto bundler** (Docker) for local UserOp processing — the `KernelAccountService` sends transactions through the full ERC-4337 stack.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A Sepolia RPC URL (e.g. Infura, Alchemy, dRPC)
- (Optional) A [ZeroDev Project ID](https://dashboard.zerodev.app) for production passkey auth

### Quick Start

```bash
# 1. Set env vars
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

# 2. Start infrastructure
make dev-up                  # Postgres, Redis, Pub/Sub, Demucs worker
make local-aa-fork           # Forks Sepolia, configures AA .env vars
make deploy-contracts        # Configures .env with existing Sepolia contract addresses

# 3. Start backend (in separate terminal)
make backend-dev

# 4. Start frontend for Sepolia (in separate terminal)
make web-dev-fork
```

> **Important:** On a Sepolia fork, `deploy-contracts` does NOT deploy new contracts. It reads the existing Sepolia deployment addresses from `contracts/deployments/sepolia.json` and updates `.env` files. The contracts (StemNFT, Marketplace, TransferValidator) already exist on the fork from the real Sepolia state.

### Architecture (Forked Sepolia)

```
┌─────────────────────┐
│   Frontend (Next.js)│
│   localhost:3001    │
│   chainId: 11155111 │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Backend (NestJS)   │     │  Alto Bundler       │
│  localhost:3000     │     │  localhost:4337     │
│                     │     │  (Docker)           │
│  KernelAccountService     └──────────┬──────────┘
│  (ZeroDev SDK) ──────────────────────┤
└──────────┬──────────┘                │
           │                           │
           └───────────┬───────────────┘
                       ▼
           ┌─────────────────────┐
           │  Anvil (Docker)     │
           │  localhost:8545     │
           │  ← Sepolia state   │
           └─────────────────────┘
```

### Env Vars (Forked Sepolia)

| Variable             | Description           | Required?                               |
| -------------------- | --------------------- | --------------------------------------- |
| `SEPOLIA_RPC_URL`    | Sepolia RPC endpoint  | Yes                                     |
| `BLOCK_EXPLORER_URL` | Explorer for tx links | No (defaults to `sepolia.etherscan.io`) |

### Agent-Owned Key Workflow

In forked Sepolia mode, the **backend generates and owns the agent's ECDSA key**. The user holds the root key (passkey) and grants on-chain permissions to the agent's public address.

```
┌─────────────┐    1. POST /agent/enable   ┌─────────────┐
│  Frontend   │ ──────────────────────────▶│  Backend    │
│ (useSession │                            │  (generates │
│   Key hook) │◀──────────────────────────│   keypair)  │
│             │    2. {agentAddress}        └─────────────┘
│             │                                  │
│  3. Build   │    4. Sign grant tx               │
│  permission │ ──────────────────▶┌─────────────┐│
│  validator  │                    │  Smart Acct ││
│  around     │◀──────────────────│  (on-chain) ││
│  agentAddr  │    5. approvalData └─────────────┘│
│             │                                  │
│  6. POST    │    7. Store approval              │
│  /activate  │ ──────────────────────────▶│  Backend    │
│             │                            │  uses key   │
└─────────────┘                            │  for buys   │
                                           └─────────────┘
```

**Key points:**

- The backend **generates and encrypts** the agent key (AES-256-GCM or GCP KMS)
- The user grants on-chain permissions via their passkey
- Agent uses the decrypted key only for the duration of a transaction, then zeros it
- Every key access is audit-logged (`KeyAuditLog` table)
- The user can revoke at any time via the frontend

**Backend endpoints:**
| Endpoint | Method | Description |
| ----------------------------------------------- | -------- | -------------------------------------------------- |
| `/wallet/agent/enable` | `POST` | Generate agent keypair, encrypt, store in DB |
| `/wallet/agent/session-key/activate` | `POST` | Store user's on-chain approval data |
| `/wallet/agent/session-key` | `DELETE` | Revoke session key |
| `/wallet/agent/rotate` | `POST` | Rotate agent key (new keypair, revoke old) |
| `/wallet/agent/status` | `GET` | Get agent wallet + session key status |

---

### Passkey Auth in Forked Sepolia

Passkeys work in **all modes** — local, forked Sepolia, and production. The only difference is the passkey server:

| Setup                        | Passkey Server                           | Configured via                           |
| ---------------------------- | ---------------------------------------- | ---------------------------------------- |
| Without `ZERODEV_PROJECT_ID` | Self-hosted (`/api/zerodev/self-hosted`) | Default (no config needed)               |
| With `ZERODEV_PROJECT_ID`    | ZeroDev hosted                           | `NEXT_PUBLIC_ZERODEV_PROJECT_ID` env var |

**Optional ZeroDev setup** (for their hosted passkey server):

1. Get a ZeroDev Project ID from [dashboard.zerodev.app](https://dashboard.zerodev.app)
2. Set it in both environments:

```bash
# backend/.env
ZERODEV_PROJECT_ID=your-project-id

# web/.env.local
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your-project-id
```

3. Restart services: `make backend-dev` + `make web-dev-fork`

> **Note:** Passkeys require HTTPS in some browsers. Use a local HTTPS proxy (e.g. `mkcert` + `local-ssl-proxy`) if your browser rejects WebAuthn on `http://localhost`.

### Test Paymaster in Forked Sepolia

A Paymaster sponsors gas so users don't need ETH. Two options:

**Option A — ZeroDev Testnet Paymaster (recommended)**

ZeroDev's free tier includes testnet Paymaster. Add to `backend/.env`:

```bash
AA_PAYMASTER=https://rpc.zerodev.app/api/v2/paymaster/YOUR_PROJECT_ID
```

The `KernelAccountService` will include the Paymaster URL when creating the Kernel client.

**Option B — Local VerifyingPaymaster**

Deploy a simple paymaster to forked Anvil:

```bash
cd contracts
forge script script/DeployPaymaster.s.sol --rpc-url http://localhost:8545 --broadcast
```

Then set `AA_PAYMASTER=http://localhost:8545` (or the paymaster contract address depending on your implementation).

---

## Local-Only Mode

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- [jq](https://stedolan.github.io/jq/) (for config scripts)
- Node.js 18+

## Quick Start

```bash
# 1. Start everything with auto-configuration
make dev-up
make contracts-deploy-local

# 2. Start backend (in separate terminal)
make backend-dev

# 3. Start frontend in local mode (in separate terminal)
make web-dev-local
```

That's it! The deployment script automatically updates all `.env` files with the correct contract addresses.

## What Gets Deployed

| Contract                  | Description                                     |
| ------------------------- | ----------------------------------------------- |
| **EntryPoint v0.7**       | ERC-4337 singleton for UserOperation validation |
| **Kernel v3.1**           | Smart account implementation (ZeroDev)          |
| **KernelFactory**         | Factory for deploying smart accounts            |
| **ECDSAValidator**        | Validates ECDSA signatures for smart accounts   |
| **UniversalSigValidator** | ERC-6492 signature validation                   |

## Architecture

```
┌─────────────────────┐
│   Frontend (Next.js)│
│   localhost:3001    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Backend (NestJS)   │────▶│  Alto Bundler       │
│  localhost:3000     │     │  localhost:4337     │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           └───────────┬───────────────┘
                       ▼
           ┌─────────────────────┐
           │  Anvil Chain        │
           │  localhost:8545     │
           │  chainId: 31337     │
           └─────────────────────┘
```

## Commands Reference

### Forked Sepolia (ZeroDev Session Keys)

| Command                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `make anvil-fork`       | Start Anvil (Docker) forking Sepolia                               |
| `make local-aa-fork`    | Start Docker fork + wait for health + configure .env               |
| `make deploy-contracts` | Configure .env with Sepolia contract addresses (no new deployment) |
| `make local-aa-down`    | Stop local-aa and fork-aa Docker services                          |
| `make web-dev-fork`     | Start frontend with chainId 11155111 (clears `.next` cache first)  |

### Local-Only (Offline Dev)

| Command                       | Description                               |
| ----------------------------- | ----------------------------------------- |
| `make local-aa-up`            | Start Anvil and Alto bundler              |
| `make local-aa-down`          | Stop local AA services                    |
| `make local-aa-deploy`        | Deploy contracts + update configs         |
| `make contracts-deploy-local` | Start infra + deploy + configure          |
| `make local-aa-config`        | Update .env files with deployed addresses |
| `make local-aa-logs`          | View Docker container logs                |
| `make web-dev-local`          | Start frontend with chainId 31337         |

## Auto-Configuration

After deployment, the `scripts/update-aa-config.sh` script automatically:

1. **Parses deployment output** from `contracts/broadcast/DeployLocalAA.s.sol/31337/run-latest.json`
2. **Queries the bundler** for its supported entry points
3. **Updates `backend/.env`** with:
   - `AA_ENTRY_POINT` - Entry point address (from bundler)
   - `AA_FACTORY` - KernelFactory address
   - `AA_KERNEL` - Kernel implementation address
   - `AA_ECDSA_VALIDATOR` - ECDSA validator address
   - `AA_SIG_VALIDATOR` - Universal signature validator
   - `AA_CHAIN_ID` - Chain ID (31337)
   - `AA_BUNDLER` - Bundler URL
4. **Creates `web/.env.local`** if it doesn't exist

### Manual Config Update

If you need to update configs without redeploying:

```bash
make local-aa-config
```

## Environment Variables

### Backend (`backend/.env`)

```bash
# AA Infrastructure (auto-configured by scripts/update-aa-config.sh)
AA_BUNDLER=http://localhost:4337
AA_ENTRY_POINT=0x...  # Set by update-aa-config.sh
AA_FACTORY=0x...      # Set by update-aa-config.sh
AA_CHAIN_ID=31337
AA_STRICT_BUNDLER=    # Set true to throw on bundler failure (no fallback to direct EOA)
AA_STRICT_MODE=       # Set true for full parity: no fallbacks, no auto-funding

# For forked Sepolia mode (set by `make local-aa-fork`):
# AA_CHAIN_ID=11155111
# AA_BUNDLER=https://rpc.zerodev.app/api/v2/bundler/YOUR_PROJECT_ID
# ZERODEV_PROJECT_ID=your-project-id
# SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
# BLOCK_EXPLORER_URL=https://sepolia.etherscan.io

# Other backend config
DATABASE_URL="postgresql://resonate:resonate@localhost:5432/resonate"
JWT_SECRET=dev-secret
```

### Frontend (`web/.env.local`)

```bash
# Use local Anvil chain
NEXT_PUBLIC_CHAIN_ID=31337

# API endpoint
NEXT_PUBLIC_API_URL=http://localhost:3001

# For forked Sepolia mode (set by `make web-dev-fork`):
# NEXT_PUBLIC_CHAIN_ID=11155111
# NEXT_PUBLIC_RPC_URL=http://localhost:8545

# ZeroDev not needed for local dev — passkeys work with self-hosted server
# NEXT_PUBLIC_ZERODEV_PROJECT_ID=
```

## Local Dev Auth (Passkey Sign-In)

On all chains, the app uses **WebAuthn Passkeys** for authentication:

1. **Frontend** (`AuthProvider`):
   - If `NEXT_PUBLIC_ZERODEV_PROJECT_ID` is set, uses ZeroDev's hosted passkey server.
   - Otherwise, uses the **self-hosted passkey server** on the NestJS backend (`/api/zerodev/self-hosted`).
   - Creates a Kernel v3 smart account from the passkey validator.
   - Requests a nonce and signs an auth challenge with the smart account.

2. **Backend** (`auth.controller`):
   - Verifies the smart account signature via ERC-1271, or falls back to `ecrecover`.
   - Issues a JWT for the **smart account address**.

3. **Result**: You can "Sign up" / "Connect" locally with real Passkeys — the same auth path as production. No mock keys or workarounds.

## Deploying Your Contracts

After starting the local AA infrastructure, deploy your own contracts:

```bash
cd contracts
forge script script/YourDeploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## Funding Smart Accounts

Smart accounts are "counterfactual" - the address exists before deployment. Fund the address before sending UserOperations:

```bash
# Fund a smart account address (using Anvil's default account)
cast send <SMART_ACCOUNT_ADDRESS> --value 1ether \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Verifying Smart Account Deployment

Check if a smart account is deployed:

```bash
cast code <SMART_ACCOUNT_ADDRESS> --rpc-url http://localhost:8545
```

- If it returns `0x` - account is not deployed yet (counterfactual)
- If it returns bytecode - account is deployed

## Troubleshooting

### "AA21 didn't pay prefund"

The smart account doesn't have enough ETH. Fund it using the command above.

### "Bundler not reachable"

1. Check Docker containers are running: `docker compose --profile local-aa ps`
2. Check bundler is accessible: `curl http://localhost:4337`
3. Restart bundler: `docker compose --profile local-aa restart alto-bundler`

### "Invalid entry point" or validation errors

Entry point mismatch between your config and the bundler:

```bash
# Check bundler's entry point
curl -s http://localhost:4337 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' | jq
```

Then run `make local-aa-config` to sync your config.

### EntryPoint not found

Run `make local-aa-deploy` to deploy the AA infrastructure contracts.

### Addresses changed after reset

If you run `docker compose down -v` (which resets Anvil), addresses will change. Run `make dev-up && make contracts-deploy-local` to redeploy and reconfigure.

### Marketplace shows "No listings" after minting

This usually means a **contract address mismatch** — the backend indexer is watching different addresses than the ones the frontend uses.

**On a Sepolia fork**, never deploy new contracts with `forge script` directly. The existing Sepolia contracts (from `contracts/deployments/sepolia.json`) are always used. Running `make deploy-contracts` handles this automatically.

To verify addresses are in sync:

```bash
# Check what the backend uses
grep -E 'STEM_NFT|MARKETPLACE' backend/.env

# Check what the frontend uses
grep -E 'STEM_NFT|MARKETPLACE' web/.env.local

# Check on-chain (should have totalStems > 0)
cast call <STEM_NFT_ADDRESS> "totalStems()(uint256)" --rpc-url http://localhost:8545
```

If addresses don't match, run `make deploy-contracts` to re-sync them, then restart the backend and frontend.

### Next.js uses stale contract addresses

Next.js bakes `NEXT_PUBLIC_*` env vars into the build cache (`web/.next/`). Both `make deploy-contracts` and `make web-dev-fork` now clear this cache automatically. If you update `.env.local` manually, delete `web/.next/` before restarting the frontend.

## Testing the Flow

1. **Start everything**:

   ```bash
    make dev-up
    make contracts-deploy-local
   make backend-dev  # separate terminal
   make web-dev-local  # separate terminal
   ```

2. **Open the app** at http://localhost:3000 (or the port your frontend uses, e.g. 3001).

3. **Sign in**: Click "Sign up" or "Connect" in the top bar. The app uses WebAuthn Passkeys (self-hosted on the NestJS backend) to create a Kernel v3 smart account and authenticate (see [Local Dev Auth](#local-dev-auth-passkey-sign-in)).

4. **Smart account is created automatically** during passkey sign-in — no manual deployment needed.

5. **Fund the account** if you need to send UserOperations (see [Funding Smart Accounts](#funding-smart-accounts)).

## Docker Compose Services

The `local-aa` profile starts:

| Service        | Image                        | Port | Purpose          |
| -------------- | ---------------------------- | ---- | ---------------- |
| `anvil`        | `ghcr.io/foundry-rs/foundry` | 8545 | Local EVM chain  |
| `alto-bundler` | `ghcr.io/pimlicolabs/alto`   | 4337 | ERC-4337 bundler |

The `fork-aa` profile starts:

| Service             | Image                        | Port | Purpose                        |
| ------------------- | ---------------------------- | ---- | ------------------------------ |
| `anvil-fork`        | `ghcr.io/foundry-rs/foundry` | 8545 | Forked Sepolia EVM (in Docker) |
| `alto-bundler-fork` | `ghcr.io/pimlicolabs/alto`   | 4337 | ERC-4337 bundler (Docker)      |

See `docker-compose.yml` for full configuration.

## Other Services

### Demucs Worker (AI Stem Separation)

The Demucs worker runs alongside AA services and handles stem separation. **GPU acceleration is enabled by default** via `docker-compose.gpu.yml`.

| Service         | Image                                 | Port | Purpose                              |
| --------------- | ------------------------------------- | ---- | ------------------------------------ |
| `demucs-worker` | Custom (built from `workers/demucs/`) | 8000 | AI stem separation (GPU-accelerated) |
| `redis`         | `redis:7-alpine`                      | 6379 | Job queue for BullMQ                 |

```bash
# View worker logs
make worker-logs

# Check worker health
make worker-health

# Rebuild worker (after code changes)
make worker-rebuild
```

> **Requires:** NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

See [`workers/demucs/README.md`](../workers/demucs/README.md) for full worker documentation.
