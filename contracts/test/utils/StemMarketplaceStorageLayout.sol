// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";

/// @dev Inspection-only harness that lays the exact ERC-7201 namespace struct
/// out from relative slot zero. The production contract roots the same type at
/// its ERC-7201 location; this harness lets the storage-layout CI gate detect
/// reordered, removed, or type-changed namespace members with `forge inspect`.
contract StemMarketplaceStorageLayout {
    StemMarketplaceV2.StemMarketplaceStorage internal layout;
}
