# Smart Contract Vulnerability Scan — Issue #440

**Date:** 2026-03-11
**Branch:** `feat/440-content-protection-hierarchy`
**Changed contracts:** `ContentProtection.sol`, `StemNFT.sol`, `CurationRewards.sol`, `RevenueEscrow.sol`

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 0     |
| Medium   | 0     |
| Low      | 0     |
| Info     | 1     |

## Findings

### ~~Unbounded Loop in revokeRelease~~ — FIXED

**Status:** Resolved. `revokeRelease()` now caps at 50 tracks (reverts above). A new `revokeReleaseBatch(releaseId, offset, limit)` handles large releases with paginated revocation.

---

### EIP-712 Domain Hardcoded in Constructor

**File:** `StemNFT.sol` constructor
**Severity:** Informational

**Description:** The EIP-712 domain name/version are hardcoded as `"Resonate StemNFT"` / `"1"`. This is standard practice but means proxy deployments sharing the same implementation would share the domain separator.

**Recommendation:** No action needed — `StemNFT` is not behind a proxy.

## Scan Details

- **Reentrancy:** All `.call{value}` uses follow CEI + `nonReentrant` ✅
- **Access control:** All state-changing functions gated by `onlyOwner` or `onlyRegistrarOrOwner` ✅
- **Dangerous patterns:** No `selfdestruct`, `delegatecall`, or `tx.origin` ✅
- **Replay protection:** `mintAuthorized` uses per-minter nonce tracking ✅
- **Signature validation:** Uses OpenZeppelin's `ECDSA.recover` + `EIP712._hashTypedDataV4` ✅
- **Loop bounds:** `revokeRelease` capped at 50; paginated `revokeReleaseBatch` for larger sets ✅
