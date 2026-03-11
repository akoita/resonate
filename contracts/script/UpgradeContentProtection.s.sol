// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";

/**
 * @title UpgradeContentProtection
 * @notice Deploys a new ContentProtection implementation and upgrades the
 *         existing UUPS proxy, running reinitializeV2() to seed new state.
 *
 * Run:
 *   CONTENT_PROTECTION_PROXY=0x... forge script script/UpgradeContentProtection.s.sol \
 *     --rpc-url $RPC_URL --broadcast
 */
contract UpgradeContentProtection is Script {
    function run() external {
        uint256 deployerKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address proxyAddress = vm.envAddress("CONTENT_PROTECTION_PROXY");

        vm.startBroadcast(deployerKey);

        ContentProtection newImplementation = new ContentProtection();
        bytes memory initCall = abi.encodeCall(
            ContentProtection.reinitializeV2,
            ()
        );

        ContentProtection(proxyAddress).upgradeToAndCall(
            address(newImplementation),
            initCall
        );

        vm.stopBroadcast();

        console.log("ContentProtection proxy:", proxyAddress);
        console.log("New implementation:", address(newImplementation));
        console.log("Upgrade complete with reinitializeV2()");
    }
}
