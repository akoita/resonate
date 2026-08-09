// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";

contract StemMarketplaceV2UpgradeMock is StemMarketplaceV2 {
    function version() external pure returns (uint256) {
        return 3;
    }

    function storageLocation() external pure returns (bytes32) {
        return StemMarketplaceStorageLocation;
    }
}
