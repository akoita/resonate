# Smart Contract Scan Report

Scope reviewed on April 29, 2026 for issue #739:

- `contracts/src/payments/PaymentAssetRegistry.sol`
- `contracts/src/payments/ChainlinkPriceOracleAdapter.sol`
- `contracts/src/payments/MockPriceOracle.sol`
- `contracts/src/core/StemMarketplaceV2.sol`
- `contracts/script/DeployLocalPayments.s.sol`
- `contracts/script/DeployProtocol.s.sol`
- `contracts/scripts/update-local-payment-config.sh`
- payment registry, oracle adapter, marketplace, fuzz, invariant, and formal harness tests touched by the new constructor dependency

## Reconnaissance

- Solidity version: `0.8.28`
- New production-facing contract: `ChainlinkPriceOracleAdapter`
- Updated production-facing contracts:
  - `PaymentAssetRegistry` now supports token-address lookup and duplicate-token prevention.
  - `StemMarketplaceV2` now requires a payment asset registry and rejects unsupported payment tokens at listing time.
- Updated deployment scripts configure native ETH, optional Circle USDC, optional WETH, and optional Chainlink-compatible oracle adapters.

## Syntactic Sweep

Patterns reviewed across `contracts/src/`:

- external calls: `.call{}`
- token callback triggers: `_safeMint`, `_safeTransfer`, `safeTransferFrom`
- access control: `onlyOwner`, `onlyRole`, `_checkRole`, `require(msg.sender...)`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

Observed matches relevant to this change:

- `StemMarketplaceV2.buy()` uses `safeTransferFrom` for ERC1155 settlement and ERC20 collection; the function is `nonReentrant`, updates listing state before external calls, and existed before this payment-asset change.
- `StemMarketplaceV2._pay()` and `withdrawTrappedETH()` use native ETH `.call{value: ...}`; both existed before this change and remain guarded by existing effects-before-interactions or owner-only flow.
- `PaymentAssetRegistry` uses `onlyOwner` and `require(msg.sender == owner, ...)` for registry mutation.
- `ChainlinkPriceOracleAdapter` has no state-changing external calls after construction.

No `selfdestruct`, `delegatecall`, or `tx.origin` usage was found in the changed payment contracts.

## Semantic Review

- `PaymentAssetRegistry` has a single owner and only the owner can configure assets or transfer ownership. It rejects the zero owner, empty asset ids, empty symbols, and duplicate token addresses across different asset ids.
- Disabled assets remain registered but `isTokenEnabled()` returns false, so marketplace listings cannot use them.
- `StemMarketplaceV2` validates `paymentAssetRegistry` at construction and checks the registry before listing. This keeps existing native ETH and ERC20 settlement logic while constraining the accepted token set.
- `ChainlinkPriceOracleAdapter` rejects zero/negative answers, missing timestamps, stale answers, and incomplete rounds before scaling prices to 18 decimals.
- `MockPriceOracle` remains a deterministic test/local feed and now supports stale/incomplete-round test scenarios.
- Deployment script changes use optional environment-provided token/feed addresses and default to zero-address skips for optional assets and feeds.

## Findings

No confirmed Critical, High, Medium, Low, or Informational security findings were identified in the reviewed changes.

| Severity | Count |
| -------- | ----- |
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |
| Info     | 0 |

## Commands Run

```bash
find contracts/src -name '*.sol' -type f
rg '\.call\{|_safeMint|_safeTransfer|safeTransferFrom' contracts/src
rg 'onlyOwner|onlyRole|_checkRole|require.*msg\.sender' contracts/src
rg 'selfdestruct|delegatecall|tx\.origin|unchecked|assembly' contracts/src
cd contracts && forge build
cd contracts && forge test --no-match-path 'test/formal/*' -vv
cd contracts && forge test --match-path 'test/formal/*' -vv
bash -n contracts/scripts/update-local-payment-config.sh
git diff --check
```
