# Smart Contract Scan Report

Scope reviewed on April 30, 2026 for issue #760:

- `contracts/src/core/StemMarketplaceV2.sol`
- `contracts/test/unit/StemMarketplace.t.sol`

## Reconnaissance

- Solidity version: `0.8.28`
- Updated production-facing contract:
  - `StemMarketplaceV2` now checks listing expiry before narrowing it to `uint40`.
- The change is intentionally narrow: listing creation reverts with
  `ListingExpiryOverflow()` when `block.timestamp + duration` exceeds
  `type(uint40).max`.
- Solidity 0.8 checked arithmetic still protects the `uint256` addition from
  overflowing before the explicit downcast bound is evaluated.

## Syntactic Sweep

Patterns reviewed in the changed contract:

- external calls: `.call{}`
- token transfer triggers: `safeTransferFrom`, `safeTransfer`
- access control: `onlyOwner`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`
- narrowing casts: `uint40(...)`

Observed matches relevant to this change:

- `_checkedListingExpiry()` performs the only `uint40(...)` cast in the
  contract and now bounds the value first.
- `safeTransferFrom`, `safeTransfer`, and `.call{value: ...}` usages are in the
  existing buy/payment and trapped-ETH paths; they were not changed by this
  issue.
- `setProtocolFee()`, `setFeeRecipient()`, and `withdrawTrappedETH()` remain
  owner-gated.

No `selfdestruct`, `delegatecall`, `tx.origin`, `unchecked`, or inline
`assembly` usage was found in `StemMarketplaceV2`.

## Semantic Review

- Listing expiry remains stored as `uint40` to preserve the existing storage
  layout and ABI shape.
- Boundary tests now cover the maximum valid expiry (`type(uint40).max`) and
  the first overflowing expiry.
- The fix changes deployed bytecode. Base Sepolia will need the next contract
  redeploy/upgrade before this hardening is live there.

## Findings

No confirmed Critical, High, Medium, Low, or Informational security findings
were identified in the reviewed changes.

| Severity | Count |
| -------- | ----- |
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |
| Info     | 0 |

## Commands Run

```bash
rg '\.call\{|_safeMint|_safeTransfer|safeTransferFrom|onlyOwner|onlyRole|_checkRole|require.*msg\.sender|selfdestruct|delegatecall|tx\.origin|unchecked|assembly|uint40\(' contracts/src/core/StemMarketplaceV2.sol
cd contracts && forge test --match-contract StemMarketplaceTest
cd contracts && forge test
```
