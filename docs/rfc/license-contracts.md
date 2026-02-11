---
title: "Smart Contract Interface Specifications — Licensing"
status: draft
author: "@akoita"
issue: "#310"
---

# Smart Contract Interface Specifications

This document defines the Solidity interfaces for the three new contracts introduced by the licensing architecture RFC. These are **interface specifications only** — implementations will be built in subsequent issues.

## Overview

| Contract           | Purpose                                  | Standard           |
| ------------------ | ---------------------------------------- | ------------------ |
| `ILicenseRegistry` | Mint, revoke, and query License NFTs     | ERC-1155 extension |
| `IRoyaltySplitter` | Multi-generational royalty distribution  | Custom             |
| `IAncestryTracker` | Remix lineage tracking with depth limits | Custom             |

---

## ILicenseRegistry

The `LicenseRegistry` mints License NFTs (ERC-1155) that serve as on-chain proof of licensing rights. It integrates with `StemNFT` to verify stem ownership and with `AncestryTracker` for derivative works.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILicenseRegistry {
    // ============ Structs ============

    struct LicenseTerms {
        bool exclusive;
        string territory;       // "worldwide" or ISO 3166-1 codes
        uint256 duration;       // seconds, 0 = perpetual
        string attribution;     // required credit text
        uint16 royaltyBps;      // ongoing royalty in basis points
        uint8 decayFactor;      // ancestry decay percentage
        uint8 modificationRights; // 0=none, 1=remix_only, 2=full
        bool sublicensable;
    }

    struct LicenseData {
        uint8 licenseType;      // 0=personal, 1=remix, 2=commercial, 3=sync, 4=sample, 5=broadcast
        uint256 stemTokenId;    // StemNFT token ID (0 = blanket)
        address grantor;        // rights holder
        address grantee;        // license holder
        LicenseTerms terms;
        string metadataURI;     // IPFS CID for full metadata JSON
        uint256 issuedAt;
        uint256 expiresAt;      // 0 = perpetual
        bool revoked;
    }

    // ============ Events ============

    event LicenseMinted(
        uint256 indexed licenseId,
        uint256 indexed stemTokenId,
        address indexed grantee,
        uint8 licenseType
    );

    event LicenseRevoked(
        uint256 indexed licenseId,
        address indexed revoker
    );

    event BlanketLicenseMinted(
        uint256 indexed licenseId,
        address indexed grantor,
        address indexed grantee,
        uint8 licenseType
    );

    // ============ Errors ============

    error NotStemOwner();
    error ExclusiveLicenseActive(uint256 stemTokenId);
    error LicenseExpired(uint256 licenseId);
    error LicenseAlreadyRevoked(uint256 licenseId);
    error InvalidLicenseType(uint8 licenseType);
    error InsufficientPayment();

    // ============ Core Functions ============

    /// @notice Mint a new License NFT for a specific stem
    /// @param stemTokenId The StemNFT token ID to license
    /// @param grantee Address receiving the license
    /// @param licenseType License type enum value
    /// @param terms License terms struct
    /// @param metadataURI IPFS CID for full license metadata
    /// @return licenseId The minted License NFT token ID
    function mintLicense(
        uint256 stemTokenId,
        address grantee,
        uint8 licenseType,
        LicenseTerms calldata terms,
        string calldata metadataURI
    ) external payable returns (uint256 licenseId);

    /// @notice Mint a blanket license covering all stems by the caller
    /// @param grantee Address receiving the license
    /// @param licenseType License type enum value
    /// @param terms License terms struct
    /// @param metadataURI IPFS CID for full license metadata
    /// @return licenseId The minted License NFT token ID
    function mintBlanketLicense(
        address grantee,
        uint8 licenseType,
        LicenseTerms calldata terms,
        string calldata metadataURI
    ) external payable returns (uint256 licenseId);

    /// @notice Revoke a license (grantor only)
    /// @param licenseId The License NFT token ID to revoke
    function revokeLicense(uint256 licenseId) external;

    // ============ View Functions ============

    /// @notice Get license data for a specific license ID
    function getLicense(uint256 licenseId) external view returns (LicenseData memory);

    /// @notice Check if a license is currently valid (not expired, not revoked)
    function isValidLicense(uint256 licenseId) external view returns (bool);

    /// @notice Check if an address holds a valid license for a stem
    function hasLicense(
        address holder,
        uint256 stemTokenId,
        uint8 licenseType
    ) external view returns (bool);

    /// @notice Check if an exclusive license is active for a stem
    function hasExclusiveLicense(uint256 stemTokenId) external view returns (bool);

    /// @notice Get all active license IDs for a stem
    function getLicensesByStem(uint256 stemTokenId) external view returns (uint256[] memory);

    /// @notice Get all active license IDs held by an address
    function getLicensesByHolder(address holder) external view returns (uint256[] memory);
}
```

---

## IRoyaltySplitter

The `RoyaltySplitter` walks the ancestry chain of a remix and distributes payments to all ancestor creators with diminishing shares. Integrates with `AncestryTracker` for lineage data.

See [Issue #309](https://github.com/akoita/resonate/issues/309) for the full recursive royalty design.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRoyaltySplitter {
    // ============ Structs ============

    struct SplitResult {
        address recipient;
        uint256 amount;
        uint8 generation;    // 0 = current creator, 1 = parent, etc.
    }

    // ============ Events ============

    event RoyaltySplit(
        uint256 indexed stemTokenId,
        uint256 totalAmount,
        uint8 generationsTraversed
    );

    event AncestorPaid(
        uint256 indexed stemTokenId,
        address indexed ancestor,
        uint256 amount,
        uint8 generation
    );

    // ============ Errors ============

    error AncestryTooDeep(uint256 stemTokenId, uint8 depth);
    error ZeroAmount();

    // ============ Core Functions ============

    /// @notice Split a payment across the ancestry chain of a stem
    /// @param stemTokenId The stem whose ancestry chain to traverse
    /// @dev Reads ancestry from AncestryTracker, computes diminishing shares,
    ///      and distributes payments to all ancestors up to MAX_DEPTH
    function splitPayment(uint256 stemTokenId) external payable;

    /// @notice Split an ERC-20 payment across the ancestry chain
    /// @param stemTokenId The stem whose ancestry chain to traverse
    /// @param paymentToken The ERC-20 token address
    /// @param amount Total amount to distribute
    function splitPaymentERC20(
        uint256 stemTokenId,
        address paymentToken,
        uint256 amount
    ) external;

    // ============ View Functions ============

    /// @notice Preview how a payment would be split without executing
    /// @param stemTokenId The stem to preview splits for
    /// @param totalAmount The total amount to distribute
    /// @return splits Array of SplitResult showing each recipient and amount
    function previewSplit(
        uint256 stemTokenId,
        uint256 totalAmount
    ) external view returns (SplitResult[] memory splits);

    /// @notice Get the maximum ancestry depth for royalty walks
    function maxDepth() external view returns (uint8);

    /// @notice Get the dust threshold below which amounts are aggregated
    function dustThreshold() external view returns (uint256);
}
```

---

## IAncestryTracker

The `AncestryTracker` maintains the full remix lineage tree. It extends the basic `parentIds[]` in `StemNFT` with depth tracking, efficient ancestry queries, and cycle prevention.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAncestryTracker {
    // ============ Structs ============

    struct AncestryNode {
        uint256 tokenId;
        address creator;
        uint256[] parentIds;
        uint8 depth;        // 0 = original, incremented per generation
    }

    // ============ Events ============

    event AncestryRecorded(
        uint256 indexed childTokenId,
        uint256[] parentIds,
        uint8 depth
    );

    // ============ Errors ============

    error MaxDepthExceeded(uint256 tokenId, uint8 depth);
    error CycleDetected(uint256 tokenId);
    error AncestryAlreadyRecorded(uint256 tokenId);

    // ============ Core Functions ============

    /// @notice Record ancestry for a newly minted remix
    /// @param childTokenId The remix token ID
    /// @param parentIds Array of parent stem token IDs
    /// @dev Called by StemNFT during mint, validates depth < MAX_DEPTH
    function recordAncestry(
        uint256 childTokenId,
        uint256[] calldata parentIds
    ) external;

    // ============ View Functions ============

    /// @notice Get the full ancestry node for a token
    function getAncestry(uint256 tokenId) external view returns (AncestryNode memory);

    /// @notice Get direct parent token IDs
    function getParents(uint256 tokenId) external view returns (uint256[] memory);

    /// @notice Get direct child token IDs (remixes of this stem)
    function getChildren(uint256 tokenId) external view returns (uint256[] memory);

    /// @notice Get the ancestry depth of a token (0 = original)
    function getDepth(uint256 tokenId) external view returns (uint8);

    /// @notice Walk the full ancestor chain up to maxDepth
    /// @param tokenId The token to trace ancestry for
    /// @return ancestors Ordered array from parent to oldest ancestor
    function getAncestorChain(uint256 tokenId) external view returns (AncestryNode[] memory ancestors);

    /// @notice Check if tokenA is an ancestor of tokenB
    function isAncestorOf(uint256 tokenA, uint256 tokenB) external view returns (bool);

    /// @notice Get the maximum allowed ancestry depth
    function maxDepth() external pure returns (uint8);
}
```

---

## Integration Notes

### Deployment Order

1. `AncestryTracker` — standalone, no dependencies
2. `LicenseRegistry` — depends on `StemNFT` address
3. `RoyaltySplitter` — depends on `StemNFT` + `AncestryTracker`

### Upgrade Path from Current Contracts

The existing `StemNFT` already stores `parentIds[]` for remixes. The `AncestryTracker` provides a richer interface on top of this data. Two migration options:

1. **Wrapper approach** — `AncestryTracker` reads `parentIds[]` from `StemNFT` and maintains its own depth index
2. **Hook approach** — Add a hook in `StemNFT.mint()` that calls `AncestryTracker.recordAncestry()` on remix mints

Option 1 is recommended for backwards compatibility — no changes needed to the deployed `StemNFT`.
