# Local Account Abstraction Development

This guide explains how to run a fully local ERC-4337 Account Abstraction environment for ZeroDev smart wallet development.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- Node.js 18+

## Quick Start

```bash
# 1. Start local AA infrastructure (Anvil + Alto bundler)
make local-aa-up

# 2. Deploy AA contracts
make local-aa-deploy

# 3. Start frontend in local mode
make web-dev-local
```

## Architecture

```
┌─────────────────────┐
│   Frontend (Next.js)│
│   localhost:3000    │
└──────────┬──────────┘
           │ UserOperations
           ▼
┌─────────────────────┐
│  Alto Bundler       │
│  localhost:4337     │
└──────────┬──────────┘
           │ eth_sendRawTransaction
           ▼
┌─────────────────────┐
│  Anvil Chain        │
│  localhost:8545     │
│  chainId: 31337     │
├─────────────────────┤
│  - EntryPoint v0.7  │
│  - Kernel Factory   │
│  - ECDSA Validator  │
│  - YOUR CONTRACTS   │
└─────────────────────┘
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `make local-aa-up` | Start Anvil and Alto bundler |
| `make local-aa-down` | Stop local AA services |
| `make local-aa-deploy` | Deploy AA contracts to Anvil |
| `make local-aa-full` | Start infra + deploy contracts |
| `make local-aa-logs` | View Docker container logs |
| `make web-dev-local` | Start frontend with chainId 31337 |

## Environment Variables

For local AA development, set in `web/.env.local`:

```bash
# Use local Anvil chain
NEXT_PUBLIC_CHAIN_ID=31337

# No ZeroDev project ID needed for local dev
# NEXT_PUBLIC_ZERODEV_PROJECT_ID= (leave unset)
```

## Deploying Your Contracts

After starting the local AA infrastructure, deploy your own contracts:

```bash
# Navigate to contracts folder
cd contracts

# Deploy with Foundry
forge script script/YourDeploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## Funding Smart Accounts

Smart accounts are "counterfactual" - the address exists before deployment. You must fund the address before sending UserOperations:

```bash
# Fund a smart account address (using Anvil's default account)
cast send <SMART_ACCOUNT_ADDRESS> --value 1ether --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Troubleshooting

### "AA21 didn't pay prefund"
The smart account doesn't have enough ETH. Fund it using the command above.

### Bundler not accepting UserOperations
1. Check Anvil is producing blocks: `cast block-number --rpc-url http://localhost:8545`
2. Check bundler logs: `make local-aa-logs`
3. Ensure chainId matches (31337)

### EntryPoint not found
Run `make local-aa-deploy` to deploy the AA infrastructure contracts.

## Canonical Addresses (Local)

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| UniversalSigValidator (ERC-6492) | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |

> **Note**: These addresses are deterministic based on deployer nonce. If you reset Anvil (`docker compose down -v`) and redeploy, you'll get different addresses and need to update all configs.
