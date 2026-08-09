# Resonate Protocol — Smart Contracts

Solidity contracts powering the Resonate music platform: NFT stems, marketplace, content protection, revenue escrow, and fan-funded show campaign escrow.

> **Full documentation:** [`docs/smart-contracts/`](../docs/smart-contracts/) — architecture, code examples, integration patterns, gas estimates, security considerations.

## Contracts

| Contract              | File                                | Description                                                 |
| --------------------- | ----------------------------------- | ----------------------------------------------------------- |
| **StemNFT**           | `src/core/StemNFT.sol`              | ERC-1155 NFT for music stems. Gates minting on attestation. |
| **StemMarketplaceV2** | `src/core/StemMarketplaceV2.sol`    | Guarded UUPS proxy for list / buy / resale with protocol fees and fast pause. |
| **ContentProtection** | `src/core/ContentProtection.sol`    | Guarded UUPS proxy. Attest (registrar-voucher gated), stake, slash (60/30/10), blacklist, owner pause, and delayed upgrade authority. |
| **RevenueEscrow**     | `src/core/RevenueEscrow.sol`        | UUPS proxy (timelock + guardian). Per-token escrow with global pause, freeze, release, and redirect. |
| **ShowCampaignEscrow** | `src/core/ShowCampaignEscrow.sol`  | UUPS proxy (timelock upgrade authority + guardian veto, #1497). Fan-funded show escrow. Thresholds, refunds, booking/fulfillment-gated release; `setPaused` freezes all money movement. |
| **TransferValidator** | `src/modules/TransferValidator.sol` | Transfer hook: whitelist + blacklist enforcement.           |

## Shared Solidity Surfaces

Each contract's **shared surface** — events, custom errors, and any enums/structs
consumed outside the contract (tests, indexers, the backend, the frontend) — lives
in a canonical interface. Definitions with identical semantics across multiple
production contracts live in focused capability interfaces under `src/common/`;
contract-specific surfaces remain under `src/interfaces/`. Production contracts
and tests inherit the domain interface, so every event/error has one declaration
and cannot silently drift.

| Common capability | Owns | Used by |
| --- | --- | --- |
| `IAddressGuard` / `IAmountGuard` / `IPausableGuard` | Generic precondition errors | Only domain interfaces that enforce each guard |
| `INativePayment` / `IFeeOnTransferGuard` | Native-token and exact ERC-20 transfer errors | Payment and custody domains |
| `IFailedPaymentRecovery` | Pull-payment escrow events and errors | Content protection, revenue escrow, marketplace |
| `IStakeGuards` / `IDisputeGuards` | Shared stake and dispute precondition errors | Content protection, curation, dispute resolution |
| `IOwnershipTransfer` | Standard ownership-transfer event | Content protection, payment registry |
| `IPaymentAssetRegistryConsumer` | Registry-rotation event | Content protection, marketplace |
| `IUpgradeAuthority` | Upgrade-authority event and error | Guarded UUPS implementations |

| Interface | Owns | Inherited by |
| --- | --- | --- |
| `IShowCampaignEscrow` | `CampaignStatus`, `Campaign`, campaign events/errors + common capabilities | `ShowCampaignEscrow` + tests |
| `IRevenueEscrow` | `EscrowInfo`, escrow events/errors + common capabilities | `RevenueEscrow` + tests |
| `IStemNFT` | events, errors | `StemNFT` + tests |
| `IStemMarketplaceV2` | `Listing`, marketplace events/errors + common capabilities | `StemMarketplaceV2` + tests |
| `ICurationRewards` | curation events/errors + common capabilities | `CurationRewards` + tests |
| `IPaymentAssetRegistry` | `PaymentAsset`, events | `PaymentAssetRegistry` + tests |
| `IContentProtectionEvents` | content-protection events/errors + common capabilities | `ContentProtection` + tests; extended by `IContentProtection` |
| `IDisputeResolutionEvents` | enums, dispute events/errors + common capabilities | `DisputeResolution` + tests; extended by `IDisputeResolution` |
| `IChainlinkPriceOracleAdapter` | errors | `ChainlinkPriceOracleAdapter` + tests |

`IContentProtection` and `IDisputeResolution` are **consumer** interfaces (function
signatures + the `Attestation` / `Dispute` structs that other contracts call). They
carry function signatures, so a test can't inherit them directly — the events/errors
(and DisputeResolution's enums, which its events reference) live in the separate
`I…Events` interfaces that both the contract and its tests inherit. Reference the
DisputeResolution enums via `IDisputeResolutionEvents.Outcome` (an inherited enum is
not reachable through the derived `IDisputeResolution` name).

**Intentionally kept local** (not extracted — not consumed elsewhere as named
types, extracting would change behavior, or the declaration owns storage):

- `StemNFT.MintAuthorization` / `StemData` / `RemixInfo` — internal storage and
  EIP-712 signing structs, accessed only through getters.
- `DisputeResolution.Evidence` — contract-local struct returned by `getEvidence`.
- `StemMarketplaceV2.IStemNFTWithMintTracking` — a narrow adapter the marketplace
  uses to read StemNFT, not part of the marketplace's own surface.
- `PaymentAssetRegistry` admin guards use `require`-strings rather than custom
  errors; converting them would change revert data, so they stay as-is.
- `ChainlinkPriceOracleAdapter.AggregatorV3Interface` — the external Chainlink feed
  read interface, an upstream standard rather than Resonate's own surface.
- `NotAttested` stays domain-specific: `StemNFT` includes a token id while
  `ContentProtection` uses a parameterless local-state guard.
- `InvalidRecipient` stays separate between account-abstraction recovery and
  marketplace settlement because those domains do not share a protocol surface.

ERC-7201 namespace structs always remain inside their owning upgradeable contract.
New upgradeable implementations use namespaced storage from their first deployment.
Existing deployed linear layouts are never relocated mechanically: mappings and
dynamic collections require a contract-specific compatibility or replacement plan.

## Deployment

### Prerequisites

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts && ./scripts/install-deps.sh
```

This bootstrap script installs the pinned Forge libraries and the Kernel `I4337`
nested dependency that CI also relies on.

### Local (Anvil)

```bash
# 1. Start local node
anvil

# 2. Deploy AA infrastructure (EntryPoint + Kernel) — only needed once
forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast

# 3. Deploy protocol contracts
forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast

# 4. Note the printed addresses and update:
#    - web/src/contracts_abi/index.ts  → ADDRESSES.contentProtection
#    - backend/.env                    → if indexer needs contract addresses
```

### Testnet / Mainnet

```bash
export PRIVATE_KEY=0x...
export RPC_URL=https://...
export ETHERSCAN_API_KEY=...

# Optional overrides (defaults shown)
export STAKE_AMOUNT=5000000000000000    # 0.005 ETH in wei
export ESCROW_PERIOD=2592000            # 30 days in seconds
export PROTOCOL_FEE_BPS=250            # 2.5%

forge script script/DeployProtocol.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

### Deployment Order (automated by script)

1. **TransferValidator** — standalone module
2. **ContentProtection** — guarded UUPS graph (implementation + 48h timelock + ERC1967Proxy)
3. **RevenueEscrow** — UUPS proxy initialized with operational owner, escrow period, and timelocked upgrade authority
4. **StemNFT** — core NFT contract
5. **StemMarketplaceV2** — guarded implementation + timelock + proxy linked to StemNFT
6. **Configure:**
   - `stemNFT.setTransferValidator(validator)`
   - `stemNFT.setContentProtection(contentProtection)`
   - `validator.setWhitelist(marketplace, true)`
   - `validator.setContentProtection(contentProtection)`

### Deploy Scripts

| Script                          | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `DeployProtocol.s.sol`          | Full protocol from scratch (NFT + Marketplace + Protection + Escrow) |
| `DeployContentProtection.s.sol` | Phase 2 only — add ContentProtection + Escrow to existing deployment |
| `ContentProtectionDeployment.s.sol` | Shared guarded ContentProtection implementation/timelock/proxy deployment policy |
| `MigrateContentProtectionV6.s.sol` | One-time legacy proxy bootstrap: prepare verified candidates, then atomic V6 execute |
| `UpgradeContentProtection.s.sol` | Schedule/execute post-V6 upgrades through the ContentProtection timelock |
| `SetContentProtectionPaused.s.sol` | Operational-owner ContentProtection emergency pause/unpause |
| `SmokeContentProtection.s.sol` | Read-only ContentProtection implementation and authority-graph validation |
| `DeployRevenueEscrow.s.sol` | Revenue escrow only — deploy UUPS implementation, timelock, and proxy |
| `UpgradeRevenueEscrow.s.sol` | Timelocked RevenueEscrow UUPS upgrade: `UPGRADE_ACTION=schedule` then `execute` |
| `SetRevenueEscrowPaused.s.sol` | Owner-controlled global custody pause/unpause |
| `StemMarketplaceDeployment.s.sol` | Shared marketplace implementation/timelock/proxy deployment policy |
| `SetStemMarketplacePaused.s.sol` | Owner-controlled marketplace listing/purchase pause |
| `UpgradeStemMarketplace.s.sol` | Schedule/execute marketplace upgrades through the timelock |
| `SmokeStemMarketplace.s.sol` | Read-only marketplace dependency and authority-graph validation |
| `DeployShowCampaignEscrow.s.sol` | Shows only — deploy the UUPS escrow proxy + TimelockController upgrade authority (+ guardian CANCELLER) |
| `UpgradeShowCampaignEscrow.s.sol` | Timelocked UUPS upgrade of the escrow: `UPGRADE_ACTION=schedule` then `execute` |
| `DeployLocalAA.s.sol`           | ERC-4337 Account Abstraction infra (EntryPoint, Kernel, Factory)     |

### Add to Existing Deployment (Phase 2 only)

If you already have StemNFT + TransferValidator deployed, use this to add only the new contracts:

```bash
export STEM_NFT_ADDRESS=0x...              # Your existing StemNFT
export MARKETPLACE_ADDRESS=0x...           # Optional existing marketplace registrar
export TRANSFER_VALIDATOR_ADDRESS=0x...    # Your existing TransferValidator

forge script script/DeployContentProtection.s.sol \
  --rpc-url $RPC_URL --broadcast --verify
```

This will:

1. Deploy ContentProtection (UUPS proxy)
2. Deploy RevenueEscrow implementation + timelock + proxy
3. Grant ContentProtection registrar access to StemNFT and, when provided, marketplace
4. Link both to your existing StemNFT and TransferValidator

### Deploy Shows Campaign Escrow Only

`ShowCampaignEscrow` is intentionally independent from the marketplace/content
protection deployment graph. Deploy it separately when iterating on fan-funded
show campaigns:

```bash
export PRIVATE_KEY=0x...
export RPC_URL=https://sepolia.base.org
export SHOW_CAMPAIGN_ESCROW_OWNER=0x... # optional owner/ops multisig

make deploy-show-campaign-escrow
```

After deployment, wire the deployed address into backend/frontend configuration
with `SHOW_CAMPAIGN_ESCROW_ADDRESS` once live pledge execution or event
reconciliation is enabled.

### Environment Variables

| Variable           | Default                             | Description                           |
| ------------------ | ----------------------------------- | ------------------------------------- |
| `PRIVATE_KEY`      | Anvil key #0 on local chains only   | Deployer private key. Required on non-local chains unless `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true` is explicitly set. |
| `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` | `false` outside local chains | Explicit override to use the default Anvil key on non-local RPCs. Leave unset for shared remote deployments. |
| `BASE_URI`         | `https://api.resonate.fm/metadata/` | NFT metadata base URI                 |
| `FEE_RECIPIENT`    | Deployer address                    | Protocol fee + treasury recipient     |
| `PROTOCOL_FEE_BPS` | `250` (2.5%)                        | Marketplace fee in basis points       |
| `STAKE_AMOUNT`     | `0.005 ether`                       | Default stake amount for new creators |
| `STAKE_USDC_AMOUNT` | `5000000` (5 USDC)                 | USDC stake amount when USDC is enabled |
| `ESCROW_PERIOD`    | `30 days`                           | Default escrow hold duration          |
| `REVENUE_ESCROW_OWNER` | Deployer on local chains only | Operational owner/multisig; required on shared networks |
| `REVENUE_ESCROW_GUARDIAN` | Owner on local chains only | Independent timelock proposer/executor/canceller; required and distinct on shared networks |
| `REVENUE_ESCROW_TIMELOCK_MIN_DELAY` | `172800` | Upgrade delay in seconds; shared networks require at least 48 hours |

### Update Stablecoin Stake on an Existing Deployment

Existing ContentProtection proxies keep their on-chain stake configuration until
the owner updates it. To sync an already-deployed USDC stake amount to the
current 5 USDC per release track default:

```bash
CONTENT_PROTECTION_ADDRESS=0x... \
PAYMENT_USDC_ADDRESS=0x... \
STAKE_USDC_AMOUNT=5000000 \
RPC_URL=$RPC_URL \
make sync-content-protection-stablecoin-stake
```

Use `STAKE_ASSET_ADDRESS`, `STAKE_ASSET_AMOUNT`, and `STAKE_ASSET_SYMBOL` for a
non-USDC ERC-20 stake asset.

### Post-Deploy Checklist

- [ ] Update `web/src/contracts_abi/index.ts` with new addresses for your chain ID
- [ ] Update backend `.env` with contract addresses (if indexer needs them)
- [ ] Verify contracts on block explorer (if `--verify` wasn't used)
- [ ] Test attestation + staking flow end-to-end

## Testing

```bash
# All tests
forge test

# Unit tests for a specific contract
forge test --match-path test/unit/ShowCampaignEscrow.t.sol -vvv

# Fuzz/property tests
forge test --match-path 'test/fuzz/*' --fuzz-runs 1024

# Invariant tests
forge test --match-path 'test/invariant/*' --invariant-runs 256

# Formal/symbolic tests currently written in Foundry style for Halmos
halmos --contract StemNFTFormalTest
halmos --contract ShowCampaignEscrowFormalTest
halmos --contract RevenueEscrowFormalTest
halmos --contract ContentProtectionFormalTest

# Certora Prover specs (needs a CERTORAKEY + a standalone solc 0.8.28 on PATH).
certoraRun certora/conf/show_campaign_escrow.conf
certoraRun certora/conf/revenue_escrow.conf
certoraRun certora/conf/content_protection.conf
certoraRun certora/conf/stem_nft.conf
certoraRun certora/conf/stem_marketplace.conf
# In CI these run nightly via .github/workflows/certora.yml (gated on the CERTORAKEY
# secret — skipped on forks/PRs without it), not on the per-PR path.

# Mutation testing for high-value contracts (Certora Gambit).
# Setup: a standalone solc on PATH + the Gambit binary, e.g.
#   solc 0.8.28: https://github.com/ethereum/solidity/releases (solc-static-linux)
#   gambit v1.0.6: https://github.com/Certora/gambit/releases (gambit-linux-*)
# Generate mutants (counts observed with gambit v1.0.6):
gambit mutate --json gambit.json                     # StemNFT          (~80 mutants)
gambit mutate --json gambit-marketplace.json         # StemMarketplaceV2
gambit mutate --json gambit-revenue-escrow.json      # RevenueEscrow    (~171 mutants)
gambit mutate --json gambit-content-protection.json  # ContentProtection
# Kill-score against the suite (a mutant that leaves the suite green is a survivor —
# a gap to turn into a new test or CVL spec rule). MAX_MUTANTS limits a quick run:
MAX_MUTANTS=10 scripts/mutation-score.sh gambit-revenue-escrow.json RevenueEscrow
# The full kill campaign is compute-heavy and runs weekly via
# .github/workflows/mutation.yml (one matrix job per contract), not on the per-PR path.

# Gas report
forge test --gas-report
```

Contract changes should follow the project test ladder in
[`AGENTS.md`](../AGENTS.md): unit tests for every behavior change, fuzz tests for
non-trivial input spaces, invariants for multi-step state/accounting behavior,
and symbolic/formal coverage for critical custody, accounting, authorization,
or upgrade properties unless explicitly deferred. Use mutation testing, such as
Certora Gambit, for high-value escrow, marketplace, and payment contracts to
check whether tests/specs catch intentionally injected logic faults.

Certora Prover work lives under `certora/conf/` and `certora/specs/`. Add those
files only when the spec is meaningful enough to run; otherwise document the
deferred property in the PR or feature plan.

## Admin Operations (cast)

```bash
# Check attestation / stake / blacklist
cast call $CONTENT_PROTECTION "isAttested(uint256)(bool)" 1 --rpc-url $RPC_URL
cast call $CONTENT_PROTECTION "isStaked(uint256)(bool)" 1 --rpc-url $RPC_URL
cast call $CONTENT_PROTECTION "isBlacklisted(address)(bool)" 0x... --rpc-url $RPC_URL

# Slash (admin) — 60% reporter, 30% treasury, 10% burned
cast send $CONTENT_PROTECTION "slash(uint256,address)" 1 $REPORTER \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Refund stake (admin)
cast send $CONTENT_PROTECTION "refundStake(uint256)" 1 \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Freeze / redirect escrow (admin)
cast send $REVENUE_ESCROW "freeze(uint256)" 1 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $REVENUE_ESCROW "redirect(uint256,address)" 1 $RIGHTFUL_OWNER \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Release escrow (permissionless, after period)
cast send $REVENUE_ESCROW "release(uint256)" 1 --rpc-url $RPC_URL
```

## Upgradeability

**ContentProtection**, **ShowCampaignEscrow**, **RevenueEscrow**, and
**StemMarketplaceV2** use the OpenZeppelin UUPS proxy pattern. All four
custody/routing contracts separate their operational owner from a guarded
timelock upgrade authority with an independent guardian recovery path. See
`docs/features/custody_upgrade_recovery.md` for the current posture.

ContentProtection's existing proxies require the explicit one-time
`MigrateContentProtectionV6.s.sol` prepare/verify/execute bootstrap. Subsequent
upgrades use `UpgradeContentProtection.s.sol` to schedule and execute identical
calldata through the configured timelock; the owner cannot upgrade directly.

**Reinitializer migrations.** New logic that needs one-time state setup on already
deployed proxies runs through a versioned `reinitializer`. The CP-1 attestation-voucher
change (#1271) initialized the EIP-712 domain via `reinitializeV5()` (versions 2–4 were
consumed by earlier upgrades). The guarded-authority migration uses
`reinitializeV6(timelock)`, which also initializes the same domain for older proxies.
Fresh deployments consume version 6 in `initializeFresh`.

### Storage-layout safety

Upgradeable contracts follow append-only storage discipline. Existing
linear-layout proxies reserve a trailing `__gap`; the fresh
`StemMarketplaceV2` proxy baseline instead keeps all marketplace-owned state in
the ERC-7201 namespace `resonate.storage.StemMarketplaceV2`, isolated from
inherited OpenZeppelin storage. A CI gate (`scripts/check-storage-layout.sh`, run
in the `Smart Contract Tests` job) diffs each upgradeable contract's linear or
namespace-relative layout against a committed baseline under
`contracts/storage-layout/` and **fails on any drift**, so a layout-breaking
change can't reach a proxy unnoticed.

For a linear layout, append a variable and shrink `__gap`. For an ERC-7201
namespace, append fields to the namespace struct; never reorder, remove, or
change existing fields. After any intentional upgrade-safe change, regenerate
and commit the baseline:

```bash
forge build --extra-output storageLayout
scripts/check-storage-layout.sh --update   # review the diff, then commit
```
