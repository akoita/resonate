// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

contract SetStemMarketplacePaused is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        address proxy = vm.envAddress("MARKETPLACE_ADDRESS");
        bool paused = vm.envBool("PAUSED");

        vm.startBroadcast(signerKey);
        StemMarketplaceV2(payable(proxy)).setPaused(paused);
        vm.stopBroadcast();

        console.log("StemMarketplaceV2 proxy:", proxy);
        console.log("Owner signer:", signer);
        console.log("Paused:", paused);
    }
}
