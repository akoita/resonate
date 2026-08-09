// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";

/// @notice Storage-free upgrade target used to prove RevenueEscrow state preservation.
contract RevenueEscrowV2 is RevenueEscrow {
    function version() external pure returns (uint256) {
        return 2;
    }
}
