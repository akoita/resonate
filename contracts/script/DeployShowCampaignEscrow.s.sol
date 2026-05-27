// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title DeployShowCampaignEscrow
 * @notice Deploys the standalone Shows campaign escrow coordinator.
 *
 * The contract does not reference the existing marketplace/content-protection
 * graph. Campaign creation binds artist authority, beneficiary, payment token,
 * thresholds, and deadlines per campaign.
 *
 * Required env:
 *   PRIVATE_KEY - deployer private key
 *
 * Optional env:
 *   SHOW_CAMPAIGN_ESCROW_OWNER - owner/ops multisig; defaults to deployer
 */
contract DeployShowCampaignEscrow is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("SHOW_CAMPAIGN_ESCROW_OWNER", deployer);

        vm.startBroadcast(deployerKey);

        ShowCampaignEscrow escrow = new ShowCampaignEscrow(owner);

        vm.stopBroadcast();

        console.log("=== ShowCampaignEscrow Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("ShowCampaignEscrow:", address(escrow));
    }
}
