// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ContentProtection} from "../src/core/ContentProtection.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @dev Shared guarded UUPS deployment policy for ContentProtection.
abstract contract ContentProtectionDeployment is DeploymentKey {
    uint256 internal constant DEFAULT_CONTENT_PROTECTION_TIMELOCK_MIN_DELAY = 48 hours;

    struct ContentProtectionConfig {
        address owner;
        address guardian;
        uint256 timelockMinDelay;
    }

    struct ContentProtectionDeploymentResult {
        ContentProtection contentProtection;
        ContentProtection implementation;
        TimelockController timelock;
    }

    function _contentProtectionConfig(address deployer) internal view returns (ContentProtectionConfig memory config) {
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        config.owner =
            isLocal ? vm.envOr("CONTENT_PROTECTION_OWNER", deployer) : vm.envAddress("CONTENT_PROTECTION_OWNER");
        config.guardian = isLocal
            ? vm.envOr("CONTENT_PROTECTION_GUARDIAN", config.owner)
            : vm.envAddress("CONTENT_PROTECTION_GUARDIAN");
        config.timelockMinDelay =
            vm.envOr("CONTENT_PROTECTION_TIMELOCK_MIN_DELAY", DEFAULT_CONTENT_PROTECTION_TIMELOCK_MIN_DELAY);

        require(config.owner != address(0), "CONTENT_PROTECTION_OWNER cannot be zero");
        require(config.guardian != address(0), "CONTENT_PROTECTION_GUARDIAN cannot be zero");
        require(isLocal || config.guardian != config.owner, "remote guardian must be independent from owner");
        require(isLocal || config.guardian != deployer, "remote guardian must be independent from deployer");
        require(
            isLocal || config.timelockMinDelay >= DEFAULT_CONTENT_PROTECTION_TIMELOCK_MIN_DELAY,
            "remote timelock delay must be at least 48h"
        );
    }

    /// @dev Caller must have an active broadcast for `deployer`. The deployer is the
    /// temporary operational owner so the graph can be linked atomically. Entry-point
    /// scripts must start a two-step transfer to `config.owner` after configuration.
    function _deployContentProtection(
        address deployer,
        ContentProtectionConfig memory config,
        address treasury,
        uint256 stakeAmount
    ) internal returns (ContentProtectionDeploymentResult memory result) {
        result = _deployContentProtectionImplementationAndTimelock(deployer, config);

        bytes memory initData = abi.encodeCall(
            ContentProtection.initializeFresh, (deployer, treasury, stakeAmount, address(result.timelock))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(result.implementation), initData);
        result.contentProtection = ContentProtection(payable(address(proxy)));
    }

    /// @dev Deploys and seals the implementation + governance graph without a proxy.
    /// Used by the one-time legacy migration so both addresses can be verified before
    /// the current owner atomically upgrades and initializes V6.
    function _deployContentProtectionImplementationAndTimelock(address deployer, ContentProtectionConfig memory config)
        internal
        returns (ContentProtectionDeploymentResult memory result)
    {
        result.implementation = new ContentProtection();

        address[] memory proposers = new address[](1);
        proposers[0] = config.owner;
        address[] memory executors = new address[](1);
        executors[0] = config.owner;
        result.timelock = new TimelockController(config.timelockMinDelay, proposers, executors, deployer);
        result.timelock.grantRole(result.timelock.PROPOSER_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.EXECUTOR_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.CANCELLER_ROLE(), config.guardian);
        result.timelock.renounceRole(result.timelock.DEFAULT_ADMIN_ROLE(), deployer);
    }
}
