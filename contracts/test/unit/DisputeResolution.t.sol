// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {IDisputeResolution} from "../../src/interfaces/IDisputeResolution.sol";

/**
 * @title DisputeResolution Unit Tests
 * @notice Tests dispute lifecycle: file → evidence → review → resolve
 */
contract DisputeResolutionTest is Test {
    DisputeResolution public dr;

    address public admin = makeAddr("admin");
    address public reporter = makeAddr("reporter");
    address public creator = makeAddr("creator");

    event DisputeFiled(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        address indexed reporter,
        address creator,
        string evidenceURI,
        uint256 counterStake
    );

    event EvidenceSubmitted(
        uint256 indexed disputeId,
        address indexed submitter,
        string evidenceURI,
        uint256 evidenceIndex
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        IDisputeResolution.Outcome outcome,
        address resolver
    );

    function setUp() public {
        dr = new DisputeResolution(admin);
    }

    // ============ Filing ============

    function test_FileDispute() public {
        vm.expectEmit(true, true, true, true);
        emit DisputeFiled(1, 42, reporter, creator, "ipfs://evidence1", 0);

        uint256 id = dr.fileDispute(42, reporter, creator, "ipfs://evidence1");
        assertEq(id, 1);
        assertEq(dr.disputeCount(), 1);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(d.tokenId, 42);
        assertEq(d.reporter, reporter);
        assertEq(d.creator, creator);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.Filed)
        );
        assertEq(
            uint256(d.outcome),
            uint256(IDisputeResolution.Outcome.Pending)
        );
    }

    function test_FileDispute_RevertActiveExists() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.expectRevert(DisputeResolution.ActiveDisputeExists.selector);
        dr.fileDispute(42, reporter, creator, "ipfs://e2");
    }

    function test_FileMultipleTokens() public {
        dr.fileDispute(1, reporter, creator, "ipfs://e1");
        dr.fileDispute(2, reporter, creator, "ipfs://e2");
        assertEq(dr.disputeCount(), 2);
        assertEq(dr.getActiveDispute(1), 1);
        assertEq(dr.getActiveDispute(2), 2);
    }

    // ============ Evidence ============

    function test_SubmitEvidence() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(reporter);
        vm.expectEmit(true, true, false, true);
        emit EvidenceSubmitted(1, reporter, "ipfs://proof", 0);
        dr.submitEvidence(1, "ipfs://proof");

        DisputeResolution.Evidence memory e = dr.getEvidence(1, 0);
        assertEq(e.submitter, reporter);
        assertEq(e.evidenceURI, "ipfs://proof");
    }

    function test_SubmitEvidence_TransitionsToEvidenceStatus() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(creator);
        dr.submitEvidence(1, "ipfs://counter-proof");

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.Evidence)
        );
    }

    function test_SubmitEvidence_RevertNotParty() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        address outsider = makeAddr("outsider");
        vm.prank(outsider);
        vm.expectRevert(DisputeResolution.NotDisputeParty.selector);
        dr.submitEvidence(1, "ipfs://spam");
    }

    function test_SubmitEvidence_RevertMaxReached() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(reporter);
            dr.submitEvidence(1, "ipfs://proof");
        }

        vm.prank(reporter);
        vm.expectRevert(DisputeResolution.MaxEvidenceReached.selector);
        dr.submitEvidence(1, "ipfs://one-too-many");
    }

    function test_SubmitEvidence_BothPartiesCanSubmit() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(reporter);
        dr.submitEvidence(1, "ipfs://reporter-proof");

        vm.prank(creator);
        dr.submitEvidence(1, "ipfs://creator-defense");

        assertEq(dr.totalEvidenceCounts(1), 2);
    }

    function test_SubmitEvidence_RevertAfterResolved() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        vm.prank(reporter);
        vm.expectRevert(DisputeResolution.DisputeAlreadyResolved.selector);
        dr.submitEvidence(1, "ipfs://too-late");
    }

    // ============ Resolution ============

    function test_Resolve_Upheld() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit DisputeResolved(1, 42, IDisputeResolution.Outcome.Upheld, admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.Resolved)
        );
        assertEq(
            uint256(d.outcome),
            uint256(IDisputeResolution.Outcome.Upheld)
        );
        assertTrue(d.resolvedAt > 0);

        // Active dispute cleared
        assertEq(dr.getActiveDispute(42), 0);
    }

    function test_Resolve_Rejected() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.outcome),
            uint256(IDisputeResolution.Outcome.Rejected)
        );
    }

    function test_Resolve_Inconclusive() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Inconclusive);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.outcome),
            uint256(IDisputeResolution.Outcome.Inconclusive)
        );
    }

    function test_Resolve_RevertNotOwner() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(reporter);
        vm.expectRevert();
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
    }

    function test_Resolve_RevertPendingOutcome() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        vm.expectRevert(DisputeResolution.InvalidOutcome.selector);
        dr.resolve(1, IDisputeResolution.Outcome.Pending);
    }

    function test_Resolve_RevertAlreadyResolved() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        vm.prank(admin);
        vm.expectRevert(DisputeResolution.DisputeAlreadyResolved.selector);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);
    }

    // ============ Mark Under Review ============

    function test_MarkUnderReview() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.markUnderReview(1);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.UnderReview)
        );
    }

    function test_MarkUnderReview_RevertNotOwner() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(reporter);
        vm.expectRevert();
        dr.markUnderReview(1);
    }

    // ============ Can Re-file After Resolution ============

    function test_RefileAfterResolution() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        // Can file again
        uint256 id2 = dr.fileDispute(42, reporter, creator, "ipfs://e2");
        assertEq(id2, 2);
        assertEq(dr.getActiveDispute(42), 2);
    }

    // ============ Appeals ============

    function test_Appeal_CreatorAppealsUpheld() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        // Creator is the loser when dispute is upheld
        dr.appeal(1, creator);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.Appealed)
        );
        assertEq(
            uint256(d.outcome),
            uint256(IDisputeResolution.Outcome.Pending)
        );
        assertEq(d.appealCount, 1);
        assertEq(d.resolvedAt, 0);
        // Active dispute should be restored
        assertEq(dr.getActiveDispute(42), 1);
    }

    function test_Appeal_ReporterAppealsRejected() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        // Reporter is the loser when dispute is rejected
        dr.appeal(1, reporter);

        IDisputeResolution.Dispute memory d = dr.getDispute(1);
        assertEq(d.appealCount, 1);
        assertEq(
            uint256(d.status),
            uint256(IDisputeResolution.DisputeStatus.Appealed)
        );
    }

    function test_Appeal_MaxTwoAppeals() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        // First resolve + appeal
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
        dr.appeal(1, creator);

        // Re-resolve + second appeal
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
        dr.appeal(1, creator);

        // Third appeal should revert
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
        vm.expectRevert(DisputeResolution.MaxAppealsReached.selector);
        dr.appeal(1, creator);
    }

    function test_Appeal_RevertNotLosingParty() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        // Reporter (winner) tries to appeal
        vm.expectRevert(DisputeResolution.NotLosingParty.selector);
        dr.appeal(1, reporter);
    }

    function test_Appeal_RevertInconclusive() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Inconclusive);

        // Inconclusive disputes cannot be appealed
        vm.expectRevert(DisputeResolution.InvalidOutcome.selector);
        dr.appeal(1, creator);
    }

    function test_Appeal_RevertNotResolved() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        // Can't appeal a dispute that hasn't been resolved
        vm.expectRevert(DisputeResolution.DisputeNotResolved.selector);
        dr.appeal(1, creator);
    }

    function test_Appeal_CanSubmitEvidenceAfter() public {
        dr.fileDispute(42, reporter, creator, "ipfs://e1");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        // Appeal
        dr.appeal(1, creator);

        // Both parties can submit new evidence after appeal
        vm.prank(creator);
        dr.submitEvidence(1, "ipfs://new-defense");

        vm.prank(reporter);
        dr.submitEvidence(1, "ipfs://more-proof");
    }
}
