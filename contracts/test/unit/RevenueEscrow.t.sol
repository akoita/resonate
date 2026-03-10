// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title RevenueEscrow Unit Tests
 * @notice Tests deposit, freeze, release, redirect, and admin functions
 */
contract RevenueEscrowTest is Test {
    RevenueEscrow public escrow;
    ContentProtection public cp;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public rightfulOwner = makeAddr("rightfulOwner");

    uint256 constant ESCROW_PERIOD = 30 days;
    uint256 constant STAKE_AMOUNT = 0.01 ether;

    event RevenueDeposited(uint256 indexed tokenId, address indexed depositor, uint256 amount, uint256 newBalance);
    event EscrowFrozen(uint256 indexed tokenId);
    event EscrowUnfrozen(uint256 indexed tokenId);
    event EscrowReleased(uint256 indexed tokenId, address indexed beneficiary, uint256 amount);
    event EscrowRedirected(uint256 indexed tokenId, address indexed newRecipient, uint256 amount);

    function setUp() public {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (admin, treasury, STAKE_AMOUNT));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cp = ContentProtection(address(proxy));

        vm.prank(admin);
        escrow = new RevenueEscrow(admin, ESCROW_PERIOD);

        vm.prank(admin);
        escrow.setContentProtection(address(cp));
    }

    // ============ Deposit ============

    function test_Deposit_FirstDeposit() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(true, true, false, true);
        emit RevenueDeposited(1, address(this), 0.5 ether, 0.5 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        (address beneficiary, uint256 balance, uint256 escrowEndTime, bool frozen) = escrow.getEscrow(1);
        assertEq(beneficiary, alice);
        assertEq(balance, 0.5 ether);
        assertGt(escrowEndTime, block.timestamp);
        assertFalse(frozen);
    }

    function test_Deposit_MultipleDeposits() public {
        vm.deal(address(this), 2 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        escrow.deposit{value: 0.3 ether}(1, alice);

        (, uint256 balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0.8 ether);
    }

    function test_Deposit_RevertZeroAmount() public {
        vm.expectRevert(RevenueEscrow.ZeroAmount.selector);
        escrow.deposit{value: 0}(1, alice);
    }

    function test_Deposit_RevertZeroAddress() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(RevenueEscrow.ZeroAddress.selector);
        escrow.deposit{value: 0.5 ether}(1, address(0));
    }

    // ============ Freeze / Unfreeze ============

    function test_Freeze() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit EscrowFrozen(1);
        escrow.freeze(1);

        (,,, bool frozen) = escrow.getEscrow(1);
        assertTrue(frozen);
    }

    function test_Freeze_RevertNoEscrow() public {
        vm.prank(admin);
        vm.expectRevert(RevenueEscrow.NoEscrow.selector);
        escrow.freeze(999);
    }

    function test_Freeze_RevertNotOwner() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(bob);
        vm.expectRevert();
        escrow.freeze(1);
    }

    function test_Unfreeze() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.startPrank(admin);
        escrow.freeze(1);
        escrow.unfreeze(1);
        vm.stopPrank();

        (,,, bool frozen) = escrow.getEscrow(1);
        assertFalse(frozen);
    }

    function test_Unfreeze_RevertNotFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        vm.expectRevert(RevenueEscrow.EscrowNotFrozen.selector);
        escrow.unfreeze(1);
    }

    // ============ Release ============

    function test_Release() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        // Fast-forward past escrow period
        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        uint256 aliceBefore = alice.balance;
        vm.expectEmit(true, true, false, true);
        emit EscrowReleased(1, alice, 0.5 ether);
        escrow.release(1);

        assertEq(alice.balance - aliceBefore, 0.5 ether);
        (, uint256 balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0);
    }

    function test_Release_RevertFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        escrow.freeze(1);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        vm.expectRevert(RevenueEscrow.EscrowIsFrozen.selector);
        escrow.release(1);
    }

    function test_Release_RevertNotExpired() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.expectRevert(RevenueEscrow.EscrowNotExpired.selector);
        escrow.release(1);
    }

    function test_Release_Permissionless() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        // Anyone can call release — funds go to beneficiary
        uint256 aliceBefore = alice.balance;
        vm.prank(bob);
        escrow.release(1);
        assertEq(alice.balance - aliceBefore, 0.5 ether);
    }

    // ============ Redirect ============

    function test_Redirect() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        escrow.freeze(1);

        uint256 rightfulBefore = rightfulOwner.balance;
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit EscrowRedirected(1, rightfulOwner, 0.5 ether);
        escrow.redirect(1, rightfulOwner);

        assertEq(rightfulOwner.balance - rightfulBefore, 0.5 ether);
    }

    function test_Redirect_RevertNotFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        vm.expectRevert(RevenueEscrow.EscrowNotFrozen.selector);
        escrow.redirect(1, rightfulOwner);
    }

    function test_Redirect_RevertNotOwner() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        escrow.freeze(1);

        vm.prank(bob);
        vm.expectRevert();
        escrow.redirect(1, rightfulOwner);
    }

    // ============ Views ============

    function test_IsReleasable_True() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        assertTrue(escrow.isReleasable(1));
    }

    function test_IsReleasable_FalseWhenFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        vm.prank(admin);
        escrow.freeze(1);
        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        assertFalse(escrow.isReleasable(1));
    }

    function test_IsReleasable_FalseBeforeExpiry() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        assertFalse(escrow.isReleasable(1));
    }

    // ============ Admin ============

    function test_SetDefaultEscrowPeriod() public {
        vm.prank(admin);
        escrow.setDefaultEscrowPeriod(7 days);
        assertEq(escrow.defaultEscrowPeriod(), 7 days);
    }

    function test_FreezeByTrack_FreezesTrackAndRegisteredStemEscrows() public {
        vm.prank(alice);
        cp.attest(10, keccak256("release"), keccak256("release-fp"), "release");
        vm.prank(alice);
        cp.attest(20, keccak256("track"), keccak256("track-fp"), "track");

        vm.startPrank(admin);
        cp.registerTrack(10, 20);
        cp.registerStem(20, 30);
        cp.registerStem(20, 31);
        cp.registerStem(20, 32);
        vm.stopPrank();

        vm.deal(address(this), 2 ether);
        escrow.deposit{value: 0.4 ether}(20, alice);
        escrow.deposit{value: 0.3 ether}(30, alice);

        vm.prank(admin);
        escrow.freezeByTrack(20);

        (,,, bool trackFrozen) = escrow.getEscrow(20);
        (,,, bool stem30Frozen) = escrow.getEscrow(30);
        (,,, bool stem31Frozen) = escrow.getEscrow(31);
        (,,, bool stem32Frozen) = escrow.getEscrow(32);

        assertTrue(trackFrozen);
        assertTrue(stem30Frozen);
        assertFalse(stem31Frozen);
        assertFalse(stem32Frozen);
    }
}
