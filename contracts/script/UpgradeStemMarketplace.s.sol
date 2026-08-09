// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @notice Schedules or executes a StemMarketplaceV2 UUPS upgrade through its timelock.
contract UpgradeStemMarketplace is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        string memory action = vm.envString("UPGRADE_ACTION");
        address proxy = vm.envAddress("MARKETPLACE_ADDRESS");
        TimelockController timelock = TimelockController(payable(vm.envAddress("MARKETPLACE_TIMELOCK_ADDRESS")));
        bytes32 salt = vm.envOr("MARKETPLACE_UPGRADE_SALT", bytes32(0));

        if (keccak256(bytes(action)) == keccak256("schedule")) {
            _schedule(signerKey, signer, proxy, timelock, salt);
        } else if (keccak256(bytes(action)) == keccak256("execute")) {
            _execute(signerKey, signer, proxy, timelock, salt);
        } else {
            revert("UPGRADE_ACTION must be 'schedule' or 'execute'");
        }
    }

    function _calldata(address newImplementation) internal pure returns (bytes memory) {
        return abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (newImplementation, bytes("")));
    }

    function _schedule(uint256 signerKey, address signer, address proxy, TimelockController timelock, bytes32 salt)
        internal
    {
        uint256 delay = timelock.getMinDelay();
        vm.startBroadcast(signerKey);
        StemMarketplaceV2 newImplementation = new StemMarketplaceV2();
        bytes memory data = _calldata(address(newImplementation));
        timelock.schedule(proxy, 0, data, bytes32(0), salt, delay);
        vm.stopBroadcast();

        bytes32 operationId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);
        console.log("=== StemMarketplaceV2 upgrade SCHEDULED ===");
        console.log("Signer:", signer);
        console.log("Proxy:", proxy);
        console.log("Timelock:", address(timelock));
        console.log("New implementation:", address(newImplementation));
        console.log("Delay (s):", delay);
        console.log("ETA (unix):", block.timestamp + delay);
        console.log("Operation id:");
        console.logBytes32(operationId);
    }

    function _execute(uint256 signerKey, address signer, address proxy, TimelockController timelock, bytes32 salt)
        internal
    {
        address newImplementation = vm.envAddress("NEW_IMPLEMENTATION");
        bytes memory data = _calldata(newImplementation);
        bytes32 operationId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);
        vm.startBroadcast(signerKey);
        timelock.execute(proxy, 0, data, bytes32(0), salt);
        vm.stopBroadcast();

        console.log("=== StemMarketplaceV2 upgrade EXECUTED ===");
        console.log("Signer:", signer);
        console.log("Proxy:", proxy);
        console.log("New implementation:", newImplementation);
        console.log("Operation id:");
        console.logBytes32(operationId);
    }
}
