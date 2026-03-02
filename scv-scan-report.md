# Smart Contract Vulnerability Scan Report

**Date:** 2026-03-02 (Post-Remediation Re-Scan)  
**Scope:** `contracts/src/` — StemNFT, StemMarketplaceV2, UniversalSigValidator, KernelFactory, TransferValidator  
**Solidity:** ^0.8.28 | **Dependencies:** OpenZeppelin v5, Solady  
**Methodology:** Trail of Bits scv-scan 4-phase approach

---

## Summary

| Severity      | Count (Previous) | Count (Current) |
| ------------- | :--------------: | :-------------: |
| Critical      |        0         |        0        |
| High          |        2         |      0 ✅       |
| Medium        |        3         |      0 ✅       |
| Low           |        3         |      0 ✅       |
| Informational |        3         |        1        |

**All 11 findings from the initial scan have been remediated.** One new informational observation is noted below.

---

## Remediation Status

### Previously High Severity

| #   | Finding                                    | Status   | Notes                                      |
| --- | ------------------------------------------ | -------- | ------------------------------------------ |
| 1   | Reentrancy in `StemMarketplaceV2.buy()`    | ✅ Fixed | `ReentrancyGuard` + CEI reordering applied |
| 2   | Missing access control on `StemNFT.mint()` | ✅ Fixed | `onlyRole(MINTER_ROLE)` modifier added     |

### Previously Medium Severity

| #   | Finding                              | Status   | Notes                                                  |
| --- | ------------------------------------ | -------- | ------------------------------------------------------ |
| 3   | Listing without marketplace approval | ✅ Fixed | `isApprovedForAll` check added to `list()`             |
| 4   | `ecrecover` signature malleability   | ✅ Fixed | `s`-value upper bound check enforced                   |
| 5   | ETH refund griefing in `buy()`       | ✅ Fixed | Exact payment required (`msg.value != amount` reverts) |

### Previously Low Severity

| #   | Finding                                              | Status   | Notes                                  |
| --- | ---------------------------------------------------- | -------- | -------------------------------------- |
| 6   | `setFeeRecipient()` accepts zero address             | ✅ Fixed | `InvalidRecipient` guard added         |
| 7   | `setRoyaltyReceiver()` accepts zero address          | ✅ Fixed | `InvalidRoyalty(0)` guard added        |
| 8   | `KernelFactory.createAccount()` msg.value forwarding | ✅ Fixed | NatSpec documents intentional behavior |

### Previously Informational

| #   | Finding                                | Status   | Notes                                       |
| --- | -------------------------------------- | -------- | ------------------------------------------- |
| 9   | Unbounded gas in `setWhitelistBatch()` | ✅ Fixed | `MAX_BATCH_SIZE = 200` enforced             |
| 10  | `creator` semantics in `mint()`        | ✅ Fixed | NatSpec clarifies `creator = msg.sender`    |
| 11  | Open `receive()` traps ETH             | ✅ Fixed | `withdrawTrappedETH()` admin function added |

---

## New Findings

### ERC-1155 Callback Reentrancy Surface on `mintMore()`

**File:** `contracts/src/core/StemNFT.sol` L159-L168  
**Severity:** Informational

**Description:** `mintMore()` calls `_mint()` which triggers `onERC1155Received` on the recipient. While `mintMore()` has access control (`creator || MINTER_ROLE`), it does not use `nonReentrant`. If a malicious recipient contract re-enters `mintMore()` via the callback, they could only mint more editions of their own token (since the creator check passes), resulting in inflated supply for their own token — a self-harm scenario with no attack benefit.

**Code:**

```solidity
function mintMore(address to, uint256 tokenId, uint256 amount) external {
    if (!stems[tokenId].exists) revert StemNotFound(tokenId);
    if (
        stems[tokenId].creator != msg.sender &&
        !hasRole(MINTER_ROLE, msg.sender)
    ) {
        revert NotStemCreator(tokenId);
    }
    _mint(to, tokenId, amount, ""); // triggers onERC1155Received callback
}
```

**Risk:** None practical — attacker can only inflate their own token supply. No funds at risk. Access control prevents third-party exploitation.

**Recommendation:** No action required. Optionally add `nonReentrant` modifier if defense-in-depth is desired.

---

## Phase 2 — Pattern Scan Results

| Pattern            | Matches | Assessment                                                                                            |
| ------------------ | :-----: | ----------------------------------------------------------------------------------------------------- |
| `.call{value}`     |    2    | `_pay()` + `withdrawTrappedETH()` — both check return values, guarded by `nonReentrant` / `onlyOwner` |
| `safeTransferFrom` |    2    | Protected by `nonReentrant`, state updated before call (CEI)                                          |
| `_mint`            |    2    | Gated by `MINTER_ROLE` + creator check                                                                |
| `assembly`         |    1    | Memory-safe in `UniversalSigValidator`, reads signature components only                               |
| `selfdestruct`     |    0    | —                                                                                                     |
| `delegatecall`     |    0    | —                                                                                                     |
| `tx.origin`        |    0    | —                                                                                                     |
| `unchecked`        |    0    | —                                                                                                     |

## Phase 3 — Access Control Audit

| Function                    | Contract          | Modifier                      | Status |
| --------------------------- | ----------------- | ----------------------------- | ------ |
| `mint()`                    | StemNFT           | `onlyRole(MINTER_ROLE)`       | ✅     |
| `mintMore()`                | StemNFT           | creator \|\| MINTER_ROLE      | ✅     |
| `setRoyaltyReceiver()`      | StemNFT           | creator \|\| DEFAULT_ADMIN    | ✅     |
| `setRoyaltyBps()`           | StemNFT           | creator \|\| DEFAULT_ADMIN    | ✅     |
| `setTransferValidator()`    | StemNFT           | `onlyRole(DEFAULT_ADMIN)`     | ✅     |
| `buy()`                     | StemMarketplaceV2 | `nonReentrant`                | ✅     |
| `list()`                    | StemMarketplaceV2 | approval check                | ✅     |
| `cancel()`                  | StemMarketplaceV2 | seller check                  | ✅     |
| `setProtocolFee()`          | StemMarketplaceV2 | `onlyOwner`                   | ✅     |
| `setFeeRecipient()`         | StemMarketplaceV2 | `onlyOwner` + zero-addr check | ✅     |
| `withdrawTrappedETH()`      | StemMarketplaceV2 | `onlyOwner` + zero-addr check | ✅     |
| `setWhitelist()`            | TransferValidator | `onlyOwner`                   | ✅     |
| `setWhitelistBatch()`       | TransferValidator | `onlyOwner` + batch cap       | ✅     |
| `setAllowDirectTransfers()` | TransferValidator | `onlyOwner`                   | ✅     |
