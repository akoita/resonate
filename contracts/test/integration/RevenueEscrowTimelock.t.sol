// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {IRevenueEscrow} from "../../src/interfaces/IRevenueEscrow.sol";
import {RevenueEscrowV2} from "../mocks/RevenueEscrowV2.sol";
import {RevenueEscrowProxyDeployer} from "../utils/RevenueEscrowProxyDeployer.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";

contract RevenueEscrowTimelockTest is Test, IRevenueEscrow {
    uint256 internal constant MIN_DELAY = 48 hours;
    uint256 internal constant PERIOD = 30 days;

    RevenueEscrow internal escrow;
    TimelockController internal timelock;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal router = makeAddr("router");
    address internal contentProtection = makeAddr("contentProtection");
    address internal nativeBeneficiary = makeAddr("nativeBeneficiary");
    address internal tokenBeneficiary = makeAddr("tokenBeneficiary");

    function setUp() public {
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, address(this));
        timelock.grantRole(timelock.PROPOSER_ROLE(), guardian);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), guardian);
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        escrow = RevenueEscrowProxyDeployer.deploy(owner, PERIOD, address(timelock));
        usdc = new MockUSDC();
        vm.prank(owner);
        escrow.setDepositor(router, true);
        vm.prank(owner);
        escrow.setContentProtection(contentProtection);
    }

    function test_UpgradePreservesAllLiveStateAndSettles() public {
        RevertingReceiver receiver = new RevertingReceiver();

        vm.deal(router, 4 ether);
        usdc.mint(router, 500e6);
        vm.startPrank(router);
        usdc.approve(address(escrow), 500e6);
        escrow.deposit{value: 1 ether}(1, address(receiver));
        vm.stopPrank();
        vm.warp(block.timestamp + PERIOD);
        escrow.release(1);
        assertEq(escrow.failedPayments(address(0), address(receiver)), 1 ether);

        vm.startPrank(router);
        escrow.deposit{value: 2 ether}(2, nativeBeneficiary);
        escrow.depositWithAsset(3, tokenBeneficiary, address(usdc), 500e6);
        vm.stopPrank();
        vm.prank(owner);
        escrow.setDefaultEscrowPeriod(7 days);
        vm.prank(owner);
        escrow.setPaused(true);

        RevenueEscrowV2 v2 = new RevenueEscrowV2();
        bytes memory data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        bytes32 salt = keccak256("revenue-escrow-v2");
        vm.prank(owner);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);

        assertEq(RevenueEscrowV2(address(escrow)).version(), 2);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.upgradeAuthority(), address(timelock));
        assertTrue(escrow.paused());
        assertEq(escrow.defaultEscrowPeriod(), 7 days);
        assertTrue(escrow.authorizedDepositors(router));
        assertEq(address(escrow.contentProtection()), contentProtection);
        assertEq(escrow.failedPayments(address(0), address(receiver)), 1 ether);
        (address nativeTo, uint256 nativeAmount, uint256 nativeEnd,) = escrow.getEscrow(2);
        (address tokenTo, uint256 tokenAmount, uint256 tokenEnd,) = escrow.getEscrowAsset(3, address(usdc));
        assertEq(nativeTo, nativeBeneficiary);
        assertEq(nativeAmount, 2 ether);
        assertEq(tokenTo, tokenBeneficiary);
        assertEq(tokenAmount, 500e6);
        assertEq(tokenEnd, nativeEnd);
        assertEq(address(escrow).balance, 3 ether);
        assertEq(usdc.balanceOf(address(escrow)), 500e6);

        vm.prank(owner);
        escrow.setPaused(false);
        vm.warp(nativeEnd + 1);
        escrow.release(2);
        escrow.releaseAsset(3, address(usdc));
        receiver.setReject(false);
        vm.prank(address(receiver));
        escrow.claimFailedPayment(address(0));
        assertEq(nativeBeneficiary.balance, 2 ether);
        assertEq(usdc.balanceOf(tokenBeneficiary), 500e6);
        assertEq(address(receiver).balance, 1 ether);
        assertEq(address(escrow).balance, 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_DirectOwnerUpgradeReverts() public {
        RevenueEscrowV2 v2 = new RevenueEscrowV2();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.upgradeToAndCall(address(v2), "");
    }

    function test_GuardianCanCancelOwnerUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(owner, "owner-upgrade");
        vm.prank(guardian);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
    }

    function test_OwnerCanCancelGuardianUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(guardian, "guardian-upgrade");
        vm.prank(owner);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
    }

    function test_GuardianAloneCanRecoverAfterDelay() public {
        (bytes memory data, bytes32 salt,) = _schedule(guardian, "guardian-recovery");
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        timelock.execute(address(escrow), 0, data, bytes32(0), salt);
        assertEq(RevenueEscrowV2(address(escrow)).version(), 2);
    }

    function test_TimelockRoleWiringHasNoEoaAdmin() public view {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), guardian));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), owner));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)));
    }

    function _schedule(address proposer, string memory label)
        internal
        returns (bytes memory data, bytes32 salt, bytes32 operationId)
    {
        RevenueEscrowV2 v2 = new RevenueEscrowV2();
        data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        salt = keccak256(bytes(label));
        vm.prank(proposer);
        timelock.schedule(address(escrow), 0, data, bytes32(0), salt, MIN_DELAY);
        operationId = timelock.hashOperation(address(escrow), 0, data, bytes32(0), salt);
    }
}
