# Smart Contract Scan Report

Scope reviewed on May 14, 2026 for the upload stake amount update:

- `contracts/script/DeployProtocol.s.sol`
- `contracts/script/DeployContentProtection.s.sol`
- `contracts/README.md`
- Related backend, frontend, and documentation changes that consume the configured stake amount

## Reconnaissance

- Solidity version: `0.8.28`
- No files under `contracts/src/` were changed in this branch.
- The contract-facing change is limited to deploy-script defaults:
  - Native fallback stake default changes from `0.01 ether` to `0.005 ether`.
  - USDC stake default changes from `10_000000` to `5_000000`.
- Runtime stake policy remains owner-configurable through existing `ContentProtection` admin functions, especially `setStakeAmountForAsset(address,uint256)`.

## Syntactic Sweep

The scan workflow was run against `contracts/src/` to confirm this branch does not add new contract-source patterns for:

- external calls: `.call{}`
- token transfer triggers: `_safeMint`, `_safeTransfer`, `safeTransferFrom`
- access control: `onlyOwner`, `onlyRole`, `_checkRole`, `require(... msg.sender ...)`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

The matches observed are pre-existing in contract source and were not modified by this branch. No new Solidity source entry point, access-control path, external call, or token transfer path was introduced.

## Semantic Review

- Lowering deploy defaults does not change deployed bytecode behavior unless the protocol is redeployed or an owner transaction updates on-chain settings.
- Existing deployed contracts still enforce the stake amounts currently stored on-chain.
- The frontend update multiplies the configured per-track stake by release track count before staking, while the contract still enforces the configured minimum stake amount for the release root.
- A future admin console or operations script should update both the on-chain `stakeAmountsByToken` value and backend canonical USD configuration to avoid UI/backend/on-chain drift.

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
rg '\.call\{' contracts/src/
rg '_safeMint|_safeTransfer|safeTransferFrom' contracts/src/
rg 'onlyOwner|onlyRole|_checkRole|require.*msg\.sender' contracts/src/
rg 'selfdestruct|delegatecall|tx\.origin' contracts/src/
rg 'unchecked' contracts/src/
rg 'assembly' contracts/src/
cd contracts && forge build
```
