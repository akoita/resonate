# Smart Contract Vulnerability Scan

**Date:** 2026-04-07
**Scope:** `contracts/src/core/ContentProtection.sol`, `contracts/src/core/StemMarketplaceV2.sol`, `contracts/src/core/StemNFT.sol`, related deployment wiring and unit-test coverage
**Version:** Solidity ^0.8.28

## Executive Summary

The current branch enforces stake-based listing caps for protected stems across both mint-and-list and later resale listing flows. No Critical or High severity vulnerabilities were identified in the modified contract paths after the mint-time protection-root registration fix.

## Findings

### SCV-001: Uncapped fallback when no active stake exists

**File:** `contracts/src/core/ContentProtection.sol` L552-L558
**Severity:** Informational

**Description:** `getMaxListingPrice()` returns `type(uint256).max` when the resolved protection root has no active stake. That behavior is consistent with the intended policy for unstaked content, but it makes stake enforcement depend entirely on correct root registration and active stake state.

**Recommendation:** Keep this behavior, but document it clearly in contract NatSpec and integration docs so listing clients understand that inactive or missing stake roots intentionally remove the cap.

---

### SCV-002: External registrar call before marketplace state write

**File:** `contracts/src/core/StemMarketplaceV2.sol` L156-L157
**Severity:** Informational

**Description:** `listLastMint()` calls `contentProtection.registerStemProtectionRoot()` before `_createListing()`. This ordering is necessary because `_createListing()` reads `getMaxListingPrice()`. The called function is restricted to owner/registrars and performs a direct mapping write, so this is not a reentrancy issue in the current design.

**Recommendation:** No code change required. Preserve this ordering and keep registrar permissions narrowly scoped.

## Resolved During Review

### Protected stem resale path could bypass the stake cap

**Files:** `contracts/src/core/StemNFT.sol`, `contracts/src/core/StemMarketplaceV2.sol`
**Severity:** High -> Resolved on this branch

**Description:** Before the fix, protected stems only registered their protection root during `listLastMint()`. A protected stem minted in one transaction and listed later through ordinary `list()` could bypass the stake cap because `getMaxListingPrice()` had no registered root to resolve.

**Fix:** `StemNFT._mintStem()` now registers the protection root at mint time for protected mints, and the deployment script grants `StemNFT` registrar access in `ContentProtection`.

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 0     |
| Medium        | 0     |
| Low           | 0     |
| Informational | 2     |

## Validation Notes

- Access control remains enforced on the new write path via `onlyRegistrarOrOwner`
- No `delegatecall`, `selfdestruct`, or `tx.origin` usage in the modified scope
- The new regression test covers the previously missing protected-mint then later `list()` path
- Targeted verification passed:
  - `forge test --match-path test/unit/StemNFT.t.sol -vvv`
  - `forge test --match-path test/unit/StemMarketplace.t.sol -vvv`
