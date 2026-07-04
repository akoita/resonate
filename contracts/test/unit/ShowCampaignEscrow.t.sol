// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {MockFeeOnTransferToken} from "../mocks/MockFeeOnTransferToken.sol";

contract ShowCampaignEscrowTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");
    address public feeRecipient = makeAddr("feeRecipient");

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant GOAL = 1_000e6;
    uint256 public constant MIN_BACKERS = 2;
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner, 0, feeRecipient);

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

    function test_FeeChargedOnReleaseFunds() public {
        _useFeeEscrow(600);
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 artistBefore = usdc.balanceOf(artist);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        vm.expectEmit(true, true, false, true);
        emit FeeCharged(campaignId, feeRecipient, 66e6);
        vm.expectEmit(true, true, false, true);
        emit FundsReleased(campaignId, artist, 1_034e6);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(artist) - artistBefore, 1_034e6);
        assertEq(usdc.balanceOf(feeRecipient) - feeBefore, 66e6);

        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        (uint256 feeBps, uint256 totalFeePaid) = escrow.campaignFees(campaignId);
        assertEq(totalReleased, 1_100e6);
        assertEq(feeBps, 600);
        assertEq(totalFeePaid, 66e6);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Released));
    }

    function test_FeeChargedOnDepositAndFinalReleaseWithoutDoubleFee() public {
        _useFeeEscrow(600);
        uint256 campaignId = _fundCampaign(2_000);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        uint256 artistBefore = usdc.balanceOf(artist);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        vm.prank(confirmer);
        vm.expectEmit(true, true, false, true);
        emit FeeCharged(campaignId, feeRecipient, 13_200_000);
        vm.expectEmit(true, true, false, true);
        emit DepositReleased(campaignId, artist, 206_800_000);
        escrow.releaseDeposit(campaignId);

        assertEq(usdc.balanceOf(artist) - artistBefore, 206_800_000);
        assertEq(usdc.balanceOf(feeRecipient) - feeBefore, 13_200_000);
        (,, uint256 afterDepositReleased) = escrow.campaignAccounting(campaignId);
        (, uint256 afterDepositFees) = escrow.campaignFees(campaignId);
        assertEq(afterDepositReleased, 220e6);
        assertEq(afterDepositFees, 13_200_000);

        vm.prank(confirmer);
        escrow.confirmFulfillment(campaignId);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.expectEmit(true, true, false, true);
        emit FeeCharged(campaignId, feeRecipient, 52_800_000);
        vm.expectEmit(true, true, false, true);
        emit FundsReleased(campaignId, artist, 827_200_000);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(artist) - artistBefore, 1_034e6);
        assertEq(usdc.balanceOf(feeRecipient) - feeBefore, 66e6);
        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);
        assertEq(totalReleased, 1_100e6);
        assertEq(totalFeePaid, 66e6);
    }

    function test_RefundsAreFeeFreeWithFeeConfigured() public {
        _useFeeEscrow(600);
        uint256 campaignId = _createAndActivate(0);

        vm.prank(alice);
        escrow.pledge(campaignId, 100e6);

        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(campaignId);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        vm.prank(alice);
        escrow.claimRefund(campaignId);

        assertEq(usdc.balanceOf(alice) - aliceBefore, 100e6);
        assertEq(usdc.balanceOf(feeRecipient), feeBefore);
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);
        assertEq(totalFeePaid, 0);
    }

    function test_CancelAfterDepositReleaseRefundsGrossOutstandingWithFeeKeptOnReleasedPart() public {
        _useFeeEscrow(600);
        uint256 campaignId = _fundCampaign(2_000);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);
        vm.prank(confirmer);
        escrow.releaseDeposit(campaignId);

        assertEq(usdc.balanceOf(artist), 206_800_000);
        assertEq(usdc.balanceOf(feeRecipient), 13_200_000);

        vm.prank(owner);
        escrow.cancelCampaign(campaignId);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claimRefund(campaignId);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 480e6);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        escrow.claimRefund(campaignId);
        assertEq(usdc.balanceOf(bob) - bobBefore, 400e6);

        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);
        assertEq(totalReleased, 220e6);
        assertEq(totalFeePaid, 13_200_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_FeeConfigSnapshotAppliesOnlyToFutureCampaigns() public {
        _useFeeEscrow(600);
        uint256 firstCampaignId = _createAndActivate(0);

        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit FeeConfigUpdated(250, carol);
        escrow.setFeeConfig(250, carol);

        uint256 secondCampaignId = _createAndActivate(0);

        (uint256 firstFeeBps,) = escrow.campaignFees(firstCampaignId);
        (uint256 secondFeeBps,) = escrow.campaignFees(secondCampaignId);
        assertEq(firstFeeBps, 600);
        assertEq(secondFeeBps, 250);
        assertEq(escrow.campaignFeeBps(), 250);
        assertEq(escrow.feeRecipient(), carol);
    }

    function test_FeeConfigValidation() public {
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidFeeBps.selector, 1001, uint256(1000)));
        new ShowCampaignEscrow(owner, 1001, feeRecipient);

        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        new ShowCampaignEscrow(owner, 600, address(0));

        // The recipient is required even at 0 bps: releases read it at charge time and
        // in-flight campaigns may carry a non-zero snapshotted rate.
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        new ShowCampaignEscrow(owner, 0, address(0));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidFeeBps.selector, 1001, uint256(1000)));
        escrow.setFeeConfig(1001, feeRecipient);

        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.setFeeConfig(600, address(0));

        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.setFeeConfig(0, address(0));

        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.setFeeConfig(600, address(escrow));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        escrow.setFeeConfig(600, feeRecipient);
    }

    function test_FeeRecipientRotationAppliesToInFlightCampaigns() public {
        _useFeeEscrow(600);
        uint256 campaignId = _fundCampaign(0);

        // Rotate the platform fee wallet AFTER the campaign was created and funded:
        // the snapshotted RATE must still apply, but the fee must flow to the wallet
        // configured at charge time.
        vm.prank(owner);
        escrow.setFeeConfig(600, carol);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 carolBefore = usdc.balanceOf(carol);
        uint256 oldRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.expectEmit(true, true, false, true);
        emit FeeCharged(campaignId, carol, 66e6);
        escrow.releaseFunds(campaignId);

        assertEq(usdc.balanceOf(carol) - carolBefore, 66e6);
        assertEq(usdc.balanceOf(feeRecipient), oldRecipientBefore);
        (uint256 feeBps, uint256 totalFeePaid) = escrow.campaignFees(campaignId);
        assertEq(feeBps, 600);
        assertEq(totalFeePaid, 66e6);
    }

    function test_ZeroFeeModeDoesNotEmitFeeChargedAndBeneficiaryReceivesGross() public {
        uint256 campaignId = _fundCampaign(0);

        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 before = usdc.balanceOf(artist);
        vm.recordLogs();
        escrow.releaseFunds(campaignId);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(usdc.balanceOf(artist) - before, 1_100e6);
        assertEq(usdc.balanceOf(feeRecipient), 0);
        bytes32 feeChargedTopic = keccak256("FeeCharged(uint256,address,uint256)");
        for (uint256 i = 0; i < entries.length; i++) {
            assertTrue(entries[i].topics[0] != feeChargedTopic);
        }
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
        assertEq(
            usdc.balanceOf(artist) + (usdc.balanceOf(alice) - aliceBefore) + (usdc.balanceOf(bob) - bobBefore), 1_100e6
        );
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

    /// @notice #1285 — pledging a fee-on-transfer token reverts instead of crediting
    /// the full pledge while the escrow receives less.
    function test_Pledge_RevertFeeOnTransferToken() public {
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken(100); // 1% fee
        vm.startPrank(owner);
        uint256 campaignId = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(feeToken),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
        escrow.activateCampaign(campaignId);
        vm.stopPrank();

        feeToken.mint(alice, 1_000e6);
        vm.startPrank(alice);
        feeToken.approve(address(escrow), 1_000e6);
        uint256 amount = 600e6;
        uint256 received = amount - (amount * 100) / 10_000;
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.FeeOnTransferNotSupported.selector, amount, received)
        );
        escrow.pledge(campaignId, amount);
        vm.stopPrank();
    }

    // ── #1277: creation-param validation + bookingDeadline boundary ─────────

    function test_RevertsCreateWithZeroMinimumBackers() public {
        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.InvalidMinimumBackers.selector);
        escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            0, // minimumBackers
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
    }

    function test_RevertsCreateWithDisputeWindowOutOfRange() public {
        uint256 minW = escrow.MIN_DISPUTE_WINDOW();
        uint256 maxW = escrow.MAX_DISPUTE_WINDOW();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidDisputeWindow.selector, 0, minW, maxW));
        escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            0
        );

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidDisputeWindow.selector, maxW + 1, minW, maxW));
        escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            maxW + 1
        );
    }

    /// @notice At exactly bookingDeadline the second belongs to the confirmer: refunds
    /// cannot be opened, and confirmBooking succeeds (no both-callable overlap).
    function test_BookingDeadlineBoundaryBelongsToConfirmer() public {
        uint256 campaignId = _fundCampaign(0);
        uint256 bookingDeadline = block.timestamp + 30 days; // == the campaign's deadline (no warp since creation)
        vm.warp(bookingDeadline);

        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.BookingDeadlineNotPassed.selector, campaignId, bookingDeadline, bookingDeadline
            )
        );
        escrow.openRefundsAfterMissedBooking(campaignId);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.BookingConfirmed));
    }

    function test_ConfirmBookingAfterDeadlineRevertsPassed() public {
        uint256 campaignId = _fundCampaign(0);
        uint256 bookingDeadline = block.timestamp + 30 days;
        vm.warp(bookingDeadline + 1); // strictly after

        vm.prank(confirmer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.BookingDeadlinePassed.selector, campaignId, bookingDeadline, bookingDeadline + 1
            )
        );
        escrow.confirmBooking(campaignId);
    }

    // ── #944: mutation-campaign survivors → killing tests ───────────────────

    function test_RevertsCreateCampaignInvalidParams() public {
        uint256 dl = block.timestamp + 14 days;
        uint256 bdl = block.timestamp + 30 days;

        vm.prank(owner); // zero beneficiary
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.createCampaign(
            ARTIST_ID_HASH, AUTHORITY_HASH, address(0), address(usdc), GOAL, MIN_BACKERS, dl, bdl, 0, DISPUTE_WINDOW
        );

        vm.prank(owner); // zero goal
        vm.expectRevert(IShowCampaignEscrow.ZeroAmount.selector);
        escrow.createCampaign(
            ARTIST_ID_HASH, AUTHORITY_HASH, artist, address(usdc), 0, MIN_BACKERS, dl, bdl, 0, DISPUTE_WINDOW
        );

        vm.prank(owner); // deadline not in the future
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidDeadline.selector, block.timestamp, bdl, block.timestamp)
        );
        escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp,
            bdl,
            0,
            DISPUTE_WINDOW
        );
    }

    function test_UpdateAuthority() public {
        vm.prank(owner);
        uint256 id = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );

        // Happy path: authority + beneficiary are actually updated.
        bytes32 newAuth = keccak256("new-authority");
        vm.prank(owner);
        escrow.updateAuthority(id, newAuth, bob);
        (bytes32 auth, address benef) = escrow.campaignAuthority(id);
        assertEq(auth, newAuth);
        assertEq(benef, bob);

        // Reverts: zero authority, zero beneficiary, and non-Draft status.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidAuthority.selector, ARTIST_ID_HASH, bytes32(0))
        );
        escrow.updateAuthority(id, bytes32(0), bob);

        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.updateAuthority(id, newAuth, address(0));

        vm.prank(owner);
        escrow.activateCampaign(id); // now Active, not Draft
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidStatus.selector, id, CampaignStatus.Active));
        escrow.updateAuthority(id, newAuth, bob);
    }

    function test_ReleasableAndRefundableReturnValues() public {
        // releasable: a Fulfilled campaign reports its outstanding balance once the
        // dispute window closes (previously only the ==0 cases were asserted, so the
        // return-value arithmetic mutations survived).
        uint256 a = _fundCampaign(2_000); // 20% deposit, 1_100e6 pledged
        assertEq(escrow.releasable(a), 0); // Funded, not Fulfilled

        vm.startPrank(confirmer);
        escrow.confirmBooking(a);
        escrow.releaseDeposit(a); // totalReleased = 220e6
        escrow.confirmFulfillment(a); // Fulfilled
        vm.stopPrank();

        assertEq(escrow.releasable(a), 0); // within the dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        assertEq(escrow.releasable(a), 880e6); // outstanding = 1_100 - 220

        // refundable: after an early deposit release, the view reports each backer's
        // pro-rata share of the *outstanding* balance — exactly what claimRefund pays.
        uint256 b = _fundCampaign(2_000); // fresh: alice 600 / bob 500
        assertEq(escrow.refundable(b, alice), 0); // not RefundAvailable yet

        vm.startPrank(confirmer);
        escrow.confirmBooking(b);
        escrow.releaseDeposit(b); // totalReleased = 220e6
        escrow.confirmFulfillment(b);
        vm.stopPrank();

        vm.prank(owner);
        escrow.cancelCampaign(b); // allowed: still within the dispute window

        // outstanding 880e6: alice 600/1_100 → 480e6, bob 500/1_100 → 400e6.
        assertEq(escrow.refundable(b, alice), (600e6 * 880e6) / 1_100e6);
        assertEq(escrow.refundable(b, bob), (500e6 * 880e6) / 1_100e6);
    }

    function test_RevertsCancelFulfilledAfterDisputeWindow() public {
        uint256 id = _fundCampaign(0); // no deposit release; 1_100e6 pledged
        vm.startPrank(confirmer);
        escrow.confirmBooking(id);
        escrow.confirmFulfillment(id); // Fulfilled; fulfilledAt == block.timestamp
        vm.stopPrank();
        uint256 closeAt = block.timestamp + DISPUTE_WINDOW;

        // Once the dispute window closes the payout has matured: cancellation is barred…
        vm.warp(closeAt + 1);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.DisputeWindowClosed.selector, id, closeAt, block.timestamp)
        );
        escrow.cancelCampaign(id);

        // …and the matured funds go to the artist via permissionless releaseFunds.
        uint256 beforeBal = usdc.balanceOf(artist);
        escrow.releaseFunds(id);
        assertEq(usdc.balanceOf(artist), beforeBal + 1_100e6);
        assertEq(uint8(escrow.campaignStatus(id)), uint8(CampaignStatus.Released));
    }

    function test_RevertsOnInvalidCampaignId() public {
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidCampaign.selector, uint256(999)));
        escrow.campaignStatus(999);
    }

    function test_CampaignIdsAreSequential() public {
        vm.startPrank(owner);
        uint256 id1 = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
        uint256 id2 = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            GOAL,
            MIN_BACKERS,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
        vm.stopPrank();
        assertEq(id1, 1);
        assertEq(id2, 2);
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

    function _useFeeEscrow(uint256 feeBps) internal {
        escrow = new ShowCampaignEscrow(owner, feeBps, feeRecipient);
        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        vm.prank(alice);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(escrow), type(uint256).max);
    }
}
