// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {StemNFT} from "../src/core/StemNFT.sol";
import {TransferValidator} from "../src/modules/TransferValidator.sol";
import {
    IAccessControl
} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    ERC1967Proxy
} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployContentProtection
 * @notice Deploys ONLY the Phase 2 Content Protection contracts and links them
 *         to an existing StemNFT + TransferValidator deployment.
 *
 * Prerequisites:
 *   - StemNFT and TransferValidator must already be deployed
 *   - Set STEM_NFT_ADDRESS and TRANSFER_VALIDATOR_ADDRESS env vars
 *
 * On a local fork, the script impersonates the contract admin to link
 * the new ContentProtection contract. Set EXISTING_ADMIN env var to the
 * address that has DEFAULT_ADMIN_ROLE on StemNFT (typically the original deployer).
 *
 * Run (local fork):
 *   EXISTING_ADMIN=0x... forge script script/DeployContentProtection.s.sol \
 *     --rpc-url http://localhost:8545 --broadcast
 *
 * Run (testnet — you must be the contract admin):
 *   forge script script/DeployContentProtection.s.sol \
 *     --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployContentProtection is Script {
    function run() external {
        uint256 deployerKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            )
        );
        address deployer = vm.addr(deployerKey);

        // Existing contract addresses (REQUIRED)
        address stemNFTAddr = vm.envAddress("STEM_NFT_ADDRESS");
        address validatorAddr = vm.envAddress("TRANSFER_VALIDATOR_ADDRESS");

        // Optional: existing admin address for fork impersonation
        address existingAdmin = vm.envOr("EXISTING_ADMIN", deployer);

        // Config
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint256 stakeAmountWei = vm.envOr("STAKE_AMOUNT", uint256(0.01 ether));
        uint256 escrowPeriod = vm.envOr("ESCROW_PERIOD", uint256(30 days));

        console.log("=== Deploying Content Protection (Phase 2) ===");
        console.log("Deployer:", deployer);
        console.log("Existing StemNFT:", stemNFTAddr);
        console.log("Existing TransferValidator:", validatorAddr);
        if (existingAdmin != deployer) {
            console.log("Existing Admin (will impersonate):", existingAdmin);
        }
        console.log("");

        vm.startBroadcast(deployerKey);

        // 1. Deploy ContentProtection (UUPS proxy)
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

        // 2. Deploy RevenueEscrow
        RevenueEscrow escrow = new RevenueEscrow(deployer, escrowPeriod);
        console.log("RevenueEscrow:", address(escrow));

        vm.stopBroadcast();

        // 3. Link to existing contracts
        StemNFT stemNFT = StemNFT(stemNFTAddr);
        TransferValidator validator = TransferValidator(validatorAddr);

        if (existingAdmin != deployer) {
            // Fork mode — impersonate the admin who has DEFAULT_ADMIN_ROLE
            console.log("  Impersonating admin for linking:", existingAdmin);
            vm.startPrank(existingAdmin);
            stemNFT.setContentProtection(address(contentProtection));
            console.log("  -> ContentProtection linked to StemNFT");
            validator.setContentProtection(address(contentProtection));
            console.log("  -> ContentProtection linked to TransferValidator");
            vm.stopPrank();
        } else {
            // We ARE the admin — use normal broadcast
            vm.startBroadcast(deployerKey);
            stemNFT.setContentProtection(address(contentProtection));
            console.log("  -> ContentProtection linked to StemNFT");
            validator.setContentProtection(address(contentProtection));
            console.log("  -> ContentProtection linked to TransferValidator");
            vm.stopBroadcast();
        }

        console.log("");
        console.log("=== Phase 2 Deployment Complete ===");
        console.log("");
        console.log("New Contracts:");
        console.log("  ContentProtection (proxy):", address(contentProtection));
        console.log("  RevenueEscrow:", address(escrow));
        console.log("");
        console.log("Config:");
        console.log("  Stake Amount:", stakeAmountWei, "wei");
        console.log("  Escrow Period:", escrowPeriod, "seconds");
        console.log("  Treasury:", feeRecipient);
        console.log("");
        console.log("Next steps:");
        console.log("  1. Run: ./scripts/update-protocol-config.sh");
        console.log("  2. Restart frontend: make web-dev-fork");
    }
}
