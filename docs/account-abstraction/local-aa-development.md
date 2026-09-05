# Local Account Abstraction Development

This repository owns the AA smart contracts, local AA runtime, config update scripts, and app runtime.
Cloud deployment infrastructure still lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).

## Kernel dependency boundary

The application and local AA runtime use official Kernel v3.1 commit
`03f7f5cf5871cda0070e4223f196f5b577f6cde2` and official
`account-abstraction` v0.7 commit
`7af70c8993a6f42973f520ae0752386a5032abe7`. The deployment includes the
repository-owned `KernelFactory` and `UniversalSigValidator`. SDK calls use
Kernel version `0.3.1` and pass the deployed implementation and factory
explicitly; repository-owned local and custom networks disable the canonical
ZeroDev meta-factory path.

The local Alto runtime is pinned to v1.2.8 by image digest. This keeps signer-key
handling reproducible and includes the fix for GHSA-c9v7-pgv6-hrcc; update both
the version and digest together after repeating the signed UserOperation smoke.

The separate Kernel v4 gitlink points to development commit
`f2a84a332ec5a722e7e95a0d64601905c3c87fe9`, but v4 is compiled only by the
isolated `kernel-v4/` compatibility harness with EntryPoint v0.9 and Solidity
0.8.33/Prague.

The v4 harness is compatibility and tooling coverage only. It does not migrate,
authorize, or replace existing v3.1 accounts, and no app-local deployment or
forked-account flow uses it.

## What Runs Where

| Concern | Repository |
| --- | --- |
| Postgres, Redis, Pub/Sub emulator | `resonate` |
| Anvil, Alto bundler | `resonate` |
| Demucs worker, cloud infra, deployment stack | `resonate-iac` |
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
npm install -g npm@11.14.1
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..
```

## Forked Sepolia Mode

This is the preferred development workflow.

Use this mode when you want this repo to start:

- a Sepolia fork on `http://localhost:8545`
- a bundler on `http://localhost:4337`
- local Postgres / Redis / PubSub via `make dev-up`

```bash
export SEPOLIA_RPC_URL=https://sepolia.drpc.org

make dev-up
make local-aa-fork
make deploy-contracts

make backend-dev
make web-dev-fork
```

`make local-aa-fork` now starts the Sepolia fork, starts the local Alto bundler, and refreshes local `.env` files for fork mode. Keep using `make web-dev-fork` afterward so the frontend stays on chain `11155111`.

### Check the isolated Kernel v4 path

After `./scripts/install-deps.sh`, run the focused compatibility project from
the repository root:

```bash
make kernel-v4-test
```

This deploys contracts only inside Foundry's in-memory test VM. It must not be
used as a deployment command for existing Resonate wallets.

## Local-Only Mode

Use this only when you explicitly want a plain `31337` local environment or need offline development.

This mode starts its own plain local Anvil + bundler:

```bash
make dev-up
make contracts-deploy-local

make backend-dev
make web-dev-local
```

`make contracts-deploy-local` runs the application-local stack:

1. `make local-aa-deploy`
2. `make deploy-contracts`

After deployment, prove that the SDK and contracts agree by mining a signed
UserOperation:

```bash
cd web
npm run test:aa-smoke
```

The smoke runner derives the counterfactual account through the installed
ZeroDev SDK, funds it, submits through Alto, waits for the ERC-4337 receipt, and
requires a successful execution transaction.

## Glamsterdam And Other Custom Devnets

The custom profile connects the same deployment and Alto runtime to an
externally managed execution RPC. For a host-published Kurtosis RPC, deploy and
start the custom profile with:

```bash
export AA_CHAIN_ID=3151908
export AA_RPC_URL=http://127.0.0.1:32003
export AA_ALTO_RPC_URL=http://host.docker.internal:32003
export AA_EXECUTOR_PRIVATE_KEY=0x... # funded disposable devnet key
export AA_UTILITY_PRIVATE_KEY=0x...  # funded disposable devnet key
export AA_EXECUTOR_GAS_MULTIPLIER=1500 # EIP-8037 state-gas headroom
export AA_V7_VERIFICATION_GAS_MULTIPLIER=1500
export PRIVATE_KEY=0x...             # AA deployment key
export AA_FORGE_FLAGS="--gas-estimate-multiplier 1500"

make local-aa-custom

cd web
AA_SMOKE_PRIVATE_KEY=0x... AA_FUNDER_KEY=0x... npm run test:aa-smoke
```

All private keys are required explicitly outside chain `31337`; the scripts do
not print them or write them to app env files. `AA_ALTO_RPC_URL` must be
reachable from the Alto container, while `AA_RPC_URL` is the host-side URL used
by Foundry, the app, and the smoke runner.

Platåberget testing also requires EIP-8037-aware deployment headroom. A default
Foundry estimate can simulate successfully and still exhaust the on-chain
state-gas reservoir during code deposit. The reproducible topology and measured
result are documented in the
[Glamsterdam repricing impact matrix](../smart-contracts/glamsterdam-impact-matrix.md).

The local and Platåberget acceptance proof for this boundary is tracked in
[#1694](https://github.com/akoita/resonate/issues/1694). The checked-in smoke
runner is the reproducible regression test; a listening RPC or healthy bundler
alone is not considered application-level UserOperation coverage.

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
./contracts/scripts/update-aa-config.sh --mode custom \
  --chain-id 3151908 \
  --rpc-url http://127.0.0.1:32003 \
  --bundler-url http://localhost:4337
./contracts/scripts/update-protocol-config.sh
```

## ERC-8004 Identity Mint

Issue #261 uses the public ERC-8004 Identity Registry instead of deploying a
Resonate-owned registry. The backend defaults to the official mainnet or
testnet registry address for supported public chain IDs, and
`ERC8004_IDENTITY_REGISTRY_ADDRESS` remains available for local forks or custom
deployments.

Use the standalone script when you need to mint/link an agent identity outside
the web dashboard:

```bash
cd backend

export ERC8004_RPC_URL="$SEPOLIA_RPC_URL"
export ERC8004_PRIVATE_KEY="0x..."

npx ts-node-dev --transpile-only scripts/mint-agent-identity.ts \
  --network sepolia \
  --smart-account 0xYourKernelSmartAccount \
  --name "Resonate DJ Agent" \
  --capabilities curation,negotiation,mcp.catalog.search \
  --mock-ipfs
```

`--mock-ipfs` prints the registration JSON and sets a deterministic `ipfs://`
placeholder so local reviewers can verify the registry link before pinning the
file. Without `--mock-ipfs`, the script stores the registration file as a
`data:application/json` URI. Pass `--agent-uri ipfs://...` once the metadata is
pinned.

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

Use this repo for local lifecycle:

- `make dev-up` / `make dev-down` for Postgres, Redis, Pub/Sub
- `make local-aa-fork` / `make local-aa-down` for the recommended Sepolia fork workflow
- `make local-aa-up` / `make local-aa-down` for local-only `31337`

Use `resonate-iac` only for cloud-like deployment stacks and the Demucs worker infrastructure.
