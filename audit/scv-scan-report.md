# Smart Contract Scan Report

Scope reviewed on April 30, 2026 for issue #742:

- `contracts/src/core/RevenueEscrow.sol`
- `contracts/test/unit/RevenueEscrow.t.sol`
- plan artifact for the implementation slice

## Reconnaissance

- Solidity version: `0.8.28`
- Updated production-facing contract:
  - `RevenueEscrow` now stores native ETH escrow state in the existing `escrows(tokenId)` slot and ERC20 escrow state by `tokenId => token`.
- Native ETH remains represented by `address(0)`.
- ERC20 transfers use OpenZeppelin `SafeERC20`.
- Existing native ETH deposit, release, redirect, and view APIs remain available for compatibility.

## Syntactic Sweep

Patterns reviewed across changed contract code:

- external calls: `.call{}`
- token transfer triggers: `safeTransferFrom`, `safeTransfer`
- access control: `onlyOwner`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

Observed matches relevant to this change:

- `depositWithAsset()` collects ERC20 revenue using `safeTransferFrom` after escrow state is updated. If the token transfer fails, the full transaction reverts.
- `releaseAsset()` and `redirectAsset()` pay ERC20 revenue through `safeTransfer` after balances are zeroed.
- Native ETH release and redirect continue to use `.call{value: ...}` through `_pay()` after the escrow balance is zeroed.
- Freeze, unfreeze, redirect, and content-protection cascade operations remain owner-gated.

No `selfdestruct`, `delegatecall`, `tx.origin`, `unchecked`, or inline `assembly` usage was found in the changed contract.

## Semantic Review

- Revenue escrow balances are now distinguished by both token ID and payment asset.
- Asset-aware events include the payment token so analytics, indexing, and receipt generation can distinguish ETH and ERC20 escrow movements.
- `getEscrowAsset()` and `getEscrowAssets()` expose asset-specific escrow state for indexers and backend receipts.
- Asset-specific release and redirect flows settle in the original escrow asset.
- `freezeByTrack()` freezes every known escrow asset for the track and registered stems, preserving dispute behavior across native ETH and ERC20 revenue.
- Unit tests cover native ETH regressions plus USDC deposit, release, redirect, independent native/USDC balances, unfreeze, and track-level freeze behavior.

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
rg '\.call\{|safeTransferFrom|safeTransfer|onlyOwner|delegatecall|tx\.origin|selfdestruct|unchecked|assembly' contracts/src/core/RevenueEscrow.sol -n
cd contracts && forge test --match-path test/unit/RevenueEscrow.t.sol -vv
cd contracts && forge test
```
