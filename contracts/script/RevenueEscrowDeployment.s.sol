// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @dev Shared RevenueEscrow UUPS deployment policy used by every deployment entrypoint.
abstract contract RevenueEscrowDeployment is DeploymentKey {
    uint256 internal constant DEFAULT_REVENUE_ESCROW_PERIOD = 30 days;
    uint256 internal constant DEFAULT_REVENUE_ESCROW_TIMELOCK_MIN_DELAY = 48 hours;

    struct RevenueEscrowConfig {
        address owner;
        address guardian;
        uint256 escrowPeriod;
        uint256 timelockMinDelay;
    }

    struct RevenueEscrowDeploymentResult {
        RevenueEscrow escrow;
        RevenueEscrow implementation;
        TimelockController timelock;
    }

    function _revenueEscrowConfig(address deployer) internal view returns (RevenueEscrowConfig memory config) {
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        config.owner = isLocal ? vm.envOr("REVENUE_ESCROW_OWNER", deployer) : vm.envAddress("REVENUE_ESCROW_OWNER");
        config.guardian =
            isLocal ? vm.envOr("REVENUE_ESCROW_GUARDIAN", config.owner) : vm.envAddress("REVENUE_ESCROW_GUARDIAN");
        config.escrowPeriod =
            vm.envOr("REVENUE_ESCROW_PERIOD", vm.envOr("ESCROW_PERIOD", DEFAULT_REVENUE_ESCROW_PERIOD));
        config.timelockMinDelay =
            vm.envOr("REVENUE_ESCROW_TIMELOCK_MIN_DELAY", DEFAULT_REVENUE_ESCROW_TIMELOCK_MIN_DELAY);

        require(config.owner != address(0), "REVENUE_ESCROW_OWNER cannot be zero");
        require(config.guardian != address(0), "REVENUE_ESCROW_GUARDIAN cannot be zero");
        require(isLocal || config.guardian != config.owner, "remote guardian must be independent from owner");
        require(isLocal || config.guardian != deployer, "remote guardian must be independent from deployer");
        require(
            isLocal || config.timelockMinDelay >= DEFAULT_REVENUE_ESCROW_TIMELOCK_MIN_DELAY,
            "remote timelock delay must be at least 48h"
        );
    }

    /// @dev Caller must have an active broadcast for `deployer`.
    function _deployRevenueEscrow(address deployer, RevenueEscrowConfig memory config)
        internal
        returns (RevenueEscrowDeploymentResult memory result)
    {
        result.implementation = new RevenueEscrow();

        address[] memory proposers = new address[](1);
        proposers[0] = config.owner;
        address[] memory executors = new address[](1);
        executors[0] = config.owner;
        result.timelock = new TimelockController(config.timelockMinDelay, proposers, executors, deployer);
        result.timelock.grantRole(result.timelock.PROPOSER_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.EXECUTOR_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.CANCELLER_ROLE(), config.guardian);
        result.timelock.renounceRole(result.timelock.DEFAULT_ADMIN_ROLE(), deployer);

        bytes memory initData =
            abi.encodeCall(RevenueEscrow.initialize, (config.owner, config.escrowPeriod, address(result.timelock)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(result.implementation), initData);
        result.escrow = RevenueEscrow(payable(address(proxy)));
    }
}
