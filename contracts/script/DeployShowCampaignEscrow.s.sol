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
 *   SHOW_CAMPAIGN_FEE_BPS - success-only campaign fee in basis points; defaults to 600
 *   SHOW_CAMPAIGN_FEE_RECIPIENT - fee recipient; required on remote envs, local defaults to owner
 */
contract DeployShowCampaignEscrow is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("SHOW_CAMPAIGN_ESCROW_OWNER", deployer);
        uint256 feeBps = vm.envOr("SHOW_CAMPAIGN_FEE_BPS", uint256(600));
        address feeRecipient;
        if (block.chainid == 31337 || block.chainid == 1337) {
            feeRecipient = vm.envOr("SHOW_CAMPAIGN_FEE_RECIPIENT", owner);
        } else {
            feeRecipient = vm.envAddress("SHOW_CAMPAIGN_FEE_RECIPIENT");
        }

        vm.startBroadcast(deployerKey);

        ShowCampaignEscrow escrow = new ShowCampaignEscrow(owner, feeBps, feeRecipient);

        vm.stopBroadcast();

        console.log("=== ShowCampaignEscrow Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("Fee BPS:", feeBps);
        console.log("Fee Recipient:", feeRecipient);
        console.log("ShowCampaignEscrow:", address(escrow));
    }
}
