# Smart Contract Scan Report

Scope reviewed on April 29, 2026 for issue #740:

- `contracts/src/payments/PaymentAssetRegistry.sol`
- `contracts/src/payments/MockUSDC.sol`
- `contracts/src/payments/MockPriceOracle.sol`
- `contracts/src/payments/WrappedNativeMock.sol`
- `contracts/script/DeployLocalPayments.s.sol`
- `contracts/test/unit/PaymentAssetRegistry.t.sol`

## Reconnaissance

- Solidity version: `0.8.28`
- New production-facing contract: none enabled in deployed flows yet
- New local-dev contracts:
  - owner-managed payment asset registry
  - mintable local USDC-like token
  - deterministic Chainlink-like mock oracle
  - WETH-style wrapped-native helper for the later WETH milestone

## Syntactic Sweep

Patterns reviewed across the changed Solidity files:

- external calls: `.call{}`
- token callback triggers: `_safeMint`, `_safeTransfer`, `safeTransferFrom`
- access control: `onlyOwner`, `onlyRole`, `_checkRole`, `require(msg.sender...)`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

Observed matches:

- `WrappedNativeMock.withdraw()` uses `.call{value: amount}("")` after burning
  the caller's wrapped balance.
- `PaymentAssetRegistry` uses `onlyOwner` and
  `require(msg.sender == owner, ...)` for registry mutation.

## Semantic Review

- `PaymentAssetRegistry` has a single owner and only the owner can configure
  assets or transfer ownership. It rejects the zero owner and empty asset ids.
- `MockUSDC` has unrestricted minting by design and is only deployed by the
  local payment dev script.
- `MockPriceOracle` has unrestricted answer updates by design and is only for
  deterministic local/test profiles.
- `WrappedNativeMock.withdraw()` burns before the ETH transfer. A reentrant
  recipient cannot withdraw more than its remaining wrapped balance.
- `DeployLocalPayments.s.sol` defaults to the standard Anvil private key only
  for local deployment, matching existing local scripts. The generated local
  artifact is ignored by git.

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
rg '\.call\{|_safeMint|_safeTransfer|safeTransferFrom|onlyOwner|onlyRole|_checkRole|require.*msg\.sender|selfdestruct|delegatecall|tx\.origin|unchecked|assembly' contracts/src/payments contracts/script/DeployLocalPayments.s.sol contracts/test/unit/PaymentAssetRegistry.t.sol
cd contracts && forge build
cd contracts && forge test --match-path test/unit/PaymentAssetRegistry.t.sol
```
