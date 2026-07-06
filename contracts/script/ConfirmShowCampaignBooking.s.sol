// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title ConfirmShowCampaignBooking
 * @notice Confirms that a funded ShowCampaignEscrow campaign has a booked show.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   CAMPAIGN_ID - campaign id to confirm
 *
 * The signer must be an allowed ShowCampaignEscrow confirmer.
 */
contract ConfirmShowCampaignBooking is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        uint256 campaignId = vm.envUint("CAMPAIGN_ID");

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== Confirming Show campaign booking ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.log("Campaign ID:", campaignId);
        console.log("Campaign status before:", uint256(escrow.campaignStatus(campaignId)));

        vm.startBroadcast(deployerKey);
        escrow.confirmBooking(campaignId);
        vm.stopBroadcast();

        console.log("");
        console.log("=== Show campaign booking confirmed ===");
        console.log("Campaign ID:", campaignId);
        console.log("Campaign status after:", uint256(escrow.campaignStatus(campaignId)));
    }
}
