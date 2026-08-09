// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Script} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Read-only validation of ContentProtection configuration and authority graph.
contract SmokeContentProtection is Script {
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external view {
        address proxy = vm.envAddress("CONTENT_PROTECTION_PROXY");
        ContentProtection contentProtection = ContentProtection(payable(proxy));
        address governanceOwner = vm.envAddress("CONTENT_PROTECTION_OWNER");
        address liveOwner = vm.envOr("CONTENT_PROTECTION_LIVE_OWNER", governanceOwner);
        address pendingOwner = vm.envOr("CONTENT_PROTECTION_PENDING_OWNER", address(0));
        address deployer = vm.envAddress("CONTENT_PROTECTION_DEPLOYER");
        address guardian = vm.envAddress("CONTENT_PROTECTION_GUARDIAN");
        address implementation = vm.envAddress("CONTENT_PROTECTION_IMPLEMENTATION");
        address timelockAddress = vm.envAddress("CONTENT_PROTECTION_TIMELOCK_ADDRESS");
        uint256 delay = vm.envUint("CONTENT_PROTECTION_TIMELOCK_MIN_DELAY");
        bool expectedPaused = vm.envOr("CONTENT_PROTECTION_PAUSED", false);

        require(proxy.code.length != 0, "proxy has no code");
        require(liveOwner != address(0) && contentProtection.owner() == liveOwner, "owner mismatch");
        require(contentProtection.pendingOwner() == pendingOwner, "pending owner mismatch");
        require(contentProtection.upgradeAuthority() == timelockAddress, "upgrade authority mismatch");
        require(contentProtection.paused() == expectedPaused, "paused state mismatch");
        address liveImplementation = address(uint160(uint256(vm.load(proxy, ERC1967_IMPLEMENTATION_SLOT))));
        require(liveImplementation == implementation, "implementation slot mismatch");

        TimelockController timelock = TimelockController(payable(timelockAddress));
        require(timelock.getMinDelay() == delay, "timelock delay mismatch");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), deployer), "deployer remains admin");
        require(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), timelockAddress), "timelock is not self-admin");
        _requireRecoveryRoles(timelock, governanceOwner);
        _requireRecoveryRoles(timelock, guardian);
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        require(isLocal || (guardian != governanceOwner && guardian != deployer), "guardian is not independent");
        require(isLocal || delay >= 48 hours, "timelock delay below 48h");

        console.log("ContentProtection authority graph/config smoke check passed:", proxy);
    }

    function _requireRecoveryRoles(TimelockController timelock, address account) internal view {
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), account), "recovery account is not proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), account), "recovery account is not executor");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), account), "recovery account is not canceller");
    }
}
