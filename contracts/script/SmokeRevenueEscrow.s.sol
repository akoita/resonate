// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Read-only validation of RevenueEscrow configuration and authority graph.
contract SmokeRevenueEscrow is Script {
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external view {
        address proxy = vm.envAddress("REVENUE_ESCROW_ADDRESS");
        RevenueEscrow escrow = RevenueEscrow(payable(proxy));
        address owner = vm.envAddress("REVENUE_ESCROW_OWNER");
        address deployer = vm.envAddress("REVENUE_ESCROW_DEPLOYER");
        address guardian = vm.envAddress("REVENUE_ESCROW_GUARDIAN");
        address implementation = vm.envAddress("REVENUE_ESCROW_IMPLEMENTATION");
        address timelockAddress = vm.envAddress("REVENUE_ESCROW_TIMELOCK_ADDRESS");
        uint256 period = vm.envUint("REVENUE_ESCROW_PERIOD");
        uint256 delay = vm.envUint("REVENUE_ESCROW_TIMELOCK_MIN_DELAY");
        bool expectedPaused = vm.envOr("REVENUE_ESCROW_PAUSED", false);

        require(proxy.code.length != 0, "proxy has no code");
        require(owner != address(0) && escrow.owner() == owner, "owner mismatch");
        require(escrow.defaultEscrowPeriod() == period, "escrow period mismatch");
        require(escrow.upgradeAuthority() == timelockAddress, "upgrade authority mismatch");
        require(escrow.paused() == expectedPaused, "paused state mismatch");
        address liveImplementation = address(uint160(uint256(vm.load(proxy, ERC1967_IMPLEMENTATION_SLOT))));
        require(liveImplementation == implementation, "implementation slot mismatch");

        TimelockController timelock = TimelockController(payable(timelockAddress));
        require(timelock.getMinDelay() == delay, "timelock delay mismatch");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), deployer), "deployer remains admin");
        require(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), timelockAddress), "timelock is not self-admin");
        _requireRecoveryRoles(timelock, owner);
        _requireRecoveryRoles(timelock, guardian);
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        require(isLocal || (guardian != owner && guardian != deployer), "guardian is not independent");
        require(isLocal || delay >= 48 hours, "timelock delay below 48h");

        console.log("RevenueEscrow authority graph/config smoke check passed:", proxy);
    }

    function _requireRecoveryRoles(TimelockController timelock, address account) internal view {
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), account), "recovery account is not proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), account), "recovery account is not executor");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), account), "recovery account is not canceller");
    }
}
