// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";

/**
 * @title ShowCampaignEscrowV2
 * @notice Minimal upgrade target used only in tests: identical behavior plus a
 *         `version()` marker, so an upgrade can be observed on-chain while all
 *         prior state (campaigns, balances, authority) must be preserved.
 * @dev Adds NO storage — only a pure function — so it is trivially layout-compatible.
 */
contract ShowCampaignEscrowV2 is ShowCampaignEscrow {
    function version() external pure returns (uint256) {
        return 2;
    }
}
