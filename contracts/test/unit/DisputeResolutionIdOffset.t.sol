// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {IDisputeResolution} from "../../src/interfaces/IDisputeResolution.sol";
import {IDisputeResolutionEvents} from "../../src/interfaces/IDisputeResolutionEvents.sol";

/**
 * @title DisputeResolution dispute id continuity (#1759)
 * @notice A replacement DisputeResolution continues the id sequence of the contract
 *         it replaces, so ids stay unique per chain for the indexer and the backend.
 */
contract DisputeResolutionIdOffsetTest is Test, IDisputeResolutionEvents {
    address internal admin = makeAddr("admin");
    address internal reporter = makeAddr("reporter");
    address internal creator = makeAddr("creator");

    uint256 internal constant OFFSET = 41;

    function test_ZeroOffset_StartsAtOne() public {
        DisputeResolution dr = new DisputeResolution(admin, 0);
        assertEq(dr.disputeIdOffset(), 0);
        assertEq(dr.disputeCount(), 0);
        assertEq(dr.fileDispute(1, reporter, creator, "ipfs://e"), 1);
    }

    function test_Offset_CounterStartsAtTheOffset() public {
        DisputeResolution dr = new DisputeResolution(admin, OFFSET);
        assertEq(dr.disputeIdOffset(), OFFSET);
        assertEq(dr.disputeCount(), OFFSET, "counter view reports the last issued id on the chain");
    }

    function test_Offset_FirstDisputeIsOffsetPlusOne() public {
        DisputeResolution dr = new DisputeResolution(admin, OFFSET);

        vm.expectEmit(true, true, true, true);
        emit DisputeFiled(OFFSET + 1, 7, reporter, creator, "ipfs://e", 0);
        uint256 first = dr.fileDispute(7, reporter, creator, "ipfs://e");
        uint256 second = dr.fileDispute(8, reporter, creator, "ipfs://e2");

        assertEq(first, OFFSET + 1);
        assertEq(second, OFFSET + 2);
        assertEq(dr.disputeCount(), OFFSET + 2);
        assertEq(dr.getActiveDispute(7), OFFSET + 1);
        assertEq(dr.getDispute(first).tokenId, 7);
        assertEq(dr.getDispute(second).tokenId, 8);
        assertEq(dr.disputeIdOffset(), OFFSET, "the offset is fixed at deployment");
    }

    function test_Offset_IdsAtOrBelowTheOffsetDoNotExistHere() public {
        DisputeResolution dr = new DisputeResolution(admin, OFFSET);
        dr.fileDispute(7, reporter, creator, "ipfs://e");

        assertEq(dr.getDispute(OFFSET).filedAt, 0);
        assertEq(dr.getDispute(1).filedAt, 0);

        vm.prank(reporter);
        vm.expectRevert(DisputeNotFound.selector);
        dr.submitEvidence(OFFSET, "ipfs://x");

        vm.prank(admin);
        vm.expectRevert(DisputeNotFound.selector);
        dr.resolve(OFFSET, Outcome.Upheld);

        vm.prank(admin);
        vm.expectRevert(DisputeNotFound.selector);
        dr.markUnderReview(1);
    }

    function test_Offset_LifecycleWorksOnContinuedIds() public {
        DisputeResolution dr = new DisputeResolution(admin, OFFSET);
        uint256 id = dr.fileDispute(7, reporter, creator, "ipfs://e");

        vm.prank(admin);
        dr.resolve(id, Outcome.Rejected);
        assertEq(uint8(dr.getDispute(id).status), uint8(DisputeStatus.Resolved));
        assertEq(dr.getActiveDispute(7), 0);

        dr.appeal(id, reporter);
        assertEq(dr.getActiveDispute(7), id);
        assertEq(dr.disputeCount(), OFFSET + 1, "an appeal does not issue a new id");
    }

    function test_MaxOffset_FilingRevertsInsteadOfWrapping() public {
        DisputeResolution dr = new DisputeResolution(admin, type(uint256).max);
        vm.expectRevert(stdError.arithmeticError);
        dr.fileDispute(7, reporter, creator, "ipfs://e");
    }

    function testFuzz_Offset_IdsContinueFromTheOffset(uint256 offset, uint8 filings) public {
        offset = bound(offset, 0, type(uint256).max - 256);
        uint256 n = bound(filings, 1, 16);
        DisputeResolution dr = new DisputeResolution(admin, offset);

        for (uint256 i = 0; i < n; i++) {
            uint256 id = dr.fileDispute(1000 + i, reporter, creator, "ipfs://e");
            assertEq(id, offset + i + 1);
            IDisputeResolution.Dispute memory d = dr.getDispute(id);
            assertEq(d.tokenId, 1000 + i);
        }
        assertEq(dr.disputeCount(), offset + n);
        assertEq(dr.getDispute(offset).filedAt, 0, "no dispute below the first new id");
    }
}
