// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {ShowCampaignEscrowV2} from "../mocks/ShowCampaignEscrowV2.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

/**
 * @title ShowCampaignEscrow ⇄ TimelockController integration (issue #1497, SCE-2/#1271)
 * @notice Exercises the real production authority path: an ERC1967 proxy whose
 *         upgradeAuthority is a TimelockController. The ops owner and an
 *         independent guardian each hold PROPOSER + EXECUTOR + CANCELLER on the
 *         timelock, so recovery does not depend on a single key. Funds are
 *         escrowed, an upgrade is scheduled + executed through the timelock, and
 *         the migrated state / post-upgrade settlement are asserted. Also verifies
 *         the SCE-2 recovery model: the guardian can independently drive a
 *         recovery upgrade, and owner/guardian can mutually cancel each other's
 *         scheduled upgrades during the 48h delay.
 */
contract ShowCampaignEscrowTimelockTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow; // proxy
    TimelockController public timelock;
    MockUSDC public usdc;

    address public owner = makeAddr("owner"); // ops owner = proposer + executor + canceller
    address public guardian = makeAddr("guardian"); // independent recovery: proposer + executor + canceller
    address public artist = makeAddr("artist");
    address public confirmer = makeAddr("confirmer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public feeRecipient = makeAddr("feeRecipient");

    bytes32 public constant ARTIST_ID_HASH = keccak256("artist:sennarin");
    bytes32 public constant AUTHORITY_HASH = keccak256("authority:sennarin:wallet");
    uint256 public constant MIN_DELAY = 48 hours;
    uint256 public constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        usdc = new MockUSDC();

        // Mirror DeployShowCampaignEscrow: timelock with ops owner as proposer/executor
        // (and canceller, via the OZ 5.x constructor), this test as transient admin to grant
        // the guardian an independent proposer + executor + canceller recovery path, then renounce.
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, address(this));
        timelock.grantRole(timelock.PROPOSER_ROLE(), guardian);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), guardian);
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        ShowCampaignEscrow impl = new ShowCampaignEscrow();
        bytes memory initData =
            abi.encodeCall(ShowCampaignEscrow.initialize, (owner, 0, feeRecipient, address(timelock)));
        escrow = ShowCampaignEscrow(address(new ERC1967Proxy(address(impl), initData)));

        vm.prank(owner);
        escrow.setConfirmer(confirmer, true);

        _mintAndApprove(alice, 2_000e6);
        _mintAndApprove(bob, 2_000e6);
    }

    function test_UpgradeThroughTimelockPreservesEscrowAndSettles() public {
        // Escrow real funds.
        uint256 id = _fundCampaign();
        (uint256 pledged,,) = escrow.campaignAccounting(id);
        assertEq(pledged, 1_100e6);
        assertEq(usdc.balanceOf(address(escrow)), 1_100e6);
        assertEq(escrow.upgradeAuthority(), address(timelock));

        // Schedule the upgrade through the timelock (only the ops owner may propose).
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("upgrade-v2");

        vm.prank(owner);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        bytes32 opId = timelock.hashOperation(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationPending(opId));

        // Cannot execute before the delay elapses.
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);

        // Warp past the delay and execute.
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationDone(opId));

        // New implementation is live and all escrow state survived.
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.upgradeAuthority(), address(timelock));
        (uint256 pledgedAfter,,) = escrow.campaignAccounting(id);
        assertEq(pledgedAfter, 1_100e6);
        assertEq(usdc.balanceOf(address(escrow)), 1_100e6);
        assertEq(uint8(escrow.campaignStatus(id)), uint8(CampaignStatus.Funded));

        // Post-upgrade settlement works end to end.
        vm.startPrank(confirmer);
        escrow.confirmBooking(id);
        escrow.confirmFulfillment(id);
        vm.stopPrank();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        escrow.releaseFunds(id);
        assertEq(usdc.balanceOf(artist), 1_100e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.campaignStatus(id)), uint8(CampaignStatus.Released));
    }

    function test_PostUpgradeRefundPathWorks() public {
        uint256 id = _createAndActivate();
        vm.prank(alice);
        escrow.pledge(id, 100e6);

        // Upgrade while a single-backer campaign is mid-flight.
        _scheduleAndExecuteUpgrade();
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);

        // Refund path still settles after the upgrade.
        vm.warp(block.timestamp + 15 days);
        escrow.markFailed(id);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(alice) - before, 100e6);
        assertEq(uint8(escrow.campaignStatus(id)), uint8(CampaignStatus.Refunded));
    }

    function test_GuardianCanCancelScheduledUpgrade() public {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("cancel-me");

        vm.prank(owner);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        bytes32 opId = timelock.hashOperation(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationPending(opId));

        // Guardian aborts the scheduled upgrade.
        vm.prank(guardian);
        timelock.cancel(opId);
        assertFalse(timelock.isOperation(opId));

        // A cancelled operation cannot be executed even after the delay.
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
    }

    /// @notice The real 2.0.0→2.1.0 migration (issue #1271): the timelock upgrade carries
    /// `initializeV2(window)` so an already-deployed proxy gains a non-zero fulfillment
    /// window atomically. A campaign booked BEFORE the upgrade keeps `fulfillmentDeadline
    /// == 0` (escape inert), while a campaign booked AFTER gets a live deadline.
    function test_UpgradeThroughTimelockRunsInitializeV2AndLegacyBookingStaysInert() public {
        // Legacy campaign: booked while the window is still 0 (pre-upgrade).
        uint256 legacy = _fundCampaign();
        vm.prank(confirmer);
        escrow.confirmBooking(legacy);
        assertEq(escrow.fulfillmentWindow(), 0);

        // Schedule + execute upgradeToAndCall(v2, initializeV2(30 days)) through the timelock.
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory initV2 = abi.encodeCall(ShowCampaignEscrow.initializeV2, (uint256(30 days)));
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), initV2));
        bytes32 salt = keccak256("upgrade-v2.1.0");

        vm.prank(owner);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);

        // The reinitializer ran in the same upgrade: the window is now live.
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);
        assertEq(escrow.fulfillmentWindow(), 30 days);

        // Legacy campaign booked pre-upgrade has deadline 0 → escape stays inert forever.
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                IShowCampaignEscrow.FulfillmentDeadlineNotPassed.selector, legacy, 0, block.timestamp
            )
        );
        escrow.openRefundsAfterMissedFulfillment(legacy);

        // A NEW campaign booked post-upgrade gets a live deadline and the escape works.
        _mintAndApprove(alice, 2_000e6);
        _mintAndApprove(bob, 2_000e6);
        uint256 fresh = _fundCampaign();
        vm.prank(confirmer);
        escrow.confirmBooking(fresh);
        vm.warp(block.timestamp + 30 days + 1);
        escrow.openRefundsAfterMissedFulfillment(fresh);
        assertEq(uint8(escrow.campaignStatus(fresh)), uint8(CampaignStatus.RefundAvailable));
    }

    function test_DirectUpgradeBypassingTimelockReverts() public {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        // The ops owner is NOT the upgrade authority; only the timelock is.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.upgradeToAndCall(address(v2), "");
    }

    /// SCE-2 (#1271): assert the governance role wiring that guarantees an
    /// independent recovery path. Both owner and guardian must be full
    /// proposer + executor + canceller, and no EOA may retain admin.
    function test_TimelockRoleWiringGivesGuardianIndependentRecoveryPath() public view {
        bytes32 proposer = timelock.PROPOSER_ROLE();
        bytes32 executor = timelock.EXECUTOR_ROLE();
        bytes32 canceller = timelock.CANCELLER_ROLE();
        bytes32 admin = timelock.DEFAULT_ADMIN_ROLE();

        // Ops owner: proposer + executor + canceller (canceller granted by the OZ constructor).
        assertTrue(timelock.hasRole(proposer, owner), "owner PROPOSER");
        assertTrue(timelock.hasRole(executor, owner), "owner EXECUTOR");
        assertTrue(timelock.hasRole(canceller, owner), "owner CANCELLER");

        // Guardian: an independent proposer + executor + canceller recovery key.
        assertTrue(timelock.hasRole(proposer, guardian), "guardian PROPOSER");
        assertTrue(timelock.hasRole(executor, guardian), "guardian EXECUTOR");
        assertTrue(timelock.hasRole(canceller, guardian), "guardian CANCELLER");

        // No EOA admin remains; the timelock is self-administered.
        assertFalse(timelock.hasRole(admin, address(this)), "deployer renounced ADMIN");
        assertFalse(timelock.hasRole(admin, owner), "owner has no ADMIN");
        assertFalse(timelock.hasRole(admin, guardian), "guardian has no ADMIN");
        assertTrue(timelock.hasRole(admin, address(timelock)), "timelock self-administers");
    }

    /// SCE-2 (#1271): the guardian can drive a recovery upgrade end-to-end with
    /// NO owner involvement — schedule, wait out the 48h delay, then execute.
    /// This is the frozen-funds recovery path when the owner key is lost.
    function test_GuardianCanScheduleAndExecuteRecoveryUpgrade() public {
        // Fund a campaign so we prove escrow survives a guardian-driven recovery.
        uint256 id = _fundCampaign();
        assertEq(usdc.balanceOf(address(escrow)), 1_100e6);

        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("guardian-recovery");

        // Guardian schedules independently of the owner.
        vm.prank(guardian);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        bytes32 opId = timelock.hashOperation(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationPending(opId));

        // Cannot execute before the delay elapses — safety is preserved.
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);

        // Warp past the 48h delay and let the guardian execute the recovery.
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationDone(opId));

        // Recovery upgrade is live and escrow state survived.
        assertEq(ShowCampaignEscrowV2(address(escrow)).version(), 2);
        assertEq(escrow.owner(), owner);
        assertEq(usdc.balanceOf(address(escrow)), 1_100e6);
    }

    /// SCE-2 (#1271): the owner can cancel a guardian-scheduled upgrade during
    /// the delay — the mutual-cancel check that keeps a compromised guardian
    /// from forcing a malicious upgrade.
    function test_OwnerCanCancelGuardianScheduledUpgrade() public {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("guardian-cancel-me");

        vm.prank(guardian);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        bytes32 opId = timelock.hashOperation(address(escrow), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationPending(opId));

        // Owner aborts the guardian-scheduled upgrade.
        vm.prank(owner);
        timelock.cancel(opId);
        assertFalse(timelock.isOperation(opId));

        // A cancelled operation cannot be executed even after the delay.
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _scheduleAndExecuteUpgrade() internal {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("upgrade");
        vm.prank(owner);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
    }

    function _createAndActivate() internal returns (uint256 id) {
        vm.startPrank(owner);
        id = escrow.createCampaign(
            ARTIST_ID_HASH,
            AUTHORITY_HASH,
            artist,
            address(usdc),
            1_000e6,
            2,
            block.timestamp + 14 days,
            block.timestamp + 30 days,
            0,
            DISPUTE_WINDOW
        );
        escrow.activateCampaign(id);
        vm.stopPrank();
    }

    function _fundCampaign() internal returns (uint256 id) {
        id = _createAndActivate();
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
