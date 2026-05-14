# Smart Contract Scan Report

Scope reviewed on May 14, 2026 for the staging USDC stake sync update:

- `contracts/script/SetContentProtectionStablecoinStake.s.sol`
- `Makefile`
- `contracts/README.md`
- Related frontend and documentation changes that describe/display the configured stake amount

## Reconnaissance

- Solidity version: `0.8.28`
- No files under `contracts/src/` were changed in this branch.
- The contract-facing change is limited to a Foundry operations script that calls the existing owner-only `ContentProtection.setStakeAmountForAsset(address,uint256)` function.
- The script has no embedded addresses, private keys, RPC URLs, or environment-specific secrets. It requires `CONTENT_PROTECTION_ADDRESS` plus `STAKE_ASSET_ADDRESS` or `PAYMENT_USDC_ADDRESS`, and defaults the amount to `5000000` base units.
- Runtime stake policy remains owner-configurable through the existing `ContentProtection` admin function. The script does not change deployed bytecode or add a new on-chain entry point.

## Syntactic Sweep

The scan workflow was run against `contracts/src/` to confirm this branch does not add new contract-source patterns for:

- external calls: `.call{}`
- token transfer triggers: `_safeMint`, `_safeTransfer`, `safeTransferFrom`
- access control: `onlyOwner`, `onlyRole`, `_checkRole`, `require(... msg.sender ...)`
- dangerous primitives: `selfdestruct`, `delegatecall`, `tx.origin`
- unchecked arithmetic and inline `assembly`

The matches observed are pre-existing in contract source and were not modified by this branch. No new Solidity source entry point, access-control path, external call, or token transfer path was introduced.

## Semantic Review

- The new script reads the current ERC-20 stake amount before broadcasting and exits without a transaction if the target amount is already configured.
- The only state-changing call is `setStakeAmountForAsset`, which is protected by the existing `onlyOwner` modifier in `ContentProtection`.
- The staging remediation transaction successfully changed Base Sepolia Circle USDC staking from `10000000` to `5000000` base units. A read-back confirmed the configured USDC stake asset now returns `5000000`.
- The upload UI wording now labels the displayed stablecoin amount as a total stake, reducing ambiguity when the release has multiple tracks.

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
cd web && npm run lint
cast call "$CONTENT_PROTECTION_ADDRESS" 'stakeAmountsByToken(address)(uint256)' "$PAYMENT_USDC_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL"
```
