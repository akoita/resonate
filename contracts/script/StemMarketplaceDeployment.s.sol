// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @dev Shared guarded UUPS deployment policy for StemMarketplaceV2.
abstract contract StemMarketplaceDeployment is DeploymentKey {
    uint256 internal constant DEFAULT_MARKETPLACE_TIMELOCK_MIN_DELAY = 48 hours;

    struct StemMarketplaceConfig {
        address owner;
        address guardian;
        uint256 timelockMinDelay;
    }

    struct StemMarketplaceDeploymentResult {
        StemMarketplaceV2 marketplace;
        StemMarketplaceV2 implementation;
        TimelockController timelock;
    }

    function _stemMarketplaceConfig(address deployer) internal view returns (StemMarketplaceConfig memory config) {
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        config.owner = isLocal ? vm.envOr("MARKETPLACE_OWNER", deployer) : vm.envAddress("MARKETPLACE_OWNER");
        config.guardian =
            isLocal ? vm.envOr("MARKETPLACE_GUARDIAN", config.owner) : vm.envAddress("MARKETPLACE_GUARDIAN");
        config.timelockMinDelay = vm.envOr("MARKETPLACE_TIMELOCK_MIN_DELAY", DEFAULT_MARKETPLACE_TIMELOCK_MIN_DELAY);

        require(config.owner != address(0), "MARKETPLACE_OWNER cannot be zero");
        require(config.guardian != address(0), "MARKETPLACE_GUARDIAN cannot be zero");
        require(isLocal || config.guardian != config.owner, "remote guardian must be independent from owner");
        require(isLocal || config.guardian != deployer, "remote guardian must be independent from deployer");
        require(
            isLocal || config.timelockMinDelay >= DEFAULT_MARKETPLACE_TIMELOCK_MIN_DELAY,
            "remote timelock delay must be at least 48h"
        );
    }

    /// @dev Caller must have an active broadcast for `deployer`.
    function _deployStemMarketplace(
        address deployer,
        StemMarketplaceConfig memory config,
        address stemNft,
        address contentProtection,
        address paymentAssetRegistry,
        address feeRecipient,
        uint256 protocolFeeBps
    ) internal returns (StemMarketplaceDeploymentResult memory result) {
        result.implementation = new StemMarketplaceV2();

        address[] memory proposers = new address[](1);
        proposers[0] = config.owner;
        address[] memory executors = new address[](1);
        executors[0] = config.owner;
        result.timelock = new TimelockController(config.timelockMinDelay, proposers, executors, deployer);
        result.timelock.grantRole(result.timelock.PROPOSER_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.EXECUTOR_ROLE(), config.guardian);
        result.timelock.grantRole(result.timelock.CANCELLER_ROLE(), config.guardian);
        result.timelock.renounceRole(result.timelock.DEFAULT_ADMIN_ROLE(), deployer);

        bytes memory initData = abi.encodeCall(
            StemMarketplaceV2.initialize,
            (
                stemNft,
                contentProtection,
                paymentAssetRegistry,
                feeRecipient,
                protocolFeeBps,
                config.owner,
                address(result.timelock)
            )
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(result.implementation), initData);
        result.marketplace = StemMarketplaceV2(payable(address(proxy)));
    }
}
