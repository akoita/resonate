// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

contract SetContentProtectionPaused is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        address proxy = vm.envAddress("CONTENT_PROTECTION_PROXY");
        bool paused = vm.envBool("CONTENT_PROTECTION_PAUSED");
        require(ContentProtection(payable(proxy)).owner() == signer, "signer is not operational owner");

        vm.startBroadcast(signerKey);
        ContentProtection(payable(proxy)).setPaused(paused);
        vm.stopBroadcast();

        console.log("ContentProtection:", proxy);
        console.log("Owner signer:", signer);
        console.log("Paused:", paused);
    }
}
