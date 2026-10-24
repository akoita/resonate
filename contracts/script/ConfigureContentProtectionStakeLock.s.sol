// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DisputeResolution} from "../src/core/DisputeResolution.sol";
import {CurationRewards} from "../src/core/CurationRewards.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @notice Lets open disputes hold Content Protection stakes (#1759).
/// @dev Two owner actions, in this order:
///   1. ContentProtection owner: `setStakeLockAuthority(DisputeResolution)`;
///   2. DisputeResolution owner: `configureStakeLocking(ContentProtection, CurationRewards)`.
/// Step 2 must not run before step 1: once locking is on, every dispute filing calls
/// `ContentProtection.setStakeLock`, which reverts for an unauthorised caller. The
/// script performs each pending step the signer owns and skips the ones already done,
/// so two owners can run it one after the other. It refuses a CurationRewards that is
/// not wired to the same DisputeResolution and ContentProtection. Requires a
/// lock-capable DisputeResolution (#1759 or later) and a V7 ContentProtection.
contract ConfigureContentProtectionStakeLock is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        ContentProtection cp = ContentProtection(payable(vm.envAddress("CONTENT_PROTECTION_PROXY")));
        DisputeResolution dr = DisputeResolution(vm.envAddress("DISPUTE_RESOLUTION_ADDRESS"));
        address curationRewards = vm.envAddress("CURATION_REWARDS_ADDRESS");

        require(address(cp).code.length != 0, "ContentProtection has no code");
        require(address(dr).code.length != 0, "DisputeResolution has no code");
        require(curationRewards.code.length != 0, "CurationRewards has no code");
        require(
            address(CurationRewards(curationRewards).disputeResolution()) == address(dr),
            "CurationRewards is not wired to this DisputeResolution"
        );
        require(
            address(CurationRewards(curationRewards).contentProtection()) == address(cp),
            "CurationRewards is not wired to this ContentProtection"
        );

        bool needsAuthority = cp.stakeLockAuthority() != address(dr);
        bool needsLocking = address(dr.contentProtection()) != address(cp) || dr.disputeFiler() != curationRewards;

        if (needsAuthority) {
            require(cp.owner() == signer, "step 1 pending: run with the ContentProtection owner signer");
        }
        if (needsLocking && !needsAuthority) {
            require(dr.owner() == signer, "step 2 pending: run with the DisputeResolution owner signer");
        }

        vm.startBroadcast(signerKey);
        if (needsAuthority) {
            cp.setStakeLockAuthority(address(dr));
        }
        bool lockingDone = !needsLocking;
        if (needsLocking && dr.owner() == signer) {
            dr.configureStakeLocking(address(cp), curationRewards);
            lockingDone = true;
        }
        vm.stopBroadcast();

        console.log("ContentProtection:", address(cp));
        console.log("DisputeResolution:", address(dr));
        console.log("CurationRewards (dispute filer):", curationRewards);
        console.log("Signer:", signer);
        console.log("Step 1 stake lock authority set:", cp.stakeLockAuthority() == address(dr));
        console.log("Step 2 dispute stake locking on:", lockingDone);
        if (!lockingDone) {
            console.log("PENDING: rerun with the DisputeResolution owner signer to finish step 2");
        }
    }
}
