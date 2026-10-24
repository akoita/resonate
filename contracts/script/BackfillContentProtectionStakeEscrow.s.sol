// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/// @notice Records the self-claim deadline of stakes deposited before the V7
/// ContentProtection upgrade (#1759).
/// @dev `STAKE_ESCROW_TOKEN_IDS` is a comma-separated list of staked token ids.
/// `backfillStakeEscrow` skips inactive and already-recorded stakes, so including
/// extra ids, or rerunning the script, is safe. The script sends the ids in batches
/// (`STAKE_ESCROW_BATCH_SIZE`, default 100) and fails, before anything is broadcast,
/// if any listed active stake would still be unrecorded afterwards.
contract BackfillContentProtectionStakeEscrow is DeploymentKey {
    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        ContentProtection cp = ContentProtection(payable(vm.envAddress("CONTENT_PROTECTION_PROXY")));
        uint256[] memory tokenIds = vm.envUint("STAKE_ESCROW_TOKEN_IDS", ",");
        uint256 batchSize = vm.envOr("STAKE_ESCROW_BATCH_SIZE", uint256(100));
        require(batchSize != 0, "STAKE_ESCROW_BATCH_SIZE must be non-zero");
        require(tokenIds.length != 0, "STAKE_ESCROW_TOKEN_IDS is empty");
        require(cp.owner() == signer, "signer is not ContentProtection owner");

        uint256 pending;
        for (uint256 i; i < tokenIds.length; ++i) {
            (,, bool active) = cp.stakes(tokenIds[i]);
            if (active && cp.stakeClaimableAt(tokenIds[i]) == 0) ++pending;
        }

        uint256 recorded;
        vm.startBroadcast(signerKey);
        for (uint256 start; start < tokenIds.length; start += batchSize) {
            uint256 end = start + batchSize < tokenIds.length ? start + batchSize : tokenIds.length;
            uint256[] memory batch = new uint256[](end - start);
            for (uint256 j = start; j < end; ++j) {
                batch[j - start] = tokenIds[j];
            }
            recorded += cp.backfillStakeEscrow(batch);
        }
        vm.stopBroadcast();

        for (uint256 i; i < tokenIds.length; ++i) {
            (,, bool active) = cp.stakes(tokenIds[i]);
            require(!active || cp.stakeClaimableAt(tokenIds[i]) != 0, "an active stake is still unrecorded");
        }

        console.log("ContentProtection:", address(cp));
        console.log("Owner signer:", signer);
        console.log("Token ids supplied:", tokenIds.length);
        console.log("Active stakes needing a deadline:", pending);
        console.log("Deadlines recorded:", recorded);
    }
}
