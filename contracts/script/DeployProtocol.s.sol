// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StemNFT} from "../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {TransferValidator} from "../src/modules/TransferValidator.sol";
import {
    ERC1967Proxy
} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployProtocol
 * @notice Deploys the Resonate Protocol (modular architecture)
 *
 * Deployment order:
 *   1. TransferValidator (optional module)
 *   2. ContentProtection (UUPS proxy)
 *   3. RevenueEscrow
 *   4. StemNFT (core)
 *   5. StemMarketplaceV2 (core)
 *   6. Configure: link modules, whitelist marketplace
 *
 * Run:
 *   forge script script/DeployProtocol.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployProtocol is Script {
    function run() external {
        uint256 deployerKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            )
        );
        address deployer = vm.addr(deployerKey);

        // Config
        string memory baseUri = vm.envOr(
            "BASE_URI",
            string("https://api.resonate.fm/metadata/")
        );
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(250)); // 2.5%
        uint256 stakeAmountWei = vm.envOr("STAKE_AMOUNT", uint256(0.01 ether)); // Default 0.01 ETH
        uint256 escrowPeriod = vm.envOr("ESCROW_PERIOD", uint256(30 days)); // Default 30 days

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Resonate Protocol (Modular) ===");
        console.log("Deployer:", deployer);
        console.log("");

        // 1. Deploy TransferValidator (optional module)
        TransferValidator validator = new TransferValidator();
        console.log("TransferValidator:", address(validator));

        // 2. Deploy ContentProtection (UUPS proxy)
        ContentProtection cpImpl = new ContentProtection();
        bytes memory cpInit = abi.encodeCall(
            ContentProtection.initialize,
            (deployer, feeRecipient, stakeAmountWei)
        );
        ERC1967Proxy cpProxy = new ERC1967Proxy(address(cpImpl), cpInit);
        ContentProtection contentProtection = ContentProtection(
            address(cpProxy)
        );
        console.log("ContentProtection (proxy):", address(contentProtection));

        // 3. Deploy RevenueEscrow
        RevenueEscrow escrow = new RevenueEscrow(deployer, escrowPeriod);
        console.log("RevenueEscrow:", address(escrow));

        // 4. Deploy StemNFT (core)
        StemNFT stemNFT = new StemNFT(baseUri);
        console.log("StemNFT:", address(stemNFT));

        // 5. Deploy StemMarketplaceV2 (core)
        StemMarketplaceV2 marketplace = new StemMarketplaceV2(
            address(stemNFT),
            feeRecipient,
            protocolFeeBps
        );
        console.log("StemMarketplaceV2:", address(marketplace));

        // 6. Configure
        stemNFT.setTransferValidator(address(validator));
        console.log("  -> Validator linked to StemNFT");

        stemNFT.setContentProtection(address(contentProtection));
        console.log("  -> ContentProtection linked to StemNFT");

        validator.setWhitelist(address(marketplace), true);
        console.log("  -> Marketplace whitelisted in validator");

        validator.setContentProtection(address(contentProtection));
        console.log("  -> ContentProtection linked to TransferValidator");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("");
        console.log("Core Contracts:");
        console.log("  StemNFT:", address(stemNFT));
        console.log("  StemMarketplaceV2:", address(marketplace));
        console.log("");
        console.log("Content Protection:");
        console.log("  ContentProtection (proxy):", address(contentProtection));
        console.log("  RevenueEscrow:", address(escrow));
        console.log("");
        console.log("Modules:");
        console.log("  TransferValidator:", address(validator));
        console.log("");
        console.log("Config:");
        console.log("  Protocol Fee:", protocolFeeBps, "bps");
        console.log("  Fee Recipient:", feeRecipient);
        console.log("  Stake Amount:", stakeAmountWei, "wei");
        console.log("  Escrow Period:", escrowPeriod, "seconds");
    }
}
