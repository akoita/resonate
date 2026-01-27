---
title: Project Resonate
---

# Project Resonate

Resonate is an agentic audio protocol for decentralized, AI-native music streaming, remixing, and rights management.

## 📚 Documentation

- `docs/RESONATE_SPECS.md`: Project specifications
- `docs/phase0/`: Architecture, data models, and stories
- `docs/local-aa-development.md`: Detailed guide for Account Abstraction setup

## 🚀 Development Quick Start

The project supports two development modes: **Standard** (traditional web/backend) and **Local AA** (Smart Wallet development with local blockchain).

### 1. Standard Development (Postgres + Backend + Web)

Use this for general frontend/backend feature development.

```bash
# 1. Start Postgres
make dev-up

# 2. Start Backend (Runs migrations & starts NestJS)
make backend-dev

# 3. Start Frontend (Next.js)
make web-dev
```

**Environment Variables**:
- Backend: `DATABASE_URL=postgresql://resonate:resonate@localhost:5432/resonate`, `JWT_SECRET=dev-secret`

### 2. Local AA Development (Anvil + Bundler + Contracts)

Use this when working on Account Abstraction, Smart Wallets, or Contract features.

```bash
# 1. Start Infrastructure (Anvil Chain + Alto Bundler)
make local-aa-up

# 2. Deploy Contracts (EntryPoint, Factory, Validator)
make local-aa-deploy

# 3. Start Frontend in Local Chain Mode
make web-dev-local
```

**Environment Variables**:
- Web (`.env.local`): `NEXT_PUBLIC_CHAIN_ID=31337`

## 🧹 Reset & Clean

If you need to restart from a clean slate, use these commands:

### 1. Reset Application State (Database)
Wipes all users, tracks, and releases, but keeps containers running.
```bash
make db-reset
```

### 2. Reset Infrastructure (Containers)
Destroys containers and volumes (Postgres/Anvil). Use this if infrastructure is acting up.
```bash
# For Standard Dev
make dev-down

# For Local AA Dev
make local-aa-down
```

## 🛠 Command Reference (Makefile)

### General
| Command | Description |
|---------|-------------|
| `make dev-up` | Start Postgres (Docker) |
| `make dev-down` | Stop Postgres |
| `make db-reset` | **Wipe Database**: Drops schema, recreates it, and runs seeds. Clears all data & uploads. |
| `make backend-dev`| Generate Prisma, migrate DB, start Backend |
| `make web-dev` | Start Web App (Standard Mode) |

### Local Account Abstraction
| Command | Description |
|---------|-------------|
| `make local-aa-up` | Start Anvil & Alto Bundler |
| `make local-aa-down` | Stop AA services |
| `make local-aa-deploy` | Deploy AA contracts to local Anvil |
| `make local-aa-full` | `up` + `deploy` combined |
| `make local-aa-logs` | View Bundler/Anvil logs |
| `make web-dev-local`| Start Web App with `CHAIN_ID=31337` |

## 💰 Funding Local Smart Accounts

Smart accounts deploy counterfactually. To use them locally, you often need to fund the pre-calculated address first (to pay for gas if no paymaster):

```bash
cast send <ADDRESS> --value 1ether --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## ❓ Troubleshooting

### General
- **Database errors?** Run `make db-reset` to clean state.
- **"Prisma Client not initialized"?** Run `npm run prisma:generate` in `backend/`.

### Local AA
- **"AA21 didn't pay prefund"?** The smart account needs ETH. Fund it using `cast send` above.
- **Bundler acting up?** Check logs with `make local-aa-logs`. Ensure Anvil is running on port 8545.
- **Contract addresses changed?** If you restarted Anvil (`docker compose down`), you MUST run `make local-aa-deploy` again to redeploy contracts. Frontend config usually picks up new addresses if they match the deterministic deploy script.
