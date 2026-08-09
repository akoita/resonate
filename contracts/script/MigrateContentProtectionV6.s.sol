// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ContentProtectionDeployment} from "./ContentProtectionDeployment.s.sol";

/// @notice One-time bootstrap from the owner-authorized V5 implementation to the
/// guarded V6 authority model. `prepare` deploys a verifiable candidate implementation
/// and timelock; `execute` performs the final atomic owner-authorized migration.
contract MigrateContentProtectionV6 is ContentProtectionDeployment {
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        string memory action = vm.envString("MIGRATION_ACTION");
        address proxy = vm.envAddress("CONTENT_PROTECTION_PROXY");

        if (keccak256(bytes(action)) == keccak256("prepare")) {
            _prepare(signerKey, signer, proxy);
        } else if (keccak256(bytes(action)) == keccak256("execute")) {
            _execute(signerKey, signer, proxy);
        } else {
            revert("MIGRATION_ACTION must be 'prepare' or 'execute'");
        }
    }

    function _prepare(uint256 signerKey, address signer, address proxy) internal {
        ContentProtection legacy = ContentProtection(payable(proxy));
        require(legacy.owner() == signer, "signer is not current owner");
        ContentProtectionConfig memory config = _contentProtectionConfig(signer);
        require(config.owner == signer, "CONTENT_PROTECTION_OWNER must be current owner");

        vm.startBroadcast(signerKey);
        ContentProtectionDeploymentResult memory deployment =
            _deployContentProtectionImplementationAndTimelock(signer, config);
        vm.stopBroadcast();

        console.log("=== ContentProtection V6 migration PREPARED ===");
        console.log("Proxy (unchanged):", proxy);
        console.log("Current owner:", signer);
        console.log("Candidate implementation:", address(deployment.implementation));
        console.log("Candidate timelock:", address(deployment.timelock));
        console.log("Guardian:", config.guardian);
        console.log("Delay (s):", config.timelockMinDelay);
        console.log("Verify both candidate addresses before MIGRATION_ACTION=execute");
    }

    function _execute(uint256 signerKey, address signer, address proxy) internal {
        ContentProtection legacy = ContentProtection(payable(proxy));
        address implementation = vm.envAddress("NEW_IMPLEMENTATION");
        TimelockController timelock = TimelockController(payable(vm.envAddress("CONTENT_PROTECTION_TIMELOCK_ADDRESS")));
        ContentProtectionConfig memory config = _contentProtectionConfig(signer);
        require(legacy.owner() == signer, "signer is not current owner");
        require(config.owner == signer, "CONTENT_PROTECTION_OWNER must be current owner");
        require(implementation.code.length != 0, "candidate implementation has no code");
        require(address(timelock).code.length != 0, "candidate timelock has no code");
        require(
            ContentProtection(payable(implementation)).proxiableUUID() == ERC1967_IMPLEMENTATION_SLOT,
            "candidate is not ERC1967-compatible"
        );
        require(timelock.getMinDelay() == config.timelockMinDelay, "candidate timelock delay mismatch");
        require(
            timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)), "candidate timelock is not self-admin"
        );
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), signer), "signer remains timelock admin");
        _requireRecoveryRoles(timelock, signer);
        _requireRecoveryRoles(timelock, config.guardian);

        vm.startBroadcast(signerKey);
        legacy.upgradeToAndCall(implementation, abi.encodeCall(ContentProtection.reinitializeV6, (address(timelock))));
        vm.stopBroadcast();

        require(legacy.upgradeAuthority() == address(timelock), "migration authority mismatch");
        console.log("=== ContentProtection V6 migration EXECUTED ===");
        console.log("Proxy (unchanged):", proxy);
        console.log("Implementation:", implementation);
        console.log("Upgrade authority:", address(timelock));
    }

    function _requireRecoveryRoles(TimelockController timelock, address account) internal view {
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), account), "recovery account is not proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), account), "recovery account is not executor");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), account), "recovery account is not canceller");
    }
}
