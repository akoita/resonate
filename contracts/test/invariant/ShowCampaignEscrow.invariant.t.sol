// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

/**
 * @title ShowCampaignEscrow Invariant Tests
 * @notice Stateful checks for escrow fund conservation across lifecycle calls.
 */
contract ShowCampaignEscrowInvariantTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;
    ShowCampaignEscrowHandler public handler;

    address public owner = makeAddr("owner");
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");

    uint256 public campaignId;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner);

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        vm.startPrank(owner);
        campaignId = escrow.createCampaign(
            keccak256("artist:sennarin"),
            keccak256("authority:sennarin:wallet"),
            artist,
            address(usdc),
            1_000e6,
            2,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            1_000,
            7 days
        );
        escrow.activateCampaign(campaignId);
        vm.stopPrank();

        handler = new ShowCampaignEscrowHandler(escrow, usdc, campaignId, confirmer, owner);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = ShowCampaignEscrowHandler.advanceTime.selector;
        selectors[1] = ShowCampaignEscrowHandler.pledge.selector;
        selectors[2] = ShowCampaignEscrowHandler.markFailed.selector;
        selectors[3] = ShowCampaignEscrowHandler.openRefundsAfterMissedBooking.selector;
        selectors[4] = ShowCampaignEscrowHandler.confirmBooking.selector;
        selectors[5] = ShowCampaignEscrowHandler.releaseDeposit.selector;
        selectors[6] = ShowCampaignEscrowHandler.confirmFulfillment.selector;
        selectors[7] = ShowCampaignEscrowHandler.releaseFunds.selector;
        selectors[8] = ShowCampaignEscrowHandler.cancelCampaign.selector;
        selectors[9] = ShowCampaignEscrowHandler.claimRefund.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_releasedAndRefundedNeverExceedPledged() public view {
        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assertLe(totalReleased + totalRefunded, totalPledged);
    }

    function invariant_contractBalanceCoversOutstandingLiability() public view {
        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        uint256 outstanding = totalPledged - totalRefunded - totalReleased;

        assertGe(usdc.balanceOf(address(escrow)), outstanding);
    }

    function invariant_fundingDoesNotReleaseFunds() public view {
        if (escrow.campaignStatus(campaignId) == CampaignStatus.Funded) {
            (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
            assertEq(totalReleased, 0);
        }
    }

    function invariant_callSummary() public view {
        console.log("Show campaign calls:");
        console.log("  pledges:", handler.pledgeCalls());
        console.log("  booking confirmations:", handler.bookingCalls());
        console.log("  fulfillment confirmations:", handler.fulfillmentCalls());
    }
}

contract ShowCampaignEscrowHandler is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public immutable escrow;
    MockUSDC public immutable usdc;
    uint256 public immutable campaignId;
    address public immutable confirmer;
    address public immutable campaignOwner;

    address[] public actors;
    uint256 public pledgeCalls;
    uint256 public bookingCalls;
    uint256 public fulfillmentCalls;

    constructor(ShowCampaignEscrow _escrow, MockUSDC _usdc, uint256 _campaignId, address _confirmer, address _owner) {
        escrow = _escrow;
        usdc = _usdc;
        campaignId = _campaignId;
        confirmer = _confirmer;
        campaignOwner = _owner;

        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("showBacker", i)));
            actors.push(actor);
            usdc.mint(actor, 500_000e6);
            vm.prank(actor);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function advanceTime(uint256 secondsToAdvance) external {
        secondsToAdvance = bound(secondsToAdvance, 0, 45 days);
        vm.warp(block.timestamp + secondsToAdvance);
    }

    function pledge(uint256 actorSeed, uint256 amount) external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.Active) return;
        amount = bound(amount, 1e6, 500_000e6);
        address actor = actors[actorSeed % actors.length];
        if (usdc.balanceOf(actor) < amount) return;

        vm.prank(actor);
        try escrow.pledge(campaignId, amount) {
            pledgeCalls++;
        } catch {}
    }

    function markFailed() external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.Active) return;

        try escrow.markFailed(campaignId) {} catch {}
    }

    function openRefundsAfterMissedBooking() external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.Funded) return;

        try escrow.openRefundsAfterMissedBooking(campaignId) {} catch {}
    }

    function confirmBooking() external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.Funded) return;

        vm.prank(confirmer);
        try escrow.confirmBooking(campaignId) {
            bookingCalls++;
        } catch {}
    }

    function releaseDeposit() external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.BookingConfirmed) return;

        vm.prank(confirmer);
        try escrow.releaseDeposit(campaignId) {} catch {}
    }

    function confirmFulfillment() external {
        CampaignStatus status = escrow.campaignStatus(campaignId);
        if (status != CampaignStatus.BookingConfirmed && status != CampaignStatus.DepositReleased) return;

        vm.prank(confirmer);
        try escrow.confirmFulfillment(campaignId) {
            fulfillmentCalls++;
        } catch {}
    }

    function releaseFunds() external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.Fulfilled) return;

        try escrow.releaseFunds(campaignId) {} catch {}
    }

    function cancelCampaign() external {
        vm.prank(campaignOwner);
        try escrow.cancelCampaign(campaignId) {} catch {}
    }

    function claimRefund(uint256 actorSeed) external {
        if (escrow.campaignStatus(campaignId) != CampaignStatus.RefundAvailable) return;
        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try escrow.claimRefund(campaignId) {} catch {}
    }
}
