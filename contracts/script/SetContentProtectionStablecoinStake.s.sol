// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";

/**
 * @title SetContentProtectionStablecoinStake
 * @notice Updates an existing ContentProtection proxy's ERC-20 stake amount.
 *
 * Required env:
 *   CONTENT_PROTECTION_ADDRESS - existing ContentProtection proxy
 *   STAKE_ASSET_ADDRESS or PAYMENT_USDC_ADDRESS - ERC-20 stake asset
 *
 * Optional env:
 *   STAKE_ASSET_AMOUNT or STAKE_USDC_AMOUNT - base units; defaults to 5000000 (5 USDC)
 *   STAKE_ASSET_SYMBOL - log label; defaults to USDC
 */
contract SetContentProtectionStablecoinStake is Script {
    function run() external {
        uint256 deployerKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);

        address contentProtectionAddress = vm.envAddress("CONTENT_PROTECTION_ADDRESS");
        address stakeAssetAddress = vm.envOr("STAKE_ASSET_ADDRESS", vm.envOr("PAYMENT_USDC_ADDRESS", address(0)));
        uint256 stakeAssetAmount = vm.envOr("STAKE_ASSET_AMOUNT", vm.envOr("STAKE_USDC_AMOUNT", uint256(5_000000)));
        string memory stakeAssetSymbol = vm.envOr("STAKE_ASSET_SYMBOL", string("USDC"));

        if (stakeAssetAddress == address(0)) {
            revert("Set STAKE_ASSET_ADDRESS or PAYMENT_USDC_ADDRESS");
        }

        ContentProtection contentProtection = ContentProtection(contentProtectionAddress);
        uint256 currentAmount = contentProtection.stakeAmountsByToken(stakeAssetAddress);

        console.log("=== Updating Content Protection stablecoin stake ===");
        console.log("Deployer:", deployer);
        console.log("ContentProtection:", contentProtectionAddress);
        console.log("Stake asset:", stakeAssetAddress);
        console.log("Stake symbol:", stakeAssetSymbol);
        console.log("Current amount:", currentAmount);
        console.log("Target amount:", stakeAssetAmount);

        if (currentAmount == stakeAssetAmount) {
            console.log("No update needed.");
            return;
        }

        vm.startBroadcast(deployerKey);
        contentProtection.setStakeAmountForAsset(stakeAssetAddress, stakeAssetAmount);
        vm.stopBroadcast();

        console.log("Stake amount updated.");
    }
}
