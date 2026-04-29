# Smart Contract Scan Report

Scope reviewed on April 29, 2026 for issue #741:

- `contracts/src/core/ContentProtection.sol`
- `contracts/src/core/CurationRewards.sol`
- `contracts/src/interfaces/IContentProtection.sol`
- `contracts/script/DeployProtocol.s.sol`
- `contracts/script/UpgradeContentProtection.s.sol`
- unit tests covering native ETH and USDC stake, refund, slash, rejection, inconclusive, and appeal outcomes

## Reconnaissance

- Solidity version: `0.8.28`
- Updated production-facing contracts:
  - `ContentProtection` now records the stake token alongside the existing stake amount tuple and supports enabled ERC20 stake deposits.
  - `CurationRewards` now records counter-stake and appeal-stake tokens and pays refunds/slashes in the original asset.
- Native ETH remains represented by `address(0)`.
- ERC20 transfers use OpenZeppelin `SafeERC20`.
- Registry checks use `PaymentAssetRegistry.isTokenEnabled(token)` when the registry is configured.

## Syntactic Sweep

Patterns reviewed across changed contracts:

- external calls: `.call{}`
- token callback triggers: `safeTransferFrom`, `safeTransfer`
- access control: `onlyOwner`, registry owner configuration
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

Observed matches relevant to this change:

- `ContentProtection._stakeErc20()` records stake state then calls `safeTransferFrom`; the entrypoint is `nonReentrant`, and a failed ERC20 transfer reverts the full transaction.
- `ContentProtection.slash()` and `refundStake()` now route through `_pay(token, to, amount)`. Native ETH transfers use `.call{value: ...}` after stake state is marked inactive. ERC20 transfers use `safeTransfer`.
- `CurationRewards.reportContentWithAsset()` and `appealDisputeWithAsset()` collect ERC20 stakes with `safeTransferFrom` under `nonReentrant`.
- `CurationRewards` payout paths use `_pay(token, to, amount)` after processing flags or appeal stake state are updated.
- New admin configuration in `ContentProtection` is limited to `onlyOwner`.

No `selfdestruct`, `delegatecall`, `tx.origin`, `unchecked`, or inline `assembly` usage was found in the changed contracts.

## Semantic Review

- Asset identity is stored separately from the legacy `stakes(tokenId)` tuple, preserving the existing ABI while adding `stakeTokens(tokenId)` and `getStakeAsset(tokenId)`.
- ERC20 stake deposits require an enabled registry token and a configured token-specific stake floor. Native ETH retains the existing `stakeAmount` floor and can be constrained by the registry when configured.
- Slash and refund paths mark the stake inactive before external transfers, and both ETH and ERC20 payouts preserve the original stake asset.
- Counter-stake requirements are calculated from the creator's active stake amount, then paid and later settled in that same stake asset.
- Appeal stakes inherit the original counter-stake token and are refunded or slashed in that same asset.
- Existing ETH flows remain covered and new USDC flows are covered for stake, refund, slash, rejected dispute, inconclusive dispute, and appeal refund.

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
rg '\.call\{|safeTransferFrom|safeTransfer|onlyOwner|delegatecall|tx\.origin|selfdestruct|unchecked|assembly' contracts/src/core/ContentProtection.sol contracts/src/core/CurationRewards.sol contracts/src/interfaces/IContentProtection.sol -n
cd contracts && forge test --match-path test/unit/ContentProtection.t.sol -vv
cd contracts && forge test --match-path test/unit/CurationRewards.t.sol -vv
cd contracts && forge test --match-contract 'ContentProtectionTest|CurationRewardsTest'
cd contracts && forge test
git diff --check
```
