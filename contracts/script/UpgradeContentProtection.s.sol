// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @notice Schedules or executes a post-V6 ContentProtection upgrade through its timelock.
/// @dev This script cannot perform the one-time owner-authorized V5 -> V6 bootstrap;
/// use MigrateContentProtectionV6 for that explicitly bounded operation.
contract UpgradeContentProtection is DeploymentKey {
    uint256 internal constant MIN_REMOTE_TIMELOCK_DELAY = 48 hours;
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        string memory action = vm.envString("UPGRADE_ACTION");
        address proxy = vm.envAddress("CONTENT_PROTECTION_PROXY");
        TimelockController timelock = TimelockController(payable(vm.envAddress("CONTENT_PROTECTION_TIMELOCK_ADDRESS")));
        bytes32 salt = vm.envOr("CONTENT_PROTECTION_UPGRADE_SALT", bytes32(0));

        require(ContentProtection(payable(proxy)).upgradeAuthority() == address(timelock), "timelock mismatch");
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        require(isLocal || timelock.getMinDelay() >= MIN_REMOTE_TIMELOCK_DELAY, "timelock delay below 48h");
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
        ContentProtection newImplementation = new ContentProtection();
        bytes memory data = _calldata(address(newImplementation));
        timelock.schedule(proxy, 0, data, bytes32(0), salt, delay);
        vm.stopBroadcast();

        bytes32 operationId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);
        console.log("=== ContentProtection upgrade SCHEDULED ===");
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
        require(newImplementation.code.length != 0, "new implementation has no code");
        require(
            ContentProtection(payable(newImplementation)).proxiableUUID() == ERC1967_IMPLEMENTATION_SLOT,
            "new implementation is not ERC1967-compatible"
        );
        bytes memory data = _calldata(newImplementation);
        bytes32 operationId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);
        vm.startBroadcast(signerKey);
        timelock.execute(proxy, 0, data, bytes32(0), salt);
        vm.stopBroadcast();

        console.log("=== ContentProtection upgrade EXECUTED ===");
        console.log("Signer:", signer);
        console.log("Proxy:", proxy);
        console.log("New implementation:", newImplementation);
        console.log("Operation id:");
        console.logBytes32(operationId);
    }
}
