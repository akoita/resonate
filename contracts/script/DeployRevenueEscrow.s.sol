// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {RevenueEscrowDeployment} from "./RevenueEscrowDeployment.s.sol";

/// @notice Deploys only the RevenueEscrow implementation, timelock, and proxy graph.
contract DeployRevenueEscrow is RevenueEscrowDeployment {
    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        RevenueEscrowConfig memory config = _revenueEscrowConfig(deployer);

        vm.startBroadcast(deployerKey);
        RevenueEscrowDeploymentResult memory deployment = _deployRevenueEscrow(deployer, config);
        vm.stopBroadcast();

        console.log("=== RevenueEscrow (UUPS) Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Ops owner:", config.owner);
        console.log("Guardian:", config.guardian);
        console.log("Default escrow period (s):", config.escrowPeriod);
        console.log("Timelock min delay (s):", config.timelockMinDelay);
        console.log("Implementation:", address(deployment.implementation));
        console.log("RevenueEscrow (proxy):", address(deployment.escrow));
        console.log("Upgrade authority (timelock):", address(deployment.timelock));
    }
}
