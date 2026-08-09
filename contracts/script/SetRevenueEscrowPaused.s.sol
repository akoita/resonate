// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

contract SetRevenueEscrowPaused is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        address proxy = vm.envAddress("REVENUE_ESCROW_ADDRESS");
        bool paused = vm.envBool("PAUSED");

        vm.startBroadcast(signerKey);
        RevenueEscrow(payable(proxy)).setPaused(paused);
        vm.stopBroadcast();

        console.log("RevenueEscrow:", proxy);
        console.log("Owner signer:", signer);
        console.log("Paused:", paused);
    }
}
