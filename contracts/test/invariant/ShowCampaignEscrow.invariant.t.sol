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
    address public feeRecipient = makeAddr("feeRecipient");

    uint256 public campaignId;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShowCampaignEscrow(owner, 600, feeRecipient);

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

        handler = new ShowCampaignEscrowHandler(escrow, usdc, campaignId, confirmer, owner, artist, feeRecipient);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](11);
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
        selectors[10] = ShowCampaignEscrowHandler.setFeeConfig.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_releasedAndRefundedNeverExceedPledged() public view {
        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);

        assertLe(totalReleased + totalRefunded, totalPledged);
    }

    function invariant_contractBalanceEqualsOutstandingLiability() public view {
        (uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        uint256 outstanding = totalPledged - totalRefunded - totalReleased;

        assertEq(usdc.balanceOf(address(escrow)), outstanding);
    }

    function invariant_feeRecipientReceivedEqualsTotalFeePaid() public view {
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);

        assertEq(handler.feeRecipientReceived(), totalFeePaid);
    }

    function invariant_beneficiaryReceivedEqualsReleasedNetOfFees() public view {
        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        (, uint256 totalFeePaid) = escrow.campaignFees(campaignId);

        assertEq(handler.beneficiaryReceived(), totalReleased - totalFeePaid);
    }

    function invariant_totalFeePaidBoundedByGrossReleased() public view {
        (,, uint256 totalReleased) = escrow.campaignAccounting(campaignId);
        (uint256 feeBps, uint256 totalFeePaid) = escrow.campaignFees(campaignId);

        assertLe(totalFeePaid, totalReleased * feeBps / escrow.BPS_DENOMINATOR() + 1);
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
    address public immutable beneficiary;
    address public immutable feeRecipient;

    address[] public actors;
    address public immutable feeRecipientAlt;
    uint256 public pledgeCalls;
    uint256 public bookingCalls;
    uint256 public fulfillmentCalls;
    uint256 public beneficiaryReceived;
    uint256 public feeRecipientReceived;

    constructor(
        ShowCampaignEscrow _escrow,
        MockUSDC _usdc,
        uint256 _campaignId,
        address _confirmer,
        address _owner,
        address _beneficiary,
        address _feeRecipient
    ) {
        escrow = _escrow;
        usdc = _usdc;
        campaignId = _campaignId;
        confirmer = _confirmer;
        campaignOwner = _owner;
        beneficiary = _beneficiary;
        feeRecipient = _feeRecipient;
        feeRecipientAlt = makeAddr("feeRecipientAlt");

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

        uint256 beneficiaryBefore = usdc.balanceOf(beneficiary);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        uint256 feeAltBefore = usdc.balanceOf(feeRecipientAlt);
        vm.prank(confirmer);
        try escrow.releaseDeposit(campaignId) {
            beneficiaryReceived += usdc.balanceOf(beneficiary) - beneficiaryBefore;
            feeRecipientReceived += usdc.balanceOf(feeRecipient) - feeBefore;
            feeRecipientReceived += usdc.balanceOf(feeRecipientAlt) - feeAltBefore;
        } catch {}
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

        uint256 beneficiaryBefore = usdc.balanceOf(beneficiary);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        uint256 feeAltBefore = usdc.balanceOf(feeRecipientAlt);
        try escrow.releaseFunds(campaignId) {
            beneficiaryReceived += usdc.balanceOf(beneficiary) - beneficiaryBefore;
            feeRecipientReceived += usdc.balanceOf(feeRecipient) - feeBefore;
            feeRecipientReceived += usdc.balanceOf(feeRecipientAlt) - feeAltBefore;
        } catch {}
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

    function setFeeConfig(uint256 feeBps, uint256 recipientSeed) external {
        feeBps = bound(feeBps, 0, escrow.MAX_CAMPAIGN_FEE_BPS());
        // Rotate only between dedicated fee wallets — never the beneficiary. If the
        // fee recipient collided with the beneficiary, balance deltas could no longer
        // attribute net vs fee, and the balance-based ghost accounting (the whole
        // point of these invariants) would degenerate. Invalid-recipient attempts
        // stay in to exercise the revert path.
        address recipient = recipientSeed % 2 == 0 ? feeRecipient : feeRecipientAlt;
        if (recipientSeed % 5 == 0) recipient = address(0);

        vm.prank(campaignOwner);
        try escrow.setFeeConfig(feeBps, recipient) {} catch {}
    }
}
