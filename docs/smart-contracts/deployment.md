# Resonate Deployment Guide

Infrastructure-as-code for Resonate now lives in [`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).
This repository keeps the application code, smart contracts, and local development helpers.

## Ownership Split

| Area | Repository |
| --- | --- |
| GCP Terraform, Cloud Run deploys, deploy env files, GitHub deploy workflow | `resonate-iac` |
| Backend, frontend, AA local runtime, smart contracts, contract deployment/config helpers | `resonate` |
| Demucs worker infrastructure | `resonate-iac` |

## Local App Workflow

1. Start local app-runtime infrastructure from this repo with `make dev-up`.
2. Install app dependencies in this repo.
3. Run app-local commands from this repo. For AA development, prefer the forked Sepolia flow and use `make web-dev-fork` after `make local-aa-fork` + `make deploy-contracts`.

```bash
cd contracts && ./scripts/install-deps.sh
npm install -g npm@11.14.1
cd ../backend && npm ci
cd ../web && npm ci --legacy-peer-deps
cd ..

make backend-dev
make web-dev-local   # or make web-dev-fork when targeting a Sepolia fork on localhost:8545
```

`make dev-up` starts local Postgres, Redis, and the Pub/Sub emulator. `make local-aa-fork` starts the Sepolia fork plus local Alto bundler, and `make local-aa-up` starts the plain `31337` Anvil + bundler pair. `make backend-dev` expects the app-side services on `localhost` and exits early with a targeted message if Postgres is missing.

Useful app-local targets that still live here:

| Command | Purpose |
| --- | --- |
| `make backend-dev` | Start the NestJS API on port `3000` |
| `make web-dev` | Start the Next.js frontend on port `3001` |
| `make local-aa-fork` | Start the recommended Sepolia fork + local Alto bundler and refresh fork-mode env |
| `make local-aa-up` | Start a plain local `31337` Anvil + local Alto bundler |
| `make deploy-base-sepolia` | Deploy protocol contracts to Base Sepolia and refresh app-local contract config |
| `make local-aa-down` | Stop the local AA runtime |
| `make db-reset` | Reset the local Prisma database |
| `make pubsub-init` | Recreate emulator topics/subscriptions on `localhost:8085` |
| `make worker-health` | Check the Demucs worker health endpoint on `localhost:8000` |

## Contract Deployment

All Forge deployment scripts fail closed on non-local chains when `PRIVATE_KEY`
is unset. The first Anvil private key is allowed only on local chain IDs
`31337` and `1337`. To use that default key against any other RPC, an operator
must set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true` explicitly; do this only for
throwaway forks or disposable test environments.

### Deploy protocol contracts to Sepolia

```bash
export PRIVATE_KEY=<deployer-private-key>
export SEPOLIA_RPC_URL=<sepolia-rpc-url>
export ETHERSCAN_API_KEY=<etherscan-api-key>

make deploy-sepolia
```

This runs [`contracts/scripts/deploy-sepolia.sh`](../../contracts/scripts/deploy-sepolia.sh), writes a deployment record to `contracts/deployments/sepolia.json`, and refreshes local app config via `contracts/scripts/update-protocol-config.sh`.

The protocol deploy script also grants both `StemMarketplaceV2` and `StemNFT` registrar access in `ContentProtection` so protected mint flows and later marketplace listings resolve the correct stake root.

### Deploy protocol contracts to Base Sepolia

Use this for single-chain x402 staging, where the marketplace contracts, Kernel
smart accounts, USDC settlement, and x402 facilitator all target Base Sepolia.

```bash
export PRIVATE_KEY=<deployer-private-key>
export BASE_SEPOLIA_RPC_URL=<base-sepolia-rpc-url>

make deploy-base-sepolia
```

This runs [`contracts/scripts/deploy-base-sepolia.sh`](../../contracts/scripts/deploy-base-sepolia.sh), writes a deployment record to `contracts/deployments/base-sepolia.json`, writes a copyable remote environment handoff to `contracts/deployments/base-sepolia.remote.env`, and refreshes local app config via `contracts/scripts/update-protocol-config.sh`.

Sourcify verification does not require an API key and is the preferred Base
Sepolia verification path:

```bash
make verify-base-sepolia-sourcify
```

BaseScan verification can also run automatically when `ETHERSCAN_API_KEY` is
set. Use an Etherscan API v2 key with Base Sepolia access:

```bash
export ETHERSCAN_API_KEY=<etherscan-v2-api-key>
make deploy-base-sepolia
```

To force deployment without BaseScan verification, set `VERIFY_CONTRACTS=false`.
Verification failures do not block the deployment record or remote environment
handoff after on-chain execution has completed. If BaseScan verification fails
after a successful deploy, retry without redeploying with `make
verify-base-sepolia`; for Sourcify, use `make verify-base-sepolia-sourcify`.

Both retry commands read `contracts/broadcast/DeployProtocol.s.sol/84532/run-latest.json`.
To verify an older broadcast, pass `BROADCAST_FILE=contracts/broadcast/DeployProtocol.s.sol/84532/run-<timestamp>.json`.

After a successful deploy, copy `contracts/deployments/base-sepolia.remote.env`
into the environment managed by `resonate-iac`, filling in the RPC URL, x402
payout address, and any service-specific secrets there. The handoff keeps
`NEXT_PUBLIC_CHAIN_ID=84532` and `X402_NETWORK=eip155:84532` together so x402
challenges, recorded purchase events, and frontend wallet state all refer to
the same chain.

### ContentProtection guarded deployment and migration

Fresh `ContentProtection` deployments create a three-contract authority graph:
the implementation, an ERC1967 proxy, and a `TimelockController` with a minimum
48-hour delay. The operational owner retains fast configuration, revocation,
blacklist, and pause controls, while only the timelock can authorize UUPS
upgrades. The configured owner and independent guardian can each propose,
execute, or cancel delayed operations; the temporary deployer timelock admin is
renounced before the deployment completes.

Required shared-network variables are `CONTENT_PROTECTION_OWNER` and an
independent `CONTENT_PROTECTION_GUARDIAN`. The optional
`CONTENT_PROTECTION_TIMELOCK_MIN_DELAY` defaults to `172800` and cannot be lower
on a shared network. During a fresh full-graph or add-on deployment, the deployer
temporarily owns the proxy so all cross-contract links can be configured in one
broadcast. The script then stages the configured owner with the two-step
ownership flow; that owner must call `acceptOwnership()` before routine
operations move to it.

The deployment workflow writes and smoke-checks:

- `contracts/deployments/content-protection.<network>.json`
- `contracts/deployments/content-protection.<network>.remote.env`
- `contracts/deployments/content-protection.abi.json`

On Base Sepolia, the same deployment run verifies the broadcast graph through
Sourcify. Retry an isolated add-on deployment without redeploying with
`make verify-content-protection-sourcify` and the retained
`DeployContentProtection.s.sol` broadcast.

Existing V5 proxies use a deliberately separate two-run bootstrap:

1. `prepare-content-protection-v6-migration` deploys the candidate implementation
   and timelock, then writes a `content-protection-v6-migration.<network>.json`
   record plus a clearly marked `.candidate.env` handoff. Verify both addresses
   and their source before approval; never promote the candidate env as live app
   configuration.
2. `execute-content-protection-v6-migration` requires the current owner signer,
   exact `NEW_IMPLEMENTATION`, and `CONTENT_PROTECTION_TIMELOCK_ADDRESS`; it calls
   `upgradeToAndCall(reinitializeV6(...))` atomically, preserving the proxy and
   existing state while installing the timelock authority.

After V6, use `schedule-content-protection-upgrade` and
`execute-content-protection-upgrade`. Scheduling deploys the candidate and
records the exact calldata plus a clearly marked upgrade-candidate JSON/env/ABI
handoff; execution must use the same implementation, salt, proxy, and timelock
after the delay. Base Sepolia scheduling verifies the candidate through
Sourcify. The owner cannot bypass the timelock.
`pause-content-protection` remains the immediate incident control: it blocks new
attestations, staking, slashing/refunds/sweeps, and registrations while keeping
reads, revocations, blacklist controls, failed-payment claims, governance, and
recovery available.

### ShowCampaignEscrow deployment handoff

As of **#1497** (recovery hardened by **SCE-2/#1271**), `ShowCampaignEscrow` is a
**UUPS implementation behind an ERC1967 proxy**, and its upgrade authority is a
**`TimelockController`** (default 48h delay) with the ops owner as
proposer/executor/canceller and an independent **guardian holding `PROPOSER_ROLE`
+ `EXECUTOR_ROLE` + `CANCELLER_ROLE`**. `DeployShowCampaignEscrow.s.sol` deploys
the implementation, the timelock (granting the guardian all three roles and
renouncing the transient deployer admin), and the proxy, then initializes the
proxy binding the ops owner, fee config, and the timelock as `upgradeAuthority`.

The guardian's proposer + executor roles give an **independent recovery path**:
the escrow freezes every backer refund path while paused and `setPaused` is
`onlyOwner`, so a lost/compromised owner key while paused could otherwise strand
fan funds permanently. The guardian can schedule + execute a recovery upgrade on
its own (still behind the 48h delay) to restore control. Safety is unchanged —
the delay still applies, and owner and guardian both hold `CANCELLER_ROLE`, so
each can veto the other's scheduled upgrade during the delay.

Deploy env (in addition to the existing owner/fee vars):

| Env | Meaning | Default |
| --- | --- | --- |
| `SHOW_CAMPAIGN_ESCROW_OWNER` | Ops owner / multisig (proposer + executor) | required remote; local → deployer |
| `SHOW_CAMPAIGN_FEE_BPS` | Success-only campaign fee (bps) | 600 |
| `SHOW_CAMPAIGN_FEE_RECIPIENT` | Platform fee wallet | required remote; local → owner |
| `SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY` | Upgrade delay (seconds) | 172800 (48h) |
| `SHOW_CAMPAIGN_GUARDIAN` | Independent recovery key (`PROPOSER` + `EXECUTOR` + `CANCELLER`) | required remote; local → owner |
| `SHOW_CAMPAIGN_FULFILLMENT_WINDOW` | Booking-to-fulfillment refund escape window (seconds) | 2592000 (30 days) |

`make deploy-show-campaign-escrow` deploys the escrow graph and then runs
[`contracts/scripts/write-show-campaign-escrow-handoff.sh`](../../contracts/scripts/write-show-campaign-escrow-handoff.sh).
That parser turns the Foundry broadcast into:

- `contracts/deployments/show-campaign-escrow.<network>.json` — records the
  **proxy** (app-facing), **implementation**, and **timelock** addresses under
  `contracts` + `upgradeability`.
- `contracts/deployments/show-campaign-escrow.<network>.remote.env`
- `contracts/deployments/show-campaign-escrow.abi.json`

The `.remote.env` file contains only non-secret app configuration. The
app-facing `SHOW_CAMPAIGN_ESCROW_ADDRESS` is the **proxy** (stable across
upgrades):

```bash
NEXT_PUBLIC_CHAIN_ID=<chain-id>
SHOW_CAMPAIGN_ESCROW_ADDRESS=<proxy>
NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS=<proxy>
SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK=<proxy-deployment-block>
SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS=<proxy>:<proxy-deployment-block>
SHOW_CAMPAIGN_TIMELOCK_ADDRESS=<timelock>
SHOW_CAMPAIGN_ESCROW_IMPLEMENTATION=<implementation>
```

Promote those values through the reviewed `resonate-iac`/GCP environment path
instead of copying console output into Cloud Run or GitHub variables by hand.
The backend still links individual campaigns with `contractAddress` and
`contractCampaignId`; the global escrow address is the deployment/runtime
default for new campaigns. The indexer target list is backend-only. During a
replacement cutover, merge the new handoff entry with every legacy escrow that
still has active campaigns or unclaimed refunds; do not overwrite the list with
the handoff's single new entry. Each address has an independent cursor and fee
snapshot. Because a UUPS upgrade keeps the proxy stable, **an implementation
upgrade requires no app/ABI address change** — the ABI handoff regenerates only
if the contract surface changed.

#### Upgrading the implementation (timelocked)

Upgrades go through the timelock in two phases (signer must be a timelock
proposer+executor — normally the ops owner, or the guardian when driving an
owner-key-loss recovery per SCE-2/#1271):

```bash
cd contracts
# Phase 1 — schedule (deploys a new impl, schedules upgradeToAndCall, logs op id + ETA)
UPGRADE_ACTION=schedule \
  SHOW_CAMPAIGN_ESCROW_ADDRESS=<proxy> \
  SHOW_CAMPAIGN_TIMELOCK_ADDRESS=<timelock> \
  forge script script/UpgradeShowCampaignEscrow.s.sol --rpc-url $RPC_URL --broadcast

# ... wait out SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY ...

# Phase 2 — execute (NEW_IMPLEMENTATION = the address logged in phase 1)
UPGRADE_ACTION=execute NEW_IMPLEMENTATION=<new-impl> \
  SHOW_CAMPAIGN_ESCROW_ADDRESS=<proxy> \
  SHOW_CAMPAIGN_TIMELOCK_ADDRESS=<timelock> \
  forge script script/UpgradeShowCampaignEscrow.s.sol --rpc-url $RPC_URL --broadcast
```

The guardian **or** the ops owner can abort a scheduled upgrade before the ETA
with `timelock.cancel(<operationId>)` (both hold `CANCELLER_ROLE`), and the
guardian can independently run both phases above to recover a lost/compromised
owner key while paused. See the emergency-response runbook in
[`docs/rfc/contract-upgradeability-and-recovery.md`](../rfc/contract-upgradeability-and-recovery.md).

#### Local Anvil deploy + smoke check

For local development and CI validation against a throwaway chain:

```bash
# 1. Start a local node (chain id 31337) — the default Anvil key is used
#    automatically for local chains (see DeploymentKey.s.sol).
anvil

# 2. Deploy + write handoffs for the local network.
cd contracts
forge script script/DeployShowCampaignEscrow.s.sol --rpc-url http://localhost:8545 --broadcast
CHAIN_ID=31337 bash scripts/write-show-campaign-escrow-handoff.sh

# 3. Post-deploy smoke check (read-only: constants, owner, paused state).
SHOW_CAMPAIGN_ESCROW_ADDRESS=<deployed-escrow> \
  forge script script/SmokeShowCampaignEscrow.s.sol --rpc-url http://localhost:8545

# 4. Optional write smoke (local/owner only): also create a campaign + confirmer.
SHOW_CAMPAIGN_ESCROW_ADDRESS=<deployed-escrow> SMOKE_CREATE_CAMPAIGN=true \
  forge script script/SmokeShowCampaignEscrow.s.sol --rpc-url http://localhost:8545 --broadcast
```

[`SmokeShowCampaignEscrow.s.sol`](../../contracts/script/SmokeShowCampaignEscrow.s.sol)
asserts `BPS_DENOMINATOR == 10000`, `MAX_DEPOSIT_RELEASE_BPS == 3000`, a
non-zero owner, and an unpaused initial state; the optional write path verifies
basic campaign creation and a confirmer round-trip. Run the read-only form
against a testnet after deploy (no signer required); run the write form only on
a chain where the deployer is the owner. The `.local.*` handoff files are
throwaway and are not committed — only real-network records are.

#### Backend address discovery

The backend resolves the deployed escrow from config via
`configuredShowCampaignEscrowAddress(chainId)` (per-chain env with a
chain-agnostic fallback), reading:

```bash
SHOW_CAMPAIGN_ESCROW_ADDRESS                 # chain-agnostic fallback / local
SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS
BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS
ARBITRUM_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS
```

It fails closed (returns no address) for unset, malformed, or zero values, and
is used as the default `contractAddress` when a campaign is activated without an
explicit per-campaign address.

The indexer separately accepts a per-chain target list such as:

```bash
BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS=0xlegacy:43721459,0xcurrent:<deployment-block>
```

Use full 20-byte addresses in real configuration. Every target requires its
exact deployment block, and the list must include the current address. Deploy
the schema migration and new backend revision completely before adding a second
target; old revisions assume one cursor per chain. Keep the backend at one
instance until every serving revision includes the per-target distributed lease.
Verify lease acquisition and target cursor progress, then restore normal backend
autoscaling through `resonate-iac`. If lease-loss or repeated-takeover alerts fire,
roll back the maximum instance count to one while investigating.

#### Verification and rollback

`ShowCampaignEscrow` is UUPS-upgradeable. Normal fixes deploy a reviewed
implementation and schedule `upgradeToAndCall` through the timelock; rollback is
another timelocked upgrade and must remain storage-compatible. A replacement
proxy is a migration, not an upgrade: promote it only after its exact deployment
block is recorded and both old + new proxies are in the backend indexer target
list. Campaigns already bound to the prior address remain there and that target
must stay indexed until all campaigns are terminal and every refundable pledge
has been claimed. Verify the proxy, implementation, and timelock through
Sourcify; use Blockscout for the app-facing source/transactions/events link.

Frontend publish CI can validate a promoted escrow address by setting
`FRONTEND_SHOW_CAMPAIGN_DEPLOYMENT_ENV_FILE` to the reviewed handoff file before
running `.github/scripts/export-frontend-build-args.sh`. When that file is
provided, `NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS` must match it exactly.

Deployment handoffs are now the expected standard for every address-bearing
contract deployment. Existing paths that only upload raw Foundry broadcasts
should be upgraded to emit a reviewed JSON record, a non-secret remote env
handoff, and ABI metadata before downstream automation depends on them.

### GitHub Actions contract deployment

Manual smart-contract deployment is available in
`.github/workflows/contracts-deploy.yml` as **Smart Contract Deployment**.
It intentionally runs only through `workflow_dispatch`; no push, pull request,
or repository-dispatch event can deploy contracts.

For a cold-start, operation-by-operation guide, use
[`operations-runbook.md`](operations-runbook.md). It covers every workflow
operation, the GitHub environment variables behind it, verification retries, and
the reviewed `resonate-iac` address-promotion path.

Recommended operator flow:

1. Open **Actions -> Smart Contract Deployment**.
2. Select `environment=staging` or `environment=dev`.
3. Select `target_network=base-sepolia` for the normal staging path.
4. Run `operation=preflight` first. This builds/tests contracts, checks the RPC
   chain ID, derives the deployer address from the private key, and verifies the
   deployer has at least `0.01 ETH`.
5. Run the narrowest operation that matches the lifecycle you are changing,
   only after preflight passes and the selected GitHub environment approval is
   granted.
6. Base Sepolia Shows deployments verify the full graph through Sourcify in the
   same run. For a later retry, use the retained broadcast artifact locally from
   the deployment commit as described below.

Deployment operations:

| Operation | Lifecycle | Redeploy/update behavior | Reference updates required |
| --- | --- | --- | --- |
| `deploy-protocol` | Full marketplace/music-rights protocol graph | Deploys `TransferValidator`, guarded `ContentProtection`, `RevenueEscrow`, and `StemMarketplaceV2` implementation/timelock/proxy graphs, plus `DisputeResolution`, `CurationRewards`, `StemNFT`, and `PaymentAssetRegistry` | Script links the graph, stages the final ContentProtection owner, writes its dedicated handoff, smoke-checks authority, and verifies Base Sepolia through Sourcify |
| `deploy-content-protection` | Phase-2 add-on for an existing `StemNFT` + `TransferValidator` deployment | Deploys guarded `ContentProtection` and `RevenueEscrow` implementation/timelock/proxy graphs without replacing `StemNFT` or marketplace | Requires `STEM_NFT_ADDRESS`, `TRANSFER_VALIDATOR_ADDRESS`, owner, and independent guardian; rewires dependencies, stages final ownership, writes handoffs, smoke-checks authority, and verifies Base Sepolia through Sourcify |
| `deploy-revenue-escrow` | Revenue escrow replacement or isolated deployment | Atomically deploys the UUPS implementation, governance timelock, and ERC1967 proxy; writes JSON, `.remote.env`, and ABI handoffs | Promote only the proxy as `REVENUE_ESCROW_ADDRESS`; re-link ContentProtection and depositors, and settle/audit any standalone predecessor before retirement |
| `upgrade-revenue-escrow` | Delayed RevenueEscrow implementation change | `UPGRADE_ACTION=schedule` deploys and schedules; `execute` uses `NEW_IMPLEMENTATION` after the timelock delay | Proxy/app address stays stable; retain operation id and implementation evidence |
| `pause-revenue-escrow` | Revenue custody incident containment/recovery | Owner calls the global pause without waiting for the upgrade timelock | Deposits, releases, redirects, and failed-payment claims stop; reads, dispute freeze controls, governance, and recovery remain available |
| `deploy-stem-marketplace` | Marketplace replacement or isolated deployment | Atomically deploys the UUPS implementation, governance timelock, and ERC1967 proxy; writes JSON, `.remote.env`, and ABI handoffs | Grant registrar/validator permissions to the proxy and promote only it as `MARKETPLACE_ADDRESS` / `NEXT_PUBLIC_MARKETPLACE_ADDRESS` |
| `schedule-stem-marketplace-upgrade` / `execute-stem-marketplace-upgrade` | Delayed marketplace implementation change | Schedule deploys a candidate implementation; execute uses the exact `NEW_IMPLEMENTATION` after the timelock delay | Proxy/app address stays stable; re-run smoke and verification before unpausing |
| `pause-stem-marketplace` | Marketplace incident containment | Owner calls the fast pause without waiting for the upgrade timelock | New list/buy operations stop; cancellation, failed-payment claims, reads, configuration, and recovery remain available |
| `prepare-content-protection-v6-migration` / `execute-content-protection-v6-migration` | One-time legacy V5 governance bootstrap | Prepare deploys a verifiable implementation + timelock; execute atomically upgrades the stable proxy and consumes `reinitializeV6` | Current owner signs execute; verify exact candidate addresses first; downstream references stay stable |
| `schedule-content-protection-upgrade` / `execute-content-protection-upgrade` | Delayed post-V6 implementation change | Schedule deploys a candidate and queues exact UUPS calldata; execute uses `NEW_IMPLEMENTATION` after the timelock delay | Signer must hold the matching timelock proposer/executor role; proxy/app address stays stable |
| `pause-content-protection` | Content-protection incident containment | Operational owner immediately pauses or resumes risk-creating writes | Existing failed-payment claims, revocations, blacklist controls, reads, governance, and recovery remain available |
| `set-content-protection-stake` | Policy/config update | No redeploy; updates stake amount for an ERC-20 asset | Requires `CONTENT_PROTECTION_ADDRESS` plus `STAKE_ASSET_ADDRESS` or `PAYMENT_USDC_ADDRESS`; no contract reference changes |
| `set-marketplace-protocol-fee` | Marketplace fee config update | No redeploy; calls `StemMarketplaceV2.setProtocolFee` and optionally `setFeeRecipient` | Requires `MARKETPLACE_ADDRESS` and `NEW_PROTOCOL_FEE_BPS`; optional `NEW_FEE_RECIPIENT`; signer must be marketplace owner |
| `set-show-campaign-fee-config` | Shows campaign fee config update | No redeploy; calls `ShowCampaignEscrow.setFeeConfig` | Requires `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `NEW_FEE_BPS`, and `NEW_FEE_RECIPIENT`; fee rate applies to future campaigns only, recipient rotates at charge time |
| `set-show-campaign-confirmer` | Shows confirmer allowlist update | No redeploy; calls `ShowCampaignEscrow.setConfirmer` | Requires `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `CONFIRMER_ADDRESS`, and `CONFIRMER_ALLOWED`; signer must be escrow owner |
| `pause-show-campaign-escrow` | Shows pledge pause/unpause | No redeploy; calls `ShowCampaignEscrow.setPaused` | Requires `SHOW_CAMPAIGN_ESCROW_ADDRESS` and `PAUSED`; signer must be escrow owner |
| `create-show-campaign` | Owner-managed Shows campaign creation | No redeploy; calls `ShowCampaignEscrow.createCampaign` and `activateCampaign` | Requires campaign env vars documented in the runbook; logs the resulting `CAMPAIGN_ID` prominently |
| `deploy-show-campaign-escrow` | Resonate Shows campaign escrow | Atomically deploys the UUPS implementation, governance timelock, and ERC1967 proxy, then writes JSON, `.remote.env`, and ABI handoffs | Promote the proxy as the current app address through `resonate-iac`; merge its `address:deploymentBlock` target with legacy targets before switching new campaigns |

Use a full graph deployment when constructor immutables or tightly coupled
addresses change. Use the narrower operation when the existing address graph can
remain valid or the script explicitly rewires the affected references. Do not
redeploy an address-bearing dependency without also running or documenting the
required downstream setter calls.

Expected GitHub environments:

| Environment | Purpose |
| --- | --- |
| `contracts-dev` | Testnet/dev contract deployment experiments |
| `contracts-staging` | Base Sepolia staging deployment |

Required GitHub environment secrets:

| Secret | Required for | Notes |
| --- | --- | --- |
| `CONTRACT_DEPLOYER_PRIVATE_KEY` | `preflight`, deploy/update operations | Preferred deployer key name. The workflow also accepts legacy `PRIVATE_KEY`, but new environments should use `CONTRACT_DEPLOYER_PRIVATE_KEY`. |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia `preflight`, `deploy-protocol`, BaseScan verify | May be a secret when the RPC provider URL is paid, rate-limited, or account-scoped. |
| `SEPOLIA_RPC_URL` | Sepolia `preflight`, `deploy-protocol` | May be a secret for provider/account privacy. |
| `ETHERSCAN_API_KEY` | Optional BaseScan/Etherscan verification | Etherscan API v2 key with Base Sepolia support. |
| `BASESCAN_API_KEY` | Optional BaseScan verification | Backward-compatible alias used by existing scripts. Prefer `ETHERSCAN_API_KEY`. |

Optional GitHub environment variables:

| Variable | Purpose |
| --- | --- |
| `VERIFY_CONTRACTS` | Usually set from the workflow input. `auto` runs Sourcify verification without a key and adds BaseScan verification when an explorer key is present. |
| `VERIFY_ONLY` | Optional contract-name filter for BaseScan/Etherscan or Sourcify verification retries. |
| `BASESCAN_API_URL` | Override the BaseScan/Etherscan verification API URL. |
| `VERIFY_RETRIES`, `VERIFY_DELAY_SECONDS` | Tune BaseScan verification retry behavior. |
| `SOURCIFY_API_URL`, `SOURCIFY_RETRIES`, `SOURCIFY_DELAY_SECONDS` | Tune Sourcify verification retry behavior. |
| `X402_FACILITATOR_URL` | Written into the Base Sepolia remote environment handoff. |
| `PAYMENT_USDC_ADDRESS`, `PAYMENT_WETH_ADDRESS`, `PAYMENT_ENABLE_WETH` | Optional payment registry deployment inputs. |
| `PAYMENT_REGISTRY_ADMIN` | Optional payment registry admin override. |
| `PAYMENT_ETH_USD_FEED`, `PAYMENT_USDC_USD_FEED`, `PAYMENT_ORACLE_MAX_STALENESS` | Optional oracle deployment inputs. |
| `STEM_NFT_ADDRESS`, `MARKETPLACE_ADDRESS`, `TRANSFER_VALIDATOR_ADDRESS`, `EXISTING_ADMIN` | Required/optional inputs for `deploy-content-protection`. `MARKETPLACE_ADDRESS` should be set when an existing marketplace must register protected content. `EXISTING_ADMIN` is only for local/fork impersonation-style workflows; real testnet runs must be signed by the admin. |
| `CONTENT_PROTECTION_PROXY` | Required for `upgrade-content-protection`. |
| `CONTENT_PROTECTION_ADDRESS`, `STAKE_ASSET_ADDRESS`, `STAKE_ASSET_AMOUNT`, `STAKE_ASSET_SYMBOL` | Inputs for `set-content-protection-stake`. |
| `REVENUE_ESCROW_OWNER`, `REVENUE_ESCROW_GUARDIAN`, `REVENUE_ESCROW_TIMELOCK_MIN_DELAY`, `REVENUE_ESCROW_PERIOD` | Guarded RevenueEscrow deployment inputs. Owner and independent guardian are required remotely; guardian differs from owner/deployer; delay is at least 48 hours. |
| `REVENUE_ESCROW_ADDRESS`, `REVENUE_ESCROW_TIMELOCK_ADDRESS`, `REVENUE_ESCROW_UPGRADE_SALT`, `UPGRADE_ACTION`, `NEW_IMPLEMENTATION` | Existing proxy/timelock and two-phase upgrade inputs. `NEW_IMPLEMENTATION` is required only for execute. |
| `REVENUE_ESCROW_IMPLEMENTATION`, `REVENUE_ESCROW_DEPLOYER`, `REVENUE_ESCROW_PAUSED` | Expected implementation, original deployer, and pause state used by the read-only RevenueEscrow smoke check. |
| `MARKETPLACE_OWNER`, `MARKETPLACE_GUARDIAN`, `MARKETPLACE_TIMELOCK_MIN_DELAY` | Guarded marketplace deployment inputs. Owner and independent guardian are required remotely; guardian differs from owner/deployer; delay is at least 48 hours. |
| `MARKETPLACE_ADDRESS`, `MARKETPLACE_TIMELOCK_ADDRESS`, `MARKETPLACE_UPGRADE_SALT`, `NEW_IMPLEMENTATION` | Existing proxy/timelock and two-phase marketplace upgrade inputs. |
| `MARKETPLACE_IMPLEMENTATION`, `MARKETPLACE_DEPLOYER`, `MARKETPLACE_PAUSED` | Expected implementation, original deployer, and pause state used by the read-only marketplace smoke check. |
| `SHOW_CAMPAIGN_ESCROW_OWNER` | Owner/ops multisig for `deploy-show-campaign-escrow`; required on shared networks, local deployments default to the deployer. |
| `SHOW_CAMPAIGN_ESCROW_ADDRESS` | Existing escrow address for Shows config and campaign-creation operations. |
| `SHOW_CAMPAIGN_GUARDIAN`, `SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY`, `SHOW_CAMPAIGN_FULFILLMENT_WINDOW` | Recovery authority and lifecycle controls for `deploy-show-campaign-escrow`. Guardian is required remotely and differs from owner/deployer; remote delay is at least 48h. |
| `NEW_PROTOCOL_FEE_BPS`, `NEW_FEE_RECIPIENT` | Inputs for `set-marketplace-protocol-fee`; `NEW_FEE_RECIPIENT` is optional for marketplace recipient rotation. |
| `NEW_FEE_BPS`, `NEW_FEE_RECIPIENT` | Inputs for `set-show-campaign-fee-config`; both are required for the escrow fee config operation. |
| `CONFIRMER_ADDRESS`, `CONFIRMER_ALLOWED` | Inputs for `set-show-campaign-confirmer`. |
| `PAUSED` | Desired state for `pause-show-campaign-escrow`, `pause-revenue-escrow`, or `pause-stem-marketplace`. |
| `ARTIST_ID_HASH`, `AUTHORITY_HASH`, `BENEFICIARY`, `PAYMENT_TOKEN`, `GOAL_UNITS`, `MIN_BACKERS`, `FUNDING_DEADLINE`, `BOOKING_DEADLINE`, `DEPOSIT_RELEASE_BPS`, `DISPUTE_WINDOW_SECONDS` | Inputs for `create-show-campaign`; `DEPOSIT_RELEASE_BPS` and `DISPUTE_WINDOW_SECONDS` are optional. |

Security guidance:

- Keep this workflow manual-only and environment-protected.
- Require at least one reviewer on `contracts-staging`.
- Restrict `contracts-staging` to trusted branches such as `main` and merge
  queue branches.
- Do not allow unreviewed workflow edits to reach branches that can deploy.
- Do not print private keys or write them to files; the workflow passes them
  only through environment variables consumed by Foundry scripts.
- Do not set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` in GitHub environments. It is
  reserved for local/fork commands that explicitly target `localhost`.
- Treat deployment artifacts as public operational metadata. They should not
  contain secrets.

The workflow can live in this repository with acceptable risk because the
secret boundary is the protected GitHub environment, not the YAML file itself.
Moving contract deployment to private `resonate-iac` is stronger operational
separation and is preferable if deployment authority should be held by a
smaller group than code authors, or if production/mainnet keys are introduced.
For the current testnet/staging flow, keeping the workflow beside the contract
code is simpler and avoids drift, provided the protections above are enabled.

### Refresh local contract config

Use these commands after deploying to a local Anvil or a local Sepolia fork:

| Command | Purpose |
| --- | --- |
| `make local-aa-config` | Refresh AA addresses from the latest `DeployLocalAA` broadcast |
| `make local-aa-fork` | Start a Sepolia fork on `localhost:8545`, start the local bundler on `localhost:4337`, and refresh fork-mode `.env` files |
| `make deploy-contracts` | Deploy protocol contracts to the local RPC and refresh app config |
| `make contracts-deploy-local` | Start local AA infra, then run AA deploy + protocol deploy against it |

## Infrastructure and Cloud Deployment

Use `resonate-iac` for all of the following:

- Terraform init/plan/apply/destroy
- Cloud Run deployment
- GPU Demucs worker lifecycle
- Deploy environment files such as `.env.deploy.*`
- GitHub Actions deployment workflow configuration

### GitHub delivery -> deploy handoff

Application CI still runs in this repo, but every ordinary PR, merge-queue,
`main`, and `develop` run is validation-only. The post-merge `main` run is a
lightweight receipt; it does not publish images, create a deploy manifest, or
send a dispatch. `main` should be merged through Mergify's merge queue so the
combined candidate receives the full validation suite before it moves. See
[`docs/operations/merge_queue_ci.md`](../operations/merge_queue_ci.md) for the
required branch protection settings, Mergify setup, and operator flow.

The manual-only **Release Deployment** workflow owns application publication.
It requires `mode=preview|publish`, `release_kind=planned|on-demand`, a full
`source_sha`, the successful exact-SHA `ci_run_id`,
`environment=dev|staging`, a canonical service selection defaulting to all four services,
and a `deploy` boolean. `dev` maps to `develop`; `staging` maps to `main`.
Preview retains a read-only release plan. Publish reruns reusable CI for the
exact source and invokes the workflow-call-only image publisher, which emits
selected full-SHA tags, registry digests, and build/SBOM/signature/attestation
evidence. Unchanged content-addressed images may be reused when their evidence
is valid.

Deploy Handoff is reusable via `workflow_call` only from a successful explicitly
dispatched Release Deployment run. Its separate manual `workflow_dispatch`
`release_run_id` input supports retry or rollback using the retained immutable
manifest without rebuilding or retagging images. It has no `workflow_run`
trigger and never follows ordinary CI. A successful release may intentionally
set `deploy=false`; no handoff is dispatched in that case. A failed or partial
publication cannot dispatch a partial manifest.

The non-production handoff mapping is:

- `develop` -> `dev`
- `main` -> `staging`

Production remains manual-only in `resonate-iac`.

Analytics Dataflow publication is not part of ordinary CI or the application
image handoff. **Publish Analytics Dataflow Flex Template** is
`workflow_dispatch` only and requires a full `source_sha` equal to the
dispatch revision on the matching branch (`develop` for `dev`, `main` for
`staging`).

The sender workflow in this repo passes:

- `environment`
- `services`
- `source_ref`
- `release_sha`
- `release_id`
- `trigger_branch`
- `backend_image`
- `frontend_image`
- `demucs_image`
- `stable_audio_image`

It intentionally does not pass `source_repository`, because `resonate-iac`
already knows the default source repository and GitHub repository dispatch
payloads are limited to 10 properties.

Required sender secret in `resonate`:

- `RESONATE_IAC_DISPATCH_TOKEN`
  - GitHub token with permission to trigger repository dispatch events on
    `akoita/resonate-iac`

Deployable image publication runs through the release-scoped publisher and GCP
Cloud Build. Backend, frontend, Demucs, and stable-audio images are selected by
the release plan, built from the exact source where needed, and resolved to
immutable registry digests. The deploy manifest records each selected service,
source SHA, image tag, digest, and evidence identity. Target-environment
concurrency serializes releases, while retries and rollbacks reuse the retained
manifest.

Required image-publish auth secrets in deployable GitHub environments for `resonate`:

- `GCP_WIF_PROVIDER`
  - workload identity provider used by GitHub Actions to submit Cloud Build jobs
- `GCP_ARTIFACT_REGISTRY_SA_EMAIL`
  - dedicated Cloud Build publisher service account email
  - GitHub Actions authenticates as this identity and passes it explicitly to
    `gcloud builds submit --service-account` so Cloud Build does not fall back to
    the project default build identity

The `dev` and `staging` GitHub environments are the credential and approval
boundaries for image and Dataflow publication. Their required reviewers,
deployment-branch restrictions, and any wait timers are external GitHub
settings and must be configured before enabling mutation. The same environment
secrets are used by Analytics publication. `RESONATE_IAC_DISPATCH_TOKEN` is
read by Deploy Handoff only when `deploy=true`; it is not an image-publisher
credential.

Additional GCP requirement:

- Cloud Build must be enabled in the target project, and the effective build service
  account must have permission to push into the target Artifact Registry repository.
- Backend and Demucs publication require the repository source to remain reachable
  from GCP for the commit being published, since those images are built against the
  GitHub repo URL and commit SHA.
- Frontend publication uploads only the prepared runtime artifact context to Cloud Build,
  so the effective build identity also needs access to the Cloud Build staging bucket.
- The Cloud Build submit wrapper passes an explicit billing/quota project and
  source staging directory. `GCP_BILLING_QUOTA_PROJECT` and
  `GCP_CLOUD_BUILD_SOURCE_STAGING_DIR` can override those values when an
  environment does not follow the default IaC bucket convention.

Required deployable GitHub environment variables in `resonate`:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CI_FORCE_IMAGE_REBUILD` when an operator intentionally bypasses
  content-addressed image reuse
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_ZERODEV_PROJECT_ID`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_STEM_NFT_ADDRESS`
- `NEXT_PUBLIC_MARKETPLACE_ADDRESS`
- `NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS`
- `NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS`
- `NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS`
- `NEXT_PUBLIC_CURATION_REWARDS_ADDRESS`
- `NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS` when the deployed frontend should
  expose the default Shows escrow address

The receiver-side contract and deploy execution live in `resonate-iac`.

## Environment Variables

General app environment variables now live in
[`docs/deployment/environment.md`](../deployment/environment.md). Keep this
document focused on contract deployment and contract-adjacent local workflows.

ERC-8004 agent identity writes are backend runtime configuration, not protocol
deployment inputs. When a deployed environment should register agents on-chain,
set `ERC8004_ENABLED` and any chain/RPC overrides in the service configuration
managed by `resonate-iac`. `ERC8004_IDENTITY_REGISTRY_ADDRESS` is only required
for a fork or custom registry; otherwise the backend selects the official
ERC-8004 mainnet or testnet Identity Registry for supported chain IDs. The
variable reference lives in
[`docs/deployment/environment.md`](../deployment/environment.md).

The standalone agent runtime worker is also backend runtime configuration. Set
`AGENT_RUNTIME_WORKER_URL`, `AGENT_RUNTIME_WORKER_TIMEOUT_MS`, and
`AGENT_RUNTIME_WORKER_REQUIRED` in the backend service configuration when a
deployed environment should route agent execution to a separate worker. The
worker and backend share `INTERNAL_SERVICE_KEY` for internal requests.
