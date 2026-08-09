// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {IRevenueEscrow} from "../../src/interfaces/IRevenueEscrow.sol";
import {RevenueEscrowV2} from "../mocks/RevenueEscrowV2.sol";
import {RevenueEscrowProxyDeployer} from "../utils/RevenueEscrowProxyDeployer.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

contract RevenueEscrowUpgradeTest is Test, IRevenueEscrow {
    RevenueEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal authority = makeAddr("authority");
    address internal nextAuthority = makeAddr("nextAuthority");
    address internal beneficiary = makeAddr("beneficiary");
    address internal depositor = makeAddr("depositor");

    function setUp() public {
        escrow = RevenueEscrowProxyDeployer.deploy(owner, 30 days, authority);
        usdc = new MockUSDC();
        vm.prank(owner);
        escrow.setDepositor(depositor, true);
    }

    function test_ImplementationCannotBeInitialized() public {
        RevenueEscrow implementation = new RevenueEscrow();
        vm.expectRevert();
        implementation.initialize(owner, 30 days, authority);
    }

    function test_InitializeRejectsZeroUpgradeAuthority() public {
        RevenueEscrow implementation = new RevenueEscrow();
        vm.expectRevert(IRevenueEscrow.ZeroAddress.selector);
        new ERC1967Proxy(
            address(implementation), abi.encodeCall(RevenueEscrow.initialize, (owner, uint256(30 days), address(0)))
        );
    }

    function test_OnlyAuthorityCanUpgradeAndRotateAuthority() public {
        RevenueEscrowV2 v2 = new RevenueEscrowV2();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.upgradeToAndCall(address(v2), "");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedUpgrade.selector, owner));
        escrow.setUpgradeAuthority(nextAuthority);

        vm.prank(authority);
        vm.expectEmit(true, true, false, true);
        emit UpgradeAuthorityUpdated(authority, nextAuthority);
        escrow.setUpgradeAuthority(nextAuthority);

        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedUpgrade.selector, authority));
        escrow.upgradeToAndCall(address(v2), "");

        vm.prank(nextAuthority);
        escrow.upgradeToAndCall(address(v2), "");
        assertEq(RevenueEscrowV2(address(escrow)).version(), 2);
    }

    function test_AuthorityCannotBeRotatedToZero() public {
        vm.prank(authority);
        vm.expectRevert(IRevenueEscrow.ZeroAddress.selector);
        escrow.setUpgradeAuthority(address(0));
    }

    function test_TwoStepOwnership() public {
        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        escrow.transferOwnership(nextOwner);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), nextOwner);

        vm.prank(nextOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), nextOwner);
    }

    function test_PauseBlocksEveryCustodyMovementButNotAdminOrViews() public {
        vm.deal(depositor, 2 ether);
        usdc.mint(depositor, 100e6);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), 100e6);
        escrow.deposit{value: 1 ether}(1, beneficiary);
        escrow.depositWithAsset(1, beneficiary, address(usdc), 100e6);
        vm.stopPrank();

        vm.prank(owner);
        escrow.freeze(1);
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit RevenueEscrowPaused(true);
        escrow.setPaused(true);

        vm.prank(depositor);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.deposit{value: 1}(2, beneficiary);
        vm.prank(depositor);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.depositWithAsset(2, beneficiary, address(usdc), 1);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.release(1);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.releaseAsset(1, address(usdc));
        vm.prank(owner);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.redirect(1, beneficiary);
        vm.prank(owner);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.redirectAsset(1, address(usdc), beneficiary);
        vm.prank(beneficiary);
        vm.expectRevert(IRevenueEscrow.Paused.selector);
        escrow.claimFailedPayment(address(0));

        // Views, dispute controls, configuration, ownership, and governance remain live.
        escrow.getEscrow(1);
        vm.startPrank(owner);
        escrow.unfreeze(1);
        escrow.setDefaultEscrowPeriod(7 days);
        escrow.setDepositor(depositor, false);
        escrow.transferOwnership(beneficiary);
        escrow.setPaused(false);
        vm.stopPrank();
        vm.prank(authority);
        escrow.setUpgradeAuthority(nextAuthority);
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(depositor);
        vm.expectRevert();
        escrow.setPaused(true);
    }
}
