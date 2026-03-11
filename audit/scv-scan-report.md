# SCV Scan Report — Issue #420: Stake-to-Price Proportionality

**Date:** 2026-03-11
**Scope:** Changes in `ContentProtection.sol`, `StemMarketplaceV2.sol`, `IContentProtection.sol`
**Methodology:** 4-phase audit (Recon → Codebase Sweep → Deep Validation → Report)

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 0     |
| Medium        | 0     |
| Low           | 0     |
| Informational | 2     |

---

### ~~[Low] Emit-before-state in `setMaxPriceMultiplier`~~ — FIXED

**File:** `contracts/src/core/ContentProtection.sol` L362-367
**Severity:** Low → **Resolved**

**Fix applied:** Cached old value before state update, emit after assignment.

```solidity
function setMaxPriceMultiplier(uint256 newMultiplier) external onlyOwner {
    if (newMultiplier == 0) revert InvalidMultiplier();
    uint256 oldMultiplier = maxPriceMultiplier;
    maxPriceMultiplier = newMultiplier;
    emit MaxPriceMultiplierUpdated(oldMultiplier, newMultiplier);
}
```

---

### [Informational] `getMaxListingPrice` returns `type(uint256).max` when no stake is active

**File:** `contracts/src/core/ContentProtection.sol` L551-558
**Severity:** Informational

**Description:** When the resolved stake root has no active stake, `getMaxListingPrice` returns `type(uint256).max`, effectively uncapping the listing. This is by design (allows unstaked stems to be listed without restriction) but should be clearly documented so integrators understand the fallback behavior.

**Recommendation:** Add NatSpec documenting the uncapped fallback.

---

### [Informational] `listLastMint` calls external `contentProtection.registerStemProtectionRoot` before internal `_createListing`

**File:** `contracts/src/core/StemMarketplaceV2.sol` L156-157
**Severity:** Informational

**Description:** The external call to `contentProtection.registerStemProtectionRoot()` happens before `_createListing()`. Since `ContentProtection.registerStemProtectionRoot` is a state-only function (no ETH transfers, no callbacks) guarded by `onlyRegistrarOrOwner`, and the marketplace is a registered registrar, there is no reentrancy risk. The ordering is necessary because `_createListing` reads `getMaxListingPrice`, which depends on the stem-to-root mapping being set.

**Recommendation:** No action required. Ordering is correct for the price-cap check.

---

## Validation Notes

- All new state-changing functions are access-controlled (`onlyOwner`, `onlyRegistrarOrOwner`, `reinitializer(2)`)
- No `selfdestruct`, `delegatecall`, or `tx.origin` usage in any contract
- All `.call{value}` patterns follow CEI with `nonReentrant` guard
- `unchecked` / `assembly` only in `UniversalSigValidator.sol` (unchanged)
- Overflow in `stakes[stakeRoot].amount * maxPriceMultiplier` (L557) is safe: `amount` is bounded by ETH supply (~1.2×10^26 wei) and `maxPriceMultiplier` is admin-set; product stays well within `uint256` range
- 94 tests pass (37 CP unit + 43 Marketplace unit + 7 fuzz + 7 invariant)
