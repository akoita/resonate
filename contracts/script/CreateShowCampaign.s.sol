// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title CreateShowCampaign
 * @notice Creates and activates a ShowCampaignEscrow campaign.
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - existing ShowCampaignEscrow address
 *   ARTIST_ID_HASH - bytes32 hex value, or a plain string to keccak256
 *   AUTHORITY_HASH - bytes32 hex value, or a plain string to keccak256
 *   BENEFICIARY - artist/venue beneficiary
 *   PAYMENT_TOKEN - ERC-20 payment token
 *   GOAL_UNITS - funding goal in token base units
 *   MIN_BACKERS - minimum distinct backers
 *   FUNDING_DEADLINE - funding deadline as unix seconds
 *   BOOKING_DEADLINE - booking deadline as unix seconds
 *
 * Optional env:
 *   DEPOSIT_RELEASE_BPS - defaults to 0
 *   DISPUTE_WINDOW_SECONDS - defaults to 604800
 *
 * The signer must be the ShowCampaignEscrow owner.
 */
contract CreateShowCampaign is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        string memory artistIdHashInput = vm.envString("ARTIST_ID_HASH");
        string memory authorityHashInput = vm.envString("AUTHORITY_HASH");
        bytes32 artistIdHash = _bytes32OrKeccak(artistIdHashInput);
        bytes32 authorityHash = _bytes32OrKeccak(authorityHashInput);
        address beneficiary = vm.envAddress("BENEFICIARY");
        address paymentToken = vm.envAddress("PAYMENT_TOKEN");
        uint256 goalUnits = vm.envUint("GOAL_UNITS");
        uint256 minBackers = vm.envUint("MIN_BACKERS");
        uint256 fundingDeadline = vm.envUint("FUNDING_DEADLINE");
        uint256 bookingDeadline = vm.envUint("BOOKING_DEADLINE");
        uint256 depositReleaseBps = vm.envOr("DEPOSIT_RELEASE_BPS", uint256(0));
        uint256 disputeWindowSeconds = vm.envOr("DISPUTE_WINDOW_SECONDS", uint256(604800));

        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== Creating and activating Show campaign ===");
        console.log("Signer:", deployer);
        console.log("ShowCampaignEscrow:", escrowAddress);
        console.logBytes32(artistIdHash);
        console.log("Artist ID hash above");
        console.logBytes32(authorityHash);
        console.log("Authority hash above");
        console.log("Beneficiary:", beneficiary);
        console.log("Payment token:", paymentToken);
        console.log("Goal units:", goalUnits);
        console.log("Minimum backers:", minBackers);
        console.log("Funding deadline:", fundingDeadline);
        console.log("Booking deadline:", bookingDeadline);
        console.log("Deposit release BPS:", depositReleaseBps);
        console.log("Dispute window seconds:", disputeWindowSeconds);

        vm.startBroadcast(deployerKey);
        uint256 campaignId = escrow.createCampaign(
            artistIdHash,
            authorityHash,
            beneficiary,
            paymentToken,
            goalUnits,
            minBackers,
            fundingDeadline,
            bookingDeadline,
            depositReleaseBps,
            disputeWindowSeconds
        );
        escrow.activateCampaign(campaignId);
        vm.stopBroadcast();

        console.log("");
        console.log("=== Show campaign created and activated ===");
        console.log("CAMPAIGN_ID:", campaignId);
        console.log("ShowCampaignEscrow:", escrowAddress);
    }

    function _bytes32OrKeccak(string memory value) private pure returns (bytes32) {
        bytes memory raw = bytes(value);
        if (raw.length == 66 && raw[0] == "0" && (raw[1] == "x" || raw[1] == "X")) {
            return vm.parseBytes32(value);
        }
        return keccak256(raw);
    }
}
