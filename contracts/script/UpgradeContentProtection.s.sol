// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title UpgradeContentProtection
 * @notice Deploys a new ContentProtection implementation and upgrades the
 *         existing UUPS proxy, running reinitializeV4() to reserve the
 *         asset-aware staking storage version.
 *
 * Run:
 *   CONTENT_PROTECTION_PROXY=0x... forge script script/UpgradeContentProtection.s.sol \
 *     --rpc-url $RPC_URL --broadcast
 */
contract UpgradeContentProtection is DeploymentKey {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address proxyAddress = vm.envAddress("CONTENT_PROTECTION_PROXY");

        vm.startBroadcast(deployerKey);

        ContentProtection newImplementation = new ContentProtection();
        bytes memory initCall = abi.encodeCall(ContentProtection.reinitializeV4, ());

        ContentProtection(proxyAddress).upgradeToAndCall(address(newImplementation), initCall);

        vm.stopBroadcast();

        console.log("ContentProtection proxy:", proxyAddress);
        console.log("New implementation:", address(newImplementation));
        console.log("Upgrade complete with reinitializeV4()");
    }
}
