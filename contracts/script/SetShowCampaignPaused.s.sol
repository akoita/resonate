// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title SetShowCampaignPaused
 * @notice Pauses or unpauses ShowCampaignEscrow pledging.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   PAUSED - true to pause, false to unpause
 *
 * The signer must be the ShowCampaignEscrow owner.
 */
contract SetShowCampaignPaused is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        bool paused = vm.envBool("PAUSED");

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== Updating ShowCampaignEscrow pause state ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.log("Current paused:", escrow.paused());
        console.log("Target paused:", paused);

        vm.startBroadcast(deployerKey);
        escrow.setPaused(paused);
        vm.stopBroadcast();

        console.log("");
        console.log("=== ShowCampaignEscrow pause update complete ===");
        console.log("Paused:", escrow.paused());
    }
}
