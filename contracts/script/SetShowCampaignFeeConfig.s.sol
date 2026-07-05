// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title SetShowCampaignFeeConfig
 * @notice Updates ShowCampaignEscrow fee configuration.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   NEW_FEE_BPS - new fee rate in basis points
 *   NEW_FEE_RECIPIENT - new fee recipient
 *
 * Rate changes affect future campaigns only. Recipient changes rotate the
 * charge-time recipient for all fee collection.
 *
 * The signer must be the ShowCampaignEscrow owner.
 */
contract SetShowCampaignFeeConfig is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        uint256 newFeeBps = vm.envUint("NEW_FEE_BPS");
        address newFeeRecipient = vm.envAddress("NEW_FEE_RECIPIENT");

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== Updating ShowCampaignEscrow fee config ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.log("Current fee BPS:", escrow.campaignFeeBps());
        console.log("New fee BPS:", newFeeBps);
        console.log("Current fee recipient:", escrow.feeRecipient());
        console.log("New fee recipient:", newFeeRecipient);
        console.log("Rate applies to future campaigns only.");
        console.log("Recipient rotates at charge time.");

        vm.startBroadcast(deployerKey);
        escrow.setFeeConfig(newFeeBps, newFeeRecipient);
        vm.stopBroadcast();

        console.log("");
        console.log("=== ShowCampaignEscrow fee config update complete ===");
        console.log("Fee BPS:", escrow.campaignFeeBps());
        console.log("Fee recipient:", escrow.feeRecipient());
    }
}
