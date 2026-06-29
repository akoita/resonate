// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

contract ShowCampaignEscrowTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant GOAL = 1_000e6;
    uint256 public constant MIN_BACKERS = 2;
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner);

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        _mintAndApprove(alice, 2_000e6);
        _mintAndApprove(bob, 2_000e6);
        _mintAndApprove(carol, 2_000e6);
    }

    function test_CreateAndActivateCampaign() public {
        uint256 deadline = block.timestamp + 14 days;
        uint256 bookingDeadline = block.timestamp + 30 days;

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit CampaignCreated(
            1, ARTIST_ID_HASH, AUTHORITY_HASH, artist, address(usdc), GOAL, MIN_BACKERS, deadline, bookingDeadline
        );
        uint256 campaignId = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            deadline,
            bookingDeadline,
            0,
            DISPUTE_WINDOW
        );

        assertEq(campaignId, 1);
        (bytes32 authorityHash, address beneficiary) = escrow.campaignAuthority(campaignId);
        assertEq(authorityHash, AUTHORITY_HASH);
        assertEq(beneficiary, artist);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Draft));

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit CampaignActivated(campaignId);
        escrow.activateCampaign(campaignId);

        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Active));
    }

    function test_PledgeMarksFundedButDoesNotRelease() public {
        uint256 campaignId = _createAndActivate(0);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Pledged(campaignId, alice, 600e6, 600e6);
        escrow.pledge(campaignId, 600e6);

        vm.prank(bob);
        vm.expectEmit(true, false, false, true);
        emit CampaignFunded(campaignId, 1_100e6, 2);
        escrow.pledge(campaignId, 500e6);

        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assertEq(totalPledged, 1_100e6);
        assertEq(totalRefunded, 0);
        assertEq(totalReleased, 0);
        assertEq(usdc.balanceOf(artist), 0);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Funded));
    }

    function test_RefundsWhenCampaignMissesDeadline() public {
        uint256 campaignId = _createAndActivate(0);

        vm.prank(alice);
        escrow.pledge(campaignId, 100e6);

        vm.warp(block.timestamp + 15 days);

        vm.expectEmit(true, false, false, false);
        emit RefundAvailable(campaignId);
        escrow.markFailed(campaignId);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit RefundClaimed(campaignId, alice, 100e6);
        escrow.claimRefund(campaignId);

        assertEq(usdc.balanceOf(alice) - before, 100e6);
        assertEq(escrow.refundable(campaignId, alice), 0);
    }

    function test_RefundsWhenBookingDeadlineMissed() public {
        uint256 campaignId = _fundCampaign(0);

        vm.warp(block.timestamp + 31 days);
        escrow.openRefundsAfterMissedBooking(campaignId);

        assertEq(escrow.refundable(campaignId, alice), 600e6);
        assertEq(escrow.refundable(campaignId, bob), 500e6);
    }

    function test_ConfirmBookingReleaseFulfillmentAndFinalFunds() public {
        uint256 campaignId = _fundCampaign(0);

        vm.prank(confirmer);
        vm.expectEmit(true, true, false, false);
        emit BookingConfirmed(campaignId, confirmer);
        escrow.confirmBooking(campaignId);

        vm.prank(confirmer);
        vm.expectEmit(true, true, false, false);
        emit FulfillmentConfirmed(campaignId, confirmer);
        escrow.confirmFulfillment(campaignId);

        assertEq(escrow.releasable(campaignId), 0);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 before = usdc.balanceOf(artist);
        vm.expectEmit(true, true, false, true);
        emit FundsReleased(campaignId, artist, 1_100e6);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(artist) - before, 1_100e6);

        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Released));
    }

    function test_DepositReleaseOnlyAfterBookingAndDisclosure() public {
        uint256 campaignId = _fundCampaign(2_000);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        uint256 before = usdc.balanceOf(artist);
        vm.prank(confirmer);
        vm.expectEmit(true, true, false, true);
        emit DepositReleased(campaignId, artist, 220e6);
        escrow.releaseDeposit(campaignId);

        assertEq(usdc.balanceOf(artist) - before, 220e6);

        vm.prank(confirmer);
        escrow.confirmFulfillment(campaignId);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(artist), 1_100e6);
    }

    function test_RevertsActivationWithoutAuthorityBoundCampaign() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidAuthority.selector, ARTIST_ID_HASH, bytes32(0))
        );
        escrow.createCampaign(
            ARTIST_ID_HASH,
            bytes32(0),
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
    }

    function test_RevertsPledgeWhenPaused() public {
        uint256 campaignId = _createAndActivate(0);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.pledge(campaignId, 100e6);
    }

    function test_RevertsReleaseDuringDisputeWindow() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.DisputeWindowActive.selector,
                campaignId,
                block.timestamp + DISPUTE_WINDOW,
                block.timestamp
            )
        );
        escrow.releaseFunds(campaignId);
    }

    // ── Access control & release/refund edge cases (#904) ──────────────────

    function test_RevertsConfirmBookingByNonConfirmer() public {
        uint256 campaignId = _fundCampaign(0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.NotConfirmer.selector, alice));
        escrow.confirmBooking(campaignId);
    }

    function test_RevertsConfirmFulfillmentByNonConfirmer() public {
        uint256 campaignId = _fundCampaign(0);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.NotConfirmer.selector, bob));
        escrow.confirmFulfillment(campaignId);
    }

    function test_RevertsReleaseDepositByNonConfirmer() public {
        uint256 campaignId = _fundCampaign(2_000);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.NotConfirmer.selector, carol));
        escrow.releaseDeposit(campaignId);
    }

    function test_RevertsReleaseFundsBeforeFulfillment() public {
        uint256 campaignId = _fundCampaign(0);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        // Status is BookingConfirmed, not Fulfilled — release must be refused
        // even if a (zero) dispute window would otherwise have elapsed.
        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.InvalidStatus.selector, campaignId, CampaignStatus.BookingConfirmed
            )
        );
        escrow.releaseFunds(campaignId);
    }

    function test_PermissionlessReleaseFundsByAnyCaller() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // releaseFunds is intentionally permissionless: once the time-lock
        // elapses, ANY caller can settle, and funds always go to the
        // beneficiary (never to the caller). carol is not owner nor confirmer.
        uint256 beforeArtist = usdc.balanceOf(artist);
        uint256 beforeCarol = usdc.balanceOf(carol);
        vm.prank(carol);
        vm.expectEmit(true, true, false, true);
        emit FundsReleased(campaignId, artist, 1_100e6);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(artist) - beforeArtist, 1_100e6);
        assertEq(usdc.balanceOf(carol), beforeCarol);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Released));
    }

    function test_RevertsDoubleReleaseFunds() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(campaignId);

        // Second settle is refused: status is now Released, so the status
        // guard fires before any double transfer can occur.
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidStatus.selector, campaignId, CampaignStatus.Released)
        );
        escrow.releaseFunds(campaignId);
    }

    function test_RevertsClaimRefundByNonBacker() public {
        uint256 campaignId = _createAndActivate(0);

        vm.prank(alice);
        escrow.pledge(campaignId, 100e6);

        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(campaignId);

        // carol never pledged — refund must revert rather than pay out.
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.NoPledge.selector, campaignId, carol));
        escrow.claimRefund(campaignId);
    }

    function test_RevertsDoubleRefundClaim() public {
        uint256 campaignId = _createAndActivate(0);

        // Two backers (still under GOAL) so the campaign stays RefundAvailable
        // after alice's claim — this isolates the per-backer zeroing path
        // rather than the campaign-level Refunded status transition.
        vm.prank(alice);
        escrow.pledge(campaignId, 100e6);
        vm.prank(bob);
        escrow.pledge(campaignId, 100e6);

        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(campaignId);

        vm.prank(alice);
        escrow.claimRefund(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.RefundAvailable));

        // alice's pledge is zeroed after the first claim — a replay must revert.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.NoPledge.selector, campaignId, alice));
        escrow.claimRefund(campaignId);
    }

    // ── #1276: refunds recoverable after an early deposit release ───────────

    /// @notice After a deposit is released, a stalled campaign can be cancelled and
    /// backers recover their pro-rata share of the *remaining* balance — the funds
    /// are no longer permanently locked in `DepositReleased`.
    function test_CancelAfterDepositReleaseRefundsRemainingProRata() public {
        uint256 campaignId = _fundCampaign(2_000); // 20% deposit, 1_100e6 pledged

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);
        vm.prank(confirmer);
        escrow.releaseDeposit(campaignId); // 220e6 to artist → DepositReleased

        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.DepositReleased));
        assertEq(usdc.balanceOf(artist), 220e6);

        // The show falls through: owner opens refunds on the stalled campaign.
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit RefundAvailable(campaignId);
        escrow.cancelCampaign(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.RefundAvailable));

        // Backers recover pro-rata of the remaining 880e6 (1_100 - 220 deposit).
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit RefundClaimed(campaignId, alice, 480e6); // 600/1100 * 880
        escrow.claimRefund(campaignId);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 480e6);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        escrow.claimRefund(campaignId); // 500/1100 * 880 = 400e6
        assertEq(usdc.balanceOf(bob) - bobBefore, 400e6);

        // Conservation: artist 220 + alice 480 + bob 400 == 1_100 pledged; escrow drained.
        assertEq(usdc.balanceOf(artist) + (usdc.balanceOf(alice) - aliceBefore) + (usdc.balanceOf(bob) - bobBefore), 1_100e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Refunded));
    }

    /// @notice A Fulfilled campaign can be cancelled within the dispute window; with
    /// no deposit released, backers recover their full pledges.
    function test_CancelFromFulfilledDuringDisputeWindowRefunds() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Fulfilled));

        // Dispute upheld during the window: owner cancels → refunds open.
        vm.prank(owner);
        escrow.cancelCampaign(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.RefundAvailable));

        vm.prank(alice);
        escrow.claimRefund(campaignId); // full 600e6 (no deposit released)
        vm.prank(bob);
        escrow.claimRefund(campaignId); // full 500e6

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(artist), 0);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Refunded));
    }

    /// @notice Refund finalizes to Refunded once every distinct backer has claimed
    /// (claim-counter based, independent of pledge sizes / pro-rata dust).
    function test_RefundFinalizesWhenAllBackersClaim() public {
        uint256 campaignId = _fundCampaign(0); // alice 600, bob 500 → 2 backers

        vm.warp(block.timestamp + 31 days);
        escrow.openRefundsAfterMissedBooking(campaignId);

        vm.prank(alice);
        escrow.claimRefund(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.RefundAvailable));

        vm.prank(bob);
        escrow.claimRefund(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Refunded));
        assertEq(escrow.refundedBackers(campaignId), 2);
    }

    /// @notice Terminal states cannot be re-opened for refunds.
    function test_RevertsCancelFromReleasedState() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(campaignId); // → Released (terminal)

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidStatus.selector, campaignId, CampaignStatus.Released)
        );
        escrow.cancelCampaign(campaignId);
    }

    function _createAndActivate(uint256 depositReleaseBps) internal returns (uint256 campaignId) {
        vm.startPrank(owner);
        campaignId = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            depositReleaseBps,
            DISPUTE_WINDOW
        );
        escrow.activateCampaign(campaignId);
        vm.stopPrank();
    }

    function _fundCampaign(uint256 depositReleaseBps) internal returns (uint256 campaignId) {
        campaignId = _createAndActivate(depositReleaseBps);
        vm.prank(alice);
        escrow.pledge(campaignId, 600e6);
        vm.prank(bob);
        escrow.pledge(campaignId, 500e6);
    }

    function _mintAndApprove(address backer, uint256 amount) internal {
        usdc.mint(backer, amount);
        vm.prank(backer);
        usdc.approve(address(escrow), amount);
    }
}
