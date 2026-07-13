// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {ShowCampaignEscrowV2} from "../mocks/ShowCampaignEscrowV2.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {EscrowProxyDeployer} from "../utils/EscrowProxyDeployer.sol";

/**
 * @title ShowCampaignEscrow — UUPS upgrade & extended-pause tests (issue #1497)
 * @notice Covers the proxy/initializer contract, the owner↔upgradeAuthority split,
 *         and that the emergency pause now freezes every fund-outflow / lifecycle
 *         function while the pause lever itself keeps working.
 */
contract ShowCampaignEscrowUpgradeTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public upgradeAuthority = makeAddr("upgradeAuthority");
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public feeRecipient = makeAddr("feeRecipient");

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant GOAL = 1_000e6;
    uint256 public constant MIN_BACKERS = 2;
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = EscrowProxyDeployer.deploy(owner, 0, feeRecipient, upgradeAuthority);

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        _mintAndApprove(alice, 2_000e6);
        _mintAndApprove(bob, 2_000e6);
    }

    // ── Initializer / proxy plumbing ────────────────────────────────────────

    function test_InitializeRunsOnceOnProxy() public {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.upgradeAuthority(), upgradeAuthority);
        assertEq(escrow.nextCampaignId(), 1);

        vm.expectRevert(abi.encodeWithSignature("InvalidInitialization()"));
        escrow.initialize(owner, 0, feeRecipient, upgradeAuthority);
    }

    function test_ImplementationIsInitializerDisabled() public {
        ShowCampaignEscrow impl = new ShowCampaignEscrow();
        vm.expectRevert(abi.encodeWithSignature("InvalidInitialization()"));
        impl.initialize(owner, 0, feeRecipient, upgradeAuthority);
    }

    // ── Upgrade authorization ───────────────────────────────────────────────

    function test_UpgradeByNonAuthorityReverts() public {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();

        // Even the operational owner cannot upgrade — only the upgradeAuthority.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.upgradeToAndCall(address(v2), "");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, alice));
        escrow.upgradeToAndCall(address(v2), "");
    }

    function test_UpgradeByAuthorityPreservesState() public {
        // Seed real state: a funded campaign with two backers.
        uint256 campaignId = _fundCampaign();
        (uint256 pledgedBefore,,) = escrow.campaignAccounting(campaignId);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Funded));

        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        vm.prank(upgradeAuthority);
        escrow.upgradeToAndCall(address(v2), "");

        // New logic is live…
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);
        // …and all prior state survived the implementation swap.
        assertEq(escrow.owner(), owner);
        assertEq(escrow.upgradeAuthority(), upgradeAuthority);
        (uint256 pledgedAfter,,) = escrow.campaignAccounting(campaignId);
        assertEq(pledgedAfter, pledgedBefore);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Funded));

        // The campaign still settles correctly after the upgrade.
        vm.startPrank(confirmer);
        escrow.confirmBooking(campaignId);
        escrow.confirmFulfillment(campaignId);
        vm.stopPrank();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(campaignId);
        assertEq(usdc.balanceOf(artist), pledgedBefore);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(CampaignStatus.Released));
    }

    // ── setUpgradeAuthority ─────────────────────────────────────────────────

    function test_SetUpgradeAuthorityOnlyByAuthority() public {
        address newAuthority = makeAddr("newAuthority");

        // Owner (and anyone else) cannot reassign the authority.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.setUpgradeAuthority(newAuthority);

        // Zero address rejected.
        vm.prank(upgradeAuthority);
        vm.expectRevert(IShowCampaignEscrow.ZeroAddress.selector);
        escrow.setUpgradeAuthority(address(0));

        // The current authority hands off.
        vm.prank(upgradeAuthority);
        vm.expectEmit(true, true, false, false);
        emit UpgradeAuthorityUpdated(upgradeAuthority, newAuthority);
        escrow.setUpgradeAuthority(newAuthority);
        assertEq(escrow.upgradeAuthority(), newAuthority);

        // Old authority can no longer upgrade; the new one can.
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        vm.prank(upgradeAuthority);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, upgradeAuthority));
        escrow.upgradeToAndCall(address(v2), "");

        vm.prank(newAuthority);
        escrow.upgradeToAndCall(address(v2), "");
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);
    }

    // ── initializeV2 reinitializer (issue #1271) ────────────────────────────

    /// @notice initializeV2 sets the fulfillment window, emits, and can only run once.
    function test_InitializeV2SetsFulfillmentWindowAndRunsOnce() public {
        // Fresh proxy: initialize (v1) ran in the deployer; fulfillmentWindow is still 0.
        ShowCampaignEscrow fresh = EscrowProxyDeployer.deploy(owner, 0, feeRecipient, upgradeAuthority);
        assertEq(fresh.fulfillmentWindow(), 0);

        vm.expectEmit(false, false, false, true);
        emit FulfillmentWindowUpdated(0, 30 days);
        fresh.initializeV2(30 days);
        assertEq(fresh.fulfillmentWindow(), 30 days);

        // The reinitializer is one-shot — a replay reverts.
        vm.expectRevert(abi.encodeWithSignature("InvalidInitialization()"));
        fresh.initializeV2(45 days);
    }

    function test_InitializeV2RejectsOutOfBoundsWindow() public {
        uint256 minW = escrow.MIN_FULFILLMENT_WINDOW();
        uint256 maxW = escrow.MAX_FULFILLMENT_WINDOW();

        ShowCampaignEscrow fresh = EscrowProxyDeployer.deploy(owner, 0, feeRecipient, upgradeAuthority);

        // Below the floor (0 included) reverts; the revert rolls back the reinitializer,
        // so a subsequent in-bounds call still succeeds.
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.InvalidFulfillmentWindow.selector, 0, minW, maxW));
        fresh.initializeV2(0);

        vm.expectRevert(
            abi.encodeWithSelector(IShowCampaignEscrow.InvalidFulfillmentWindow.selector, maxW + 1, minW, maxW)
        );
        fresh.initializeV2(maxW + 1);

        fresh.initializeV2(minW);
        assertEq(fresh.fulfillmentWindow(), minW);
    }

    // ── Extended pause: every fund-outflow / lifecycle fn is frozen ──────────

    function test_PauseBlocksMarkFailed() public {
        uint256 id = _createAndActivate(0);
        vm.prank(alice);
        escrow.pledge(id, 100e6);
        vm.warp(block.timestamp + 15 days);
        _pause();
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.markFailed(id);
    }

    function test_PauseBlocksCancelCampaign() public {
        uint256 id = _createAndActivate(0);
        _pause();
        vm.prank(owner);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.cancelCampaign(id);
    }

    function test_PauseBlocksOpenRefundsAfterMissedBooking() public {
        uint256 id = _fundCampaign();
        vm.warp(block.timestamp + 31 days);
        _pause();
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.openRefundsAfterMissedBooking(id);
    }

    function test_PauseBlocksConfirmBooking() public {
        uint256 id = _fundCampaign();
        _pause();
        vm.prank(confirmer);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.confirmBooking(id);
    }

    function test_PauseBlocksReleaseDeposit() public {
        uint256 id = _fundCampaign(2_000);
        vm.prank(confirmer);
        escrow.confirmBooking(id);
        _pause();
        vm.prank(confirmer);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.releaseDeposit(id);
    }

    function test_PauseBlocksConfirmFulfillment() public {
        uint256 id = _fundCampaign();
        vm.prank(confirmer);
        escrow.confirmBooking(id);
        _pause();
        vm.prank(confirmer);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.confirmFulfillment(id);
    }

    function test_PauseBlocksReleaseFunds() public {
        uint256 id = _fundCampaign();
        vm.startPrank(confirmer);
        escrow.confirmBooking(id);
        escrow.confirmFulfillment(id);
        vm.stopPrank();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        _pause();
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.releaseFunds(id);
    }

    function test_PauseBlocksClaimRefund() public {
        uint256 id = _createAndActivate(0);
        vm.prank(alice);
        escrow.pledge(id, 100e6);
        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(id);
        _pause();
        vm.prank(alice);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.claimRefund(id);
    }

    /// @notice The pause lever itself always works, and unpausing restores flow.
    function test_PauseLeverWorksAndUnpauseRestoresFlow() public {
        uint256 id = _fundCampaign();
        _pause();
        assertTrue(escrow.paused());

        vm.prank(confirmer);
        vm.expectRevert(IShowCampaignEscrow.Paused.selector);
        escrow.confirmBooking(id);

        // Owner can always unpause (setPaused is never gated), then flow resumes.
        vm.prank(owner);
        escrow.setPaused(false);
        assertFalse(escrow.paused());

        vm.prank(confirmer);
        escrow.confirmBooking(id);
        assertEq(uint8(escrow.campaignStatus(id)), uint8(CampaignStatus.BookingConfirmed));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _pause() internal {
        vm.prank(owner);
        escrow.setPaused(true);
    }

    function _createAndActivate(uint256 depositReleaseBps) internal returns (uint256 id) {
        vm.startPrank(owner);
        id = escrow.createCampaign(
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
        escrow.activateCampaign(id);
        vm.stopPrank();
    }

    function _fundCampaign() internal returns (uint256 id) {
        return _fundCampaign(0);
    }

    function _fundCampaign(uint256 depositReleaseBps) internal returns (uint256 id) {
        id = _createAndActivate(depositReleaseBps);
        vm.prank(alice);
        escrow.pledge(id, 600e6);
        vm.prank(bob);
        escrow.pledge(id, 500e6);
    }

    function _mintAndApprove(address backer, uint256 amount) internal {
        usdc.mint(backer, amount);
        vm.prank(backer);
        usdc.approve(address(escrow), amount);
    }
}
