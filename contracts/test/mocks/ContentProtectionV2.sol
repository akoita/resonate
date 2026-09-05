// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ContentProtection} from "../../src/core/ContentProtection.sol";

contract ContentProtectionV2 is ContentProtection {
    function version() external pure returns (uint256) {
        return 2;
    }
}
