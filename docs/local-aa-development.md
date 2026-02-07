# Local Account Abstraction Development

This guide explains how to run a fully local ERC-4337 Account Abstraction environment for smart wallet development.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- [jq](https://stedolan.github.io/jq/) (for config scripts)
- Node.js 18+

## Quick Start

```bash
# 1. Start everything with auto-configuration
make local-aa-full

# 2. Start backend (in separate terminal)
make backend-dev

# 3. Start frontend in local mode (in separate terminal)
make web-dev-local
```

That's it! The deployment script automatically updates all `.env` files with the correct contract addresses.

## What Gets Deployed

| Contract | Description |
|----------|-------------|
| **EntryPoint v0.7** | ERC-4337 singleton for UserOperation validation |
| **Kernel v3.1** | Smart account implementation (ZeroDev) |
| **KernelFactory** | Factory for deploying smart accounts |
| **ECDSAValidator** | Validates ECDSA signatures for smart accounts |
| **UniversalSigValidator** | ERC-6492 signature validation |

## Architecture

```
┌─────────────────────┐
│   Frontend (Next.js)│
│   localhost:3000    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Backend (NestJS)   │────▶│  Alto Bundler       │
│  localhost:3001     │     │  localhost:4337     │
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

| Command | Description |
|---------|-------------|
| `make local-aa-up` | Start Anvil and Alto bundler |
| `make local-aa-down` | Stop local AA services |
| `make local-aa-deploy` | Deploy contracts + update configs |
| `make local-aa-full` | Start infra + deploy + configure |
| `make local-aa-config` | Update .env files with deployed addresses |
| `make local-aa-logs` | View Docker container logs |
| `make web-dev-local` | Start frontend with chainId 31337 |

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

# ZeroDev not needed for local dev
# NEXT_PUBLIC_ZERODEV_PROJECT_ID=
```

## Local Dev Auth (Sign-in with AA Wallet)

On chain **31337** with no ZeroDev project ID, the app uses a **mock ECDSA signer** so you can sign in without Passkey/ZeroDev:

1. **Frontend** (`AuthProvider`):
   - Generates a random EOA (private key) and builds a Kernel smart account with the local ECDSA validator.
   - Requests a nonce for the **smart account address**.
   - Signs the auth message with the **EOA** (not the smart account), so the backend can verify via standard `ecrecover`.
   - Sends to `/auth/verify`: `address` = smart account, `signerAddress` = EOA, `message`, `signature`.

2. **Backend** (`auth.controller`):
   - When `chainId === 31337` and `signerAddress` is present, verifies the **EOA** signature with `verifyMessage(signerAddress, message, signature)`.
   - Consumes the nonce for `address` (smart account) and issues a JWT for the **smart account address**.
   - The session identity is the smart account, so Wallet and AA flows use the same address.

3. **Result**: You can "Sign up" / "Connect" locally and get a session tied to your local smart account; no Passkey or ZeroDev required.

On other chains (e.g. Sepolia), the app uses ZeroDev Passkey and the backend verifies either the smart account (ERC-1271) or, if that fails, recovers the EOA from the signature and issues the token for the recovered address.

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
If you run `docker compose down -v` (which resets Anvil), addresses will change. Run `make local-aa-full` to redeploy and reconfigure.

## Testing the Flow

1. **Start everything**:
   ```bash
   make local-aa-full
   make backend-dev  # separate terminal
   make web-dev-local  # separate terminal
   ```

2. **Open the app** at http://localhost:3000 (or the port your frontend uses, e.g. 3001).

3. **Sign in**: Click "Sign up" or "Connect" in the top bar. With chainId 31337 and no ZeroDev project ID, the app uses the mock ECDSA signer and creates a local smart account; the backend verifies the EOA signature and issues a JWT for the smart account address (see [Local Dev Auth](#local-dev-auth-sign-in-with-aa-wallet)).

4. **Go to Wallet page** and click "Enable Smart Account".

5. **Click "Deploy Smart Account"** – the smart account is deployed on Anvil.

6. **Fund the account** if you need to send UserOperations (see [Funding Smart Accounts](#funding-smart-accounts)).

## Docker Compose Services

The `local-aa` profile starts:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `anvil` | `ghcr.io/foundry-rs/foundry` | 8545 | Local EVM chain |
| `alto-bundler` | `ghcr.io/pimlicolabs/alto` | 4337 | ERC-4337 bundler |

See `docker-compose.yml` for full configuration.

## Other Services

### Demucs Worker (AI Stem Separation)

The Demucs worker runs alongside AA services and handles stem separation. **GPU acceleration is enabled by default** via `docker-compose.gpu.yml`.

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `demucs-worker` | Custom (built from `workers/demucs/`) | 8000 | AI stem separation (GPU-accelerated) |
| `redis` | `redis:7-alpine` | 6379 | Job queue for BullMQ |

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
