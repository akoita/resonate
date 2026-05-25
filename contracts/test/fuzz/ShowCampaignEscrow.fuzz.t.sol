// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

/**
 * @title ShowCampaignEscrow Fuzz Tests
 * @notice Property tests for campaign terms, funding, refunds, and staged release math.
 */
contract ShowCampaignEscrowFuzzTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner);

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        _mintAndApprove(alice, 1_000_000e6);
        _mintAndApprove(bob, 1_000_000e6);
    }

    function testFuzz_CreateCampaignAcceptsBoundedDeposit(uint256 depositReleaseBps) public {
        depositReleaseBps = bound(depositReleaseBps, 0, escrow.MAX_DEPOSIT_RELEASE_BPS());

        vm.prank(owner);
        uint256 campaignId = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            1_000e6,
            2,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            depositReleaseBps,
            DISPUTE_WINDOW
        );

        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Draft));
    }

    function testFuzz_CreateCampaignRejectsTooLargeDeposit(uint256 depositReleaseBps) public {
        uint256 maxDepositReleaseBps = escrow.MAX_DEPOSIT_RELEASE_BPS();
        depositReleaseBps = bound(depositReleaseBps, maxDepositReleaseBps + 1, type(uint16).max);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.DepositReleaseTooHigh.selector, depositReleaseBps, maxDepositReleaseBps
            )
        );
        escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            1_000e6,
            2,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            depositReleaseBps,
            DISPUTE_WINDOW
        );
    }

    function testFuzz_PledgeMarksFundedWithoutRelease(uint256 aliceAmount, uint256 bobAmount) public {
        aliceAmount = bound(aliceAmount, 1e6, 500_000e6);
        bobAmount = bound(bobAmount, 1e6, 500_000e6);
        uint256 goal = aliceAmount + bobAmount;
        uint256 campaignId = _createAndActivate(goal, 2, 0);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assertEq(totalPledged, goal);
        assertEq(totalRefunded, 0);
        assertEq(totalReleased, 0);
        assertEq(usdc.balanceOf(artist), 0);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Funded));
    }

    function testFuzz_DepositReleaseMatchesDisclosedBps(uint256 depositReleaseBps, uint256 totalPledged) public {
        depositReleaseBps = bound(depositReleaseBps, 1, escrow.MAX_DEPOSIT_RELEASE_BPS());
        totalPledged = bound(totalPledged, 2e6, 500_000e6);

        uint256 aliceAmount = totalPledged / 2;
        uint256 bobAmount = totalPledged - aliceAmount;
        uint256 campaignId = _createAndActivate(totalPledged, 2, depositReleaseBps);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        vm.prank(confirmer);
        escrow.confirmBooking(campaignId);

        uint256 expectedDeposit = totalPledged * depositReleaseBps / escrow.BPS_DENOMINATOR();
        uint256 before = usdc.balanceOf(artist);

        vm.prank(confirmer);
        escrow.releaseDeposit(campaignId);

        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        assertEq(usdc.balanceOf(artist) - before, expectedDeposit);
        assertEq(totalReleased, expectedDeposit);
    }

    function testFuzz_MissedBookingRefundEqualsPledge(uint256 aliceAmount, uint256 bobAmount) public {
        aliceAmount = bound(aliceAmount, 1e6, 500_000e6);
        bobAmount = bound(bobAmount, 1e6, 500_000e6);
        uint256 campaignId = _createAndActivate(aliceAmount + bobAmount, 2, 0);

        vm.prank(alice);
        escrow.pledge(campaignId, aliceAmount);
        vm.prank(bob);
        escrow.pledge(campaignId, bobAmount);

        vm.warp(block.timestamp + 31 days);
        escrow.openRefundsAfterMissedBooking(campaignId);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claimRefund(campaignId);

        assertEq(usdc.balanceOf(alice) - before, aliceAmount);
        assertEq(escrow.refundable(campaignId, alice), 0);
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
