// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {TransferValidator} from "../src/modules/TransferValidator.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title DeployStemMarketplace
 * @notice Surgically redeploys StemMarketplaceV2 against an existing protocol graph.
 *
 * Required env:
 *   PRIVATE_KEY - deployer private key
 *   STEM_NFT_ADDRESS - existing StemNFT address
 *   CONTENT_PROTECTION_ADDRESS or CONTENT_PROTECTION_PROXY - existing ContentProtection proxy
 *   PAYMENT_ASSET_REGISTRY_ADDRESS - existing PaymentAssetRegistry address
 *
 * Optional env:
 *   FEE_RECIPIENT - platform fee recipient; required on remote envs, local defaults to deployer
 *   PROTOCOL_FEE_BPS - marketplace fee in basis points; defaults to 1000
 *   TRANSFER_VALIDATOR_ADDRESS - existing TransferValidator to whitelist the marketplace
 */
contract DeployStemMarketplace is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);

        address stemNft = vm.envAddress("STEM_NFT_ADDRESS");
        address contentProtection = vm.envOr("CONTENT_PROTECTION_ADDRESS", address(0));
        if (contentProtection == address(0)) {
            contentProtection = vm.envAddress("CONTENT_PROTECTION_PROXY");
        }
        address paymentAssetRegistry = vm.envAddress("PAYMENT_ASSET_REGISTRY_ADDRESS");

        address feeRecipient;
        if (block.chainid == 31337 || block.chainid == 1337) {
            feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        } else {
            feeRecipient = vm.envAddress("FEE_RECIPIENT");
        }
        uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(1000));
        address transferValidator = vm.envOr("TRANSFER_VALIDATOR_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        StemMarketplaceV2 marketplace =
            new StemMarketplaceV2(stemNft, contentProtection, paymentAssetRegistry, feeRecipient, protocolFeeBps);
        console.log("StemMarketplaceV2:", address(marketplace));

        ContentProtection(contentProtection).setRegistrar(address(marketplace), true);
        console.log("  -> Marketplace granted ContentProtection registrar role");

        if (transferValidator != address(0)) {
            TransferValidator(transferValidator).setWhitelist(address(marketplace), true);
            console.log("  -> Marketplace whitelisted in validator");
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== StemMarketplaceV2 Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("StemNFT:", stemNft);
        console.log("ContentProtection:", contentProtection);
        console.log("PaymentAssetRegistry:", paymentAssetRegistry);
        console.log("TransferValidator:", transferValidator);
        console.log("Protocol Fee BPS:", protocolFeeBps);
        console.log("Fee Recipient:", feeRecipient);
        console.log("StemMarketplaceV2:", address(marketplace));
    }
}
