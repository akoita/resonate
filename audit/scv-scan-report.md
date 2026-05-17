# Smart Contract Scan Report

Scope reviewed on May 17, 2026 for issue #841 x402 marketplace settlement:

- `contracts/src/core/StemMarketplaceV2.sol`
- `contracts/test/unit/StemMarketplace.t.sol`
- Backend and documentation changes that drive `StemMarketplaceV2.buyFor`

## Reconnaissance

- Solidity version: `0.8.28`
- External dependencies in the changed contract remain OpenZeppelin interfaces,
  `SafeERC20`, `ReentrancyGuard`, and `Ownable`.
- The branch adds one marketplace entry point, `buyFor(uint256,uint256,address)`,
  so the backend can settle a paid x402 checkout into marketplace ownership for
  a buyer/recipient wallet.

## Syntactic Sweep

The scan workflow was run against `contracts/src/` for:

- external calls: `.call{}`
- token transfer triggers: `_safeMint`, `_safeTransfer`, `safeTransferFrom`
- access control: `onlyOwner`, `onlyRole`, `_checkRole`,
  `require(... msg.sender ...)`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

The only new source trigger is `StemMarketplaceV2.buyFor`, which routes through
the existing non-reentrant marketplace purchase path. Existing ETH helper calls
and admin functions were unchanged.

## Semantic Review

- `buyFor` rejects a zero recipient and delegates to `_buy`.
- `_buy` preserves the existing listing validation, seller self-purchase guard,
  expiry check, amount check, fee math, state update before interactions, and
  `nonReentrant` protection inherited from the external callers.
- `_buy` now rejects both `msg.sender == seller` and `recipient == seller`,
  preventing the x402 settlement wallet from routing ownership back to the
  seller.
- ERC-20 purchases still require `msg.value == 0` and collect exact payment from
  `msg.sender` through `SafeERC20.safeTransferFrom`.
- NFT transfer uses the validated recipient and emits `Sold` with the recipient
  as the buyer, giving indexers and the backend a canonical event to verify.
- Unit tests cover successful ERC-20 `buyFor`, `Sold` event buyer semantics,
  zero-recipient rejection, and seller-recipient rejection.

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
find contracts/src -name '*.sol' -type f
rg 'pragma solidity|import ' contracts/src/
rg '\.call\{' contracts/src/
rg '_safeMint|_safeTransfer|safeTransferFrom' contracts/src/
rg 'onlyOwner|onlyRole|_checkRole|require.*msg\.sender' contracts/src/
rg 'selfdestruct|delegatecall|tx\.origin' contracts/src/
rg 'unchecked' contracts/src/
rg 'assembly' contracts/src/
forge test --match-contract StemMarketplaceTest
forge test
git diff --check
```
