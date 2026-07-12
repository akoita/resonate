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
 * @title ShowCampaignEscrow ⇄ TimelockController integration (issue #1497)
 * @notice Exercises the real production authority path: an ERC1967 proxy whose
 *         upgradeAuthority is a TimelockController with a guardian CANCELLER.
 *         Funds are escrowed, an upgrade is scheduled + executed through the
 *         timelock, and the migrated state / post-upgrade settlement are asserted.
 */
contract ShowCampaignEscrowTimelockTest is Test, IShowCampaignEscrow {
    ShowCampaignEscrow public escrow; // proxy
    TimelockController public timelock;
    MockUSDC public usdc;

    address public owner = makeAddr("owner"); // ops owner = proposer + executor
    address public guardian = makeAddr("guardian"); // CANCELLER only
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

        // Mirror DeployShowCampaignEscrow: timelock with ops owner as proposer/executor,
        // this test as transient admin to grant the guardian CANCELLER, then renounce.
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, address(this));
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

    function test_DirectUpgradeBypassingTimelockReverts() public {
        ShowCampaignEscrowV2 v2 = new ShowCampaignEscrowV2();
        // The ops owner is NOT the upgrade authority; only the timelock is.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IShowCampaignEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.upgradeToAndCall(address(v2), "");
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
