// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title ShowCampaignEscrow Formal Verification Tests
 * @notice Halmos symbolic checks for the core escrow safety properties (issue #944).
 * @dev Run with: halmos --contract ShowCampaignEscrowFormalTest
 *
 * The formal layer holds only the positive conservation properties Halmos
 * verifies cleanly. The deposit-bps-cap revert check uses `vm.expectRevert`
 * (unsupported by Halmos); it is covered by the fuzz/unit suites and the
 * Certora spec's `depositReleaseBpsCapped` rule.
 */
contract ShowCampaignEscrowFormalTest is Test, SymTest, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner = address(0x1000);
    address public artist = address(0x2000);
    address public confirmer = address(0x3000);
    address public alice = address(0x4000);
    address public bob = address(0x5000);
    address public feeRecipient = address(0x6000);

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner, 0, feeRecipient);

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        _mintAndApprove(alice, 1_000_000e6);
        _mintAndApprove(bob, 1_000_000e6);
    }

    function check_fundingDoesNotReleaseBeforeBooking(uint256 aliceAmount, uint256 bobAmount) public {
        vm.assume(aliceAmount > 0 && aliceAmount <= 500_000e6);
        vm.assume(bobAmount > 0 && bobAmount <= 500_000e6);

        uint256 campaignId = _createAndActivate(aliceAmount + bobAmount, 2, 0);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assert(escrow.campaignStatus(campaignId) == CampaignStatus.Funded);
        assert(totalPledged == aliceAmount + bobAmount);
        assert(totalRefunded == 0);
        assert(totalReleased == 0);
        assert(usdc.balanceOf(artist) == 0);
    }

    function check_finalReleaseConservesPledged(uint256 aliceAmount, uint256 bobAmount, uint256 depositReleaseBps)
        public
    {
        vm.assume(aliceAmount > 0 && aliceAmount <= 500_000e6);
        vm.assume(bobAmount > 0 && bobAmount <= 500_000e6);
        vm.assume(depositReleaseBps <= escrow.MAX_DEPOSIT_RELEASE_BPS());

        uint256 totalPledged = aliceAmount + bobAmount;
        uint256 campaignId = _createAndActivate(totalPledged, 2, depositReleaseBps);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        if (depositReleaseBps > 0) {
            vm.prank(confirmer);
            escrow.releaseDeposit(campaignId);
        }

        vm.prank(confirmer);
        escrow.confirmFulfillment(campaignId);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(campaignId);

        (, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assert(totalRefunded == 0);
        assert(totalReleased == totalPledged);
        assert(usdc.balanceOf(artist) == totalPledged);
        assert(escrow.campaignStatus(campaignId) == CampaignStatus.Released);
    }

    function check_releaseFeeSplitConservesGross(uint256 aliceAmount, uint256 bobAmount, uint256 feeBps) public {
        vm.assume(aliceAmount > 0 && aliceAmount <= 500_000e6);
        vm.assume(bobAmount > 0 && bobAmount <= 500_000e6);
        vm.assume(feeBps <= escrow.MAX_CAMPAIGN_FEE_BPS());

        vm.prank(owner);
        escrow.setFeeConfig(feeBps, feeRecipient);

        uint256 totalPledged = aliceAmount + bobAmount;
        uint256 campaignId = _createAndActivate(totalPledged, 2, 0);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);
        vm.prank(confirmer);
        escrow.confirmFulfillment(campaignId);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 artistBefore = usdc.balanceOf(artist);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        escrow.releaseFunds(campaignId);

        uint256 gross = totalPledged;
        uint256 expectedFee = gross * feeBps / escrow.BPS_DENOMINATOR();
        uint256 expectedNet = gross - expectedFee;
        uint256 artistDelta = usdc.balanceOf(artist) - artistBefore;
        uint256 feeDelta = usdc.balanceOf(feeRecipient) - feeBefore;
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);

        assert(artistDelta == expectedNet);
        assert(feeDelta == expectedFee);
        assert(artistDelta + feeDelta == gross);
        assert(totalFeePaid == expectedFee);
    }

    function check_refundAmountIndependentOfFeeBps(uint256 feeBps) public {
        vm.assume(feeBps <= escrow.MAX_CAMPAIGN_FEE_BPS());

        // Only feeBps is symbolic: the property is that refunds never reference the
        // fee for ANY fee value. Symbolic pledge amounts force the solver through
        // claimRefund's pro-rata division by a symbolic totalPledged (nonlinear —
        // timed out twice in CI); amount-generality is covered by the fuzz suite.
        uint256 aliceAmount = 700e6;
        uint256 bobAmount = 500e6;

        vm.prank(owner);
        escrow.setFeeConfig(feeBps, feeRecipient);

        uint256 campaignId = _createAndActivate(aliceAmount + bobAmount + 1, 2, 0);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(campaignId);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        vm.prank(alice);
        escrow.claimRefund(campaignId);
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);

        assert(usdc.balanceOf(alice) - aliceBefore == aliceAmount);
        assert(usdc.balanceOf(feeRecipient) == feeBefore);
        assert(totalFeePaid == 0);
    }

    function _createAndActivate(uint256 goal, uint256 minimumBackers, uint256 depositReleaseBps)
        internal
        returns (uint256 campaignId)
    {
        vm.startPrank(owner);
        campaignId = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            goal,
            minimumBackers,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            depositReleaseBps,
            DISPUTE_WINDOW
        );
        escrow.activateCampaign(campaignId);
        vm.stopPrank();
    }

    function _mintAndApprove(address backer, uint256 amount) internal {
        usdc.mint(backer, amount);
        vm.prank(backer);
        usdc.approve(address(escrow), amount);
    }
}
