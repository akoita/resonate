// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StemNFT} from "../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../src/modules/TransferValidator.sol";

/**
 * @title DeployProtocol
 * @notice Deploys the Resonate Protocol (modular architecture)
 *
 * Deployment order:
 *   1. TransferValidator (optional module)
 *   2. StemNFT (core)
 *   3. StemMarketplaceV2 (core)
 *   4. Configure: link validator to NFT, whitelist marketplace
 *
 * Run:
 *   forge script script/DeployProtocol.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployProtocol is Script {
    function run() external {
        uint256 deployerKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerKey);
        
        // Config
        string memory baseUri = vm.envOr("BASE_URI", string("https://api.resonate.fm/metadata/"));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(250)); // 2.5%

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Resonate Protocol (Modular) ===");
        console.log("Deployer:", deployer);
        console.log("");

        // 1. Deploy TransferValidator (optional module)
        TransferValidator validator = new TransferValidator();
        console.log("TransferValidator:", address(validator));

        // 2. Deploy StemNFT (core)
        StemNFT stemNFT = new StemNFT(baseUri);
        console.log("StemNFT:", address(stemNFT));

        // 3. Deploy StemMarketplaceV2 (core)
        StemMarketplaceV2 marketplace = new StemMarketplaceV2(
            address(stemNFT),
            feeRecipient,
            protocolFeeBps
        );
        console.log("StemMarketplaceV2:", address(marketplace));

        // 4. Configure
        // Link validator to NFT (optional - comment out for no transfer restrictions)
        stemNFT.setTransferValidator(address(validator));
        console.log("  -> Validator linked to StemNFT");

        // Whitelist marketplace in validator
        validator.setWhitelist(address(marketplace), true);
        console.log("  -> Marketplace whitelisted in validator");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("");
        console.log("Core Contracts:");
        console.log("  StemNFT:", address(stemNFT));
        console.log("  StemMarketplaceV2:", address(marketplace));
        console.log("");
        console.log("Modules:");
        console.log("  TransferValidator:", address(validator));
        console.log("");
        console.log("Config:");
        console.log("  Protocol Fee:", protocolFeeBps, "bps");
        console.log("  Fee Recipient:", feeRecipient);
    }
}
