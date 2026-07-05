// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title SetShowCampaignConfirmer
 * @notice Allows or revokes a ShowCampaignEscrow confirmer.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   CONFIRMER_ADDRESS - confirmer address to update
 *   CONFIRMER_ALLOWED - true to allow, false to revoke
 *
 * The signer must be the ShowCampaignEscrow owner.
 */
contract SetShowCampaignConfirmer is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        address confirmer = vm.envAddress("CONFIRMER_ADDRESS");
        bool allowed = vm.envBool("CONFIRMER_ALLOWED");

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== Updating ShowCampaignEscrow confirmer ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.log("Confirmer:", confirmer);
        console.log("Current allowed:", escrow.confirmers(confirmer));
        console.log("Target allowed:", allowed);

        vm.startBroadcast(deployerKey);
        escrow.setConfirmer(confirmer, allowed);
        vm.stopBroadcast();

        console.log("");
        console.log("=== ShowCampaignEscrow confirmer update complete ===");
        console.log("Confirmer:", confirmer);
        console.log("Allowed:", escrow.confirmers(confirmer));
    }
}
