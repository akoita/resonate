// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title SetMarketplaceProtocolFee
 * @notice Updates StemMarketplaceV2 fee configuration.
 *
 * Required env:
 *   MARKETPLACE_ADDRESS - existing StemMarketplaceV2 address
 *   NEW_PROTOCOL_FEE_BPS - new protocol fee in basis points
 *
 * Optional env:
 *   NEW_FEE_RECIPIENT - when set, rotates the protocol fee recipient
 *
 * The signer must be the StemMarketplaceV2 owner.
 */
contract SetMarketplaceProtocolFee is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address marketplaceAddress = vm.envAddress("MARKETPLACE_ADDRESS");
        uint256 newProtocolFeeBps = vm.envUint("NEW_PROTOCOL_FEE_BPS");
        address newFeeRecipient = vm.envOr("NEW_FEE_RECIPIENT", address(0));

        StemMarketplaceV2 marketplace = StemMarketplaceV2(payable(marketplaceAddress));

        console.log("=== Updating StemMarketplaceV2 protocol fee ===");
        console.log("Signer:", deployer);
        console.log("Marketplace:", marketplaceAddress);
        console.log("Current protocol fee BPS:", marketplace.protocolFeeBps());
        console.log("New protocol fee BPS:", newProtocolFeeBps);
        console.log("Current fee recipient:", marketplace.protocolFeeRecipient());
        if (newFeeRecipient != address(0)) {
            console.log("New fee recipient:", newFeeRecipient);
        } else {
            console.log("New fee recipient: unchanged");
        }

        vm.startBroadcast(deployerKey);
        if (newFeeRecipient != address(0)) {
            marketplace.setFeeRecipient(newFeeRecipient);
        }
        marketplace.setProtocolFee(newProtocolFeeBps);
        vm.stopBroadcast();

        console.log("");
        console.log("=== StemMarketplaceV2 protocol fee update complete ===");
        console.log("Protocol fee BPS:", marketplace.protocolFeeBps());
        console.log("Fee recipient:", marketplace.protocolFeeRecipient());
    }
}
