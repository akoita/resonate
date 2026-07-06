// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title ReleaseShowCampaignFunds
 * @notice Releases remaining funds for a fulfilled ShowCampaignEscrow campaign.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   CAMPAIGN_ID - campaign id to release
 *
 * The signer must use a deployment-safe private key. releaseFunds is permissionless.
 */
contract ReleaseShowCampaignFunds is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        uint256 campaignId = vm.envUint("CAMPAIGN_ID");

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);
        (,, uint256 totalReleasedBefore) = escrow.campaignAccounting(campaignId);
        (, uint256 totalFeePaidBefore) = escrow.campaignFees(campaignId);

        console.log("=== Releasing Show campaign funds ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.log("Campaign ID:", campaignId);
        console.log("Campaign status before:", uint256(escrow.campaignStatus(campaignId)));
        console.log("Total released before:", totalReleasedBefore);
        console.log("Total fee paid before:", totalFeePaidBefore);

        vm.startBroadcast(deployerKey);
        escrow.releaseFunds(campaignId);
        vm.stopBroadcast();

        (,, uint256 totalReleasedAfter) = escrow.campaignAccounting(campaignId);
        (, uint256 totalFeePaidAfter) = escrow.campaignFees(campaignId);
        uint256 releaseGross = totalReleasedAfter - totalReleasedBefore;
        uint256 releaseFee = totalFeePaidAfter - totalFeePaidBefore;
        uint256 releaseNet = releaseGross - releaseFee;

        console.log("");
        console.log("=== Show campaign funds released ===");
        console.log("Campaign ID:", campaignId);
        console.log("Campaign status after:", uint256(escrow.campaignStatus(campaignId)));
        console.log("Total released after:", totalReleasedAfter);
        console.log("Total fee paid after:", totalFeePaidAfter);
        console.log("Release gross:", releaseGross);
        console.log("Release net:", releaseNet);
        console.log("Release fee:", releaseFee);
    }
}
