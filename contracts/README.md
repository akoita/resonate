# Resonate Protocol — Smart Contracts

Solidity contracts powering the Resonate music platform: NFT stems, marketplace, content protection, revenue escrow, and fan-funded show campaign escrow.

> **Full documentation:** [`docs/smart-contracts/`](../docs/smart-contracts/) — architecture, code examples, integration patterns, gas estimates, security considerations.

## Contracts

| Contract              | File                                | Description                                                 |
| --------------------- | ----------------------------------- | ----------------------------------------------------------- |
| **StemNFT**           | `src/core/StemNFT.sol`              | ERC-1155 NFT for music stems. Gates minting on attestation. |
| **StemMarketplaceV2** | `src/core/StemMarketplaceV2.sol`    | List / buy / resale with protocol fees.                     |
| **ContentProtection** | `src/core/ContentProtection.sol`    | UUPS proxy. Attest (registrar-voucher gated), stake, slash (60/30/10), blacklist. |
| **RevenueEscrow**     | `src/core/RevenueEscrow.sol`        | Per-token escrow. Deposit, freeze, release, redirect.       |
| **ShowCampaignEscrow** | `src/core/ShowCampaignEscrow.sol`  | UUPS proxy (timelock upgrade authority + guardian veto, #1497). Fan-funded show escrow. Thresholds, refunds, booking/fulfillment-gated release; `setPaused` freezes all money movement. |
| **TransferValidator** | `src/modules/TransferValidator.sol` | Transfer hook: whitelist + blacklist enforcement.           |

## Shared Interfaces

Each contract's **shared surface** — events, custom errors, and any enums/structs
consumed outside the contract (tests, indexers, the backend, the frontend) — lives
in a canonical interface under `src/interfaces/`. Production contracts inherit the
interface and tests import it, so the event/error contract has exactly one
definition and cannot silently drift.

| Interface | Owns | Inherited by |
| --- | --- | --- |
| `IShowCampaignEscrow` | `CampaignStatus`, `Campaign`, events, errors | `ShowCampaignEscrow` + tests |
| `IRevenueEscrow` | `EscrowInfo`, events, errors | `RevenueEscrow` + tests |
| `IStemNFT` | events, errors | `StemNFT` + tests |
| `IStemMarketplaceV2` | `Listing`, events, errors | `StemMarketplaceV2` + tests |
| `ICurationRewards` | events, errors | `CurationRewards` + tests |
| `IPaymentAssetRegistry` | `PaymentAsset`, events | `PaymentAssetRegistry` + tests |
| `IContentProtectionEvents` | events, errors | `ContentProtection` + tests; extended by `IContentProtection` |
| `IDisputeResolutionEvents` | enums, events, errors | `DisputeResolution` + tests; extended by `IDisputeResolution` |
| `IChainlinkPriceOracleAdapter` | errors | `ChainlinkPriceOracleAdapter` + tests |

`IContentProtection` and `IDisputeResolution` are **consumer** interfaces (function
signatures + the `Attestation` / `Dispute` structs that other contracts call). They
carry function signatures, so a test can't inherit them directly — the events/errors
(and DisputeResolution's enums, which its events reference) live in the separate
`I…Events` interfaces that both the contract and its tests inherit. Reference the
DisputeResolution enums via `IDisputeResolutionEvents.Outcome` (an inherited enum is
not reachable through the derived `IDisputeResolution` name).

**Intentionally kept local** (not extracted — not consumed elsewhere as named types,
or extracting would change behavior):

- `StemNFT.MintAuthorization` / `StemData` / `RemixInfo` — internal storage and
  EIP-712 signing structs, accessed only through getters.
- `DisputeResolution.Evidence` — contract-local struct returned by `getEvidence`.
- `StemMarketplaceV2.IStemNFTWithMintTracking` — a narrow adapter the marketplace
  uses to read StemNFT, not part of the marketplace's own surface.
- `PaymentAssetRegistry` admin guards use `require`-strings rather than custom
  errors; converting them would change revert data, so they stay as-is.
- `ChainlinkPriceOracleAdapter.AggregatorV3Interface` — the external Chainlink feed
  read interface, an upstream standard rather than Resonate's own surface.

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
2. **ContentProtection** — UUPS proxy (implementation + ERC1967Proxy)
3. **RevenueEscrow** — initialized with owner + escrow period
4. **StemNFT** — core NFT contract
5. **StemMarketplaceV2** — linked to StemNFT
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
2. Deploy RevenueEscrow
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

**ContentProtection** uses the UUPS proxy pattern (OpenZeppelin). Only the owner can authorize upgrades via `_authorizeUpgrade()`.

```solidity
ContentProtection newImpl = new ContentProtection();
contentProtection.upgradeToAndCall(address(newImpl), "");
```

**Reinitializer migrations.** New logic that needs one-time state setup on already
deployed proxies runs through a versioned `reinitializer`. The CP-1 attestation-voucher
change (#1271) initializes the EIP-712 domain via `reinitializeV5()` (versions 2–4 were
consumed by earlier upgrades). `script/UpgradeContentProtection.s.sol` deploys the new
implementation and calls `reinitializeV5()` in the same `upgradeToAndCall`, so existing
`base-sepolia` / `sepolia` proxies get the domain and can verify vouchers. Fresh deploys
set the domain in `initialize`.

### Storage-layout safety

The contract reserves a trailing `__gap` and follows append-only storage
discipline. A CI gate (`scripts/check-storage-layout.sh`, run in the
`Smart Contract Tests` job) diffs each upgradeable contract's layout against a
committed baseline under `contracts/storage-layout/` and **fails on any drift**,
so a layout-breaking change can't reach a proxy unnoticed. After an intentional,
upgrade-safe change (append a variable, shrink `__gap`), regenerate and commit the
baseline:

```bash
forge build --extra-output storageLayout
scripts/check-storage-layout.sh --update   # review the diff, then commit
```
