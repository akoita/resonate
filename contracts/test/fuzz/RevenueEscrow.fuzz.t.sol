// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {IRevenueEscrow} from "../../src/interfaces/IRevenueEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

/**
 * @title RevenueEscrow Fuzz Tests
 * @notice Property-based coverage for the custody accounting, freeze/release/redirect
 *         state machine, and access control of RevenueEscrow (issue #943).
 *
 * Covers, over fuzzed amounts / token ids / time:
 *   - deposit accumulation (native + ERC20)
 *   - permissionless release pays exactly the escrowed balance after expiry
 *   - frozen escrows cannot be released, only redirected
 *   - release before expiry reverts
 *   - redirect requires a frozen escrow and pays the rightful recipient
 *   - per-(tokenId, asset) conservation: deposited == paidOut + remaining
 *   - access control on owner-only freeze/unfreeze/redirect
 */
contract RevenueEscrowFuzzTest is Test {
    RevenueEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal beneficiary = makeAddr("beneficiary");
    address internal recipient = makeAddr("recipient");
    address internal depositor = makeAddr("depositor");

    uint256 internal constant ESCROW_PERIOD = 30 days;

    function setUp() public {
        escrow = new RevenueEscrow(owner, ESCROW_PERIOD);
        usdc = new MockUSDC();
        vm.prank(owner);
        escrow.setDepositor(depositor, true);
    }

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------

    function _depositNative(uint256 tokenId, uint256 amount) internal {
        vm.deal(depositor, amount);
        vm.prank(depositor);
        escrow.deposit{value: amount}(tokenId, beneficiary);
    }

    function _depositAsset(uint256 tokenId, uint256 amount) internal {
        usdc.mint(depositor, amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrow.depositWithAsset(tokenId, beneficiary, address(usdc), amount);
        vm.stopPrank();
    }

    // ----------------------------------------------------------------------
    // Deposit accumulation
    // ----------------------------------------------------------------------

    function testFuzz_NativeDepositAccumulates(uint256 tokenId, uint96 a, uint96 b) public {
        uint256 amountA = bound(uint256(a), 1, 1e27);
        uint256 amountB = bound(uint256(b), 1, 1e27);

        uint256 startTs = block.timestamp; // captured before the first deposit
        _depositNative(tokenId, amountA);
        _depositNative(tokenId, amountB);

        (address benef, uint256 balance, uint256 endTime, bool frozen) = escrow.getEscrow(tokenId);
        assertEq(benef, beneficiary, "beneficiary set on first deposit");
        assertEq(balance, amountA + amountB, "balance accumulates");
        assertEq(endTime, startTs + ESCROW_PERIOD, "escrowEndTime fixed at first deposit");
        assertFalse(frozen, "not frozen by default");
        assertEq(address(escrow).balance, amountA + amountB, "contract holds the funds");
    }

    function testFuzz_AssetDepositAccumulates(uint256 tokenId, uint96 a, uint96 b) public {
        uint256 amountA = bound(uint256(a), 1, 1e15);
        uint256 amountB = bound(uint256(b), 1, 1e15);

        _depositAsset(tokenId, amountA);
        _depositAsset(tokenId, amountB);

        (, uint256 balance,,) = escrow.getEscrowAsset(tokenId, address(usdc));
        assertEq(balance, amountA + amountB, "asset balance accumulates");
        assertEq(usdc.balanceOf(address(escrow)), amountA + amountB, "contract holds the tokens");
    }

    // ----------------------------------------------------------------------
    // Release
    // ----------------------------------------------------------------------

    function testFuzz_ReleaseAfterExpiryPaysExactBalance(uint256 tokenId, uint96 amount, uint256 wait) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);
        uint256 waitFor = bound(wait, ESCROW_PERIOD, ESCROW_PERIOD + 3650 days);

        _depositNative(tokenId, amt);
        vm.warp(block.timestamp + waitFor);

        uint256 before = beneficiary.balance;
        // permissionless: any caller
        vm.prank(makeAddr("randomCaller"));
        escrow.release(tokenId);

        assertEq(beneficiary.balance - before, amt, "beneficiary paid exactly the balance");
        (, uint256 balance,,) = escrow.getEscrow(tokenId);
        assertEq(balance, 0, "balance zeroed after release");
        assertEq(address(escrow).balance, 0, "contract drained");
    }

    function testFuzz_ReleaseBeforeExpiryReverts(uint256 tokenId, uint96 amount, uint256 wait) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);
        uint256 waitFor = bound(wait, 0, ESCROW_PERIOD - 1);

        _depositNative(tokenId, amt);
        vm.warp(block.timestamp + waitFor);

        vm.expectRevert(IRevenueEscrow.EscrowNotExpired.selector);
        escrow.release(tokenId);
    }

    function testFuzz_FrozenBlocksRelease(uint256 tokenId, uint96 amount) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);

        _depositNative(tokenId, amt);
        vm.prank(owner);
        escrow.freeze(tokenId);
        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        vm.expectRevert(IRevenueEscrow.EscrowIsFrozen.selector);
        escrow.release(tokenId);

        // funds remain fully escrowed
        (, uint256 balance,,) = escrow.getEscrow(tokenId);
        assertEq(balance, amt, "frozen funds untouched");
        assertEq(address(escrow).balance, amt, "contract still holds frozen funds");
    }

    // ----------------------------------------------------------------------
    // Redirect
    // ----------------------------------------------------------------------

    function testFuzz_RedirectRequiresFrozen(uint256 tokenId, uint96 amount) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);
        _depositNative(tokenId, amt);

        vm.prank(owner);
        vm.expectRevert(IRevenueEscrow.EscrowNotFrozen.selector);
        escrow.redirect(tokenId, recipient);
    }

    function testFuzz_RedirectPaysRecipientAndUpdatesBeneficiary(uint256 tokenId, uint96 amount) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);

        _depositNative(tokenId, amt);
        vm.prank(owner);
        escrow.freeze(tokenId);

        uint256 before = recipient.balance;
        vm.prank(owner);
        escrow.redirect(tokenId, recipient);

        assertEq(recipient.balance - before, amt, "recipient paid the frozen balance");
        (address benef, uint256 balance,, bool frozen) = escrow.getEscrow(tokenId);
        assertEq(benef, recipient, "beneficiary updated to recipient");
        assertEq(balance, 0, "balance zeroed");
        assertFalse(frozen, "redirect clears frozen");
    }

    // ----------------------------------------------------------------------
    // Conservation: deposited == paidOut + remaining (native + asset)
    // ----------------------------------------------------------------------

    function testFuzz_ConservationNative(uint256 tokenId, uint96 amount, bool doFreeze, bool resolve) public {
        uint256 amt = bound(uint256(amount), 1, 1e27);
        _depositNative(tokenId, amt);

        uint256 paidOut;
        if (doFreeze) {
            vm.prank(owner);
            escrow.freeze(tokenId);
            if (resolve) {
                uint256 before = recipient.balance;
                vm.prank(owner);
                escrow.redirect(tokenId, recipient);
                paidOut = recipient.balance - before;
            }
        } else if (resolve) {
            vm.warp(block.timestamp + ESCROW_PERIOD + 1);
            uint256 before = beneficiary.balance;
            escrow.release(tokenId);
            paidOut = beneficiary.balance - before;
        }

        (, uint256 remaining,,) = escrow.getEscrow(tokenId);
        assertEq(amt, paidOut + remaining, "deposited == paidOut + remaining");
        assertEq(address(escrow).balance, remaining, "contract balance == outstanding liability");
    }

    function testFuzz_ConservationAsset(uint256 tokenId, uint96 amount, bool resolve) public {
        uint256 amt = bound(uint256(amount), 1, 1e15);
        _depositAsset(tokenId, amt);

        uint256 paidOut;
        if (resolve) {
            vm.warp(block.timestamp + ESCROW_PERIOD + 1);
            uint256 before = usdc.balanceOf(beneficiary);
            escrow.releaseAsset(tokenId, address(usdc));
            paidOut = usdc.balanceOf(beneficiary) - before;
        }

        (, uint256 remaining,,) = escrow.getEscrowAsset(tokenId, address(usdc));
        assertEq(amt, paidOut + remaining, "deposited == paidOut + remaining (asset)");
        assertEq(usdc.balanceOf(address(escrow)), remaining, "contract token balance == outstanding liability");
    }

    // ----------------------------------------------------------------------
    // Access control
    // ----------------------------------------------------------------------

    function testFuzz_OnlyOwnerCanFreeze(address caller, uint256 tokenId, uint96 amount) public {
        vm.assume(caller != owner);
        _depositNative(tokenId, bound(uint256(amount), 1, 1e27));

        vm.prank(caller);
        vm.expectRevert();
        escrow.freeze(tokenId);
    }

    function testFuzz_OnlyOwnerCanRedirect(address caller, uint256 tokenId, uint96 amount) public {
        vm.assume(caller != owner);
        _depositNative(tokenId, bound(uint256(amount), 1, 1e27));
        vm.prank(owner);
        escrow.freeze(tokenId);

        vm.prank(caller);
        vm.expectRevert();
        escrow.redirect(tokenId, recipient);
    }

    function testFuzz_DepositZeroAmountReverts(uint256 tokenId) public {
        vm.deal(depositor, 1 ether);
        vm.prank(depositor);
        vm.expectRevert(IRevenueEscrow.ZeroAmount.selector);
        escrow.deposit{value: 0}(tokenId, beneficiary);
    }

    function testFuzz_DepositAssetZeroAddressTokenReverts(uint256 tokenId, uint96 amount) public {
        vm.prank(depositor);
        vm.expectRevert(IRevenueEscrow.UnsupportedAsset.selector);
        escrow.depositWithAsset(tokenId, beneficiary, address(0), bound(uint256(amount), 1, 1e15));
    }
}
