// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {IRevenueEscrow} from "../../src/interfaces/IRevenueEscrow.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {MockFeeOnTransferToken} from "../mocks/MockFeeOnTransferToken.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title RevenueEscrow Unit Tests
 * @notice Tests deposit, freeze, release, redirect, and admin functions
 */
contract RevenueEscrowTest is Test, IRevenueEscrow {
    RevenueEscrow public escrow;
    ContentProtection public cp;
    MockUSDC public usdc;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public rightfulOwner = makeAddr("rightfulOwner");

    uint256 constant ESCROW_PERIOD = 30 days;
    uint256 constant STAKE_AMOUNT = 0.01 ether;
    uint256 constant USDC_AMOUNT = 25_000000;

    // Registrar signing attestation authorization vouchers (CP-1, #1271).
    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    function _voucher(address attester, uint256 tokenId) internal view returns (bytes memory) {
        return AttestationVoucher.sign(address(cp), REGISTRAR_PK, attester, tokenId, AUTH_DEADLINE);
    }

    function setUp() public {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (admin, treasury, STAKE_AMOUNT));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cp = ContentProtection(address(proxy));
        usdc = new MockUSDC();

        // Register the voucher-signing registrar (CP-1, #1271).
        vm.prank(admin);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);

        vm.prank(admin);
        escrow = new RevenueEscrow(admin, ESCROW_PERIOD);

        vm.startPrank(admin);
        escrow.setContentProtection(address(cp));
        // The test contract is the revenue router in these unit tests.
        escrow.setDepositor(address(this), true);
        vm.stopPrank();
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

    function test_DepositWithAsset_USDC() public {
        usdc.mint(address(this), USDC_AMOUNT);
        usdc.approve(address(escrow), USDC_AMOUNT);

        vm.expectEmit(true, true, true, true);
        emit RevenueDepositedWithAsset(1, address(this), address(usdc), USDC_AMOUNT, USDC_AMOUNT);
        escrow.depositWithAsset(1, alice, address(usdc), USDC_AMOUNT);

        (address beneficiary, uint256 balance, uint256 escrowEndTime, bool frozen) =
            escrow.getEscrowAsset(1, address(usdc));
        assertEq(beneficiary, alice);
        assertEq(balance, USDC_AMOUNT);
        assertGt(escrowEndTime, block.timestamp);
        assertFalse(frozen);
        assertEq(usdc.balanceOf(address(escrow)), USDC_AMOUNT);

        address[] memory assets = escrow.getEscrowAssets(1);
        assertEq(assets.length, 1);
        assertEq(assets[0], address(usdc));
    }

    function test_Deposit_RevertZeroAmount() public {
        vm.expectRevert(IRevenueEscrow.ZeroAmount.selector);
        escrow.deposit{value: 0}(1, alice);
    }

    function test_Deposit_RevertZeroAddress() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(IRevenueEscrow.ZeroAddress.selector);
        escrow.deposit{value: 0.5 ether}(1, address(0));
    }

    // ── #1278: deposits are gated to authorized revenue routers ─────────────

    function test_Deposit_RevertUnauthorizedDepositor() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice); // not owner, not an authorized depositor
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedDepositor.selector, alice));
        escrow.deposit{value: 0.5 ether}(1, alice);
    }

    function test_DepositWithAsset_RevertUnauthorizedDepositor() public {
        usdc.mint(alice, USDC_AMOUNT);
        vm.startPrank(alice);
        usdc.approve(address(escrow), USDC_AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedDepositor.selector, alice));
        escrow.depositWithAsset(1, alice, address(usdc), USDC_AMOUNT);
        vm.stopPrank();
    }

    function test_SetDepositor_AuthorizesAndRevokes() public {
        // bob is not authorized initially.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedDepositor.selector, bob));
        escrow.deposit{value: 0.5 ether}(1, alice);

        // Owner authorizes bob → he can deposit.
        vm.prank(admin);
        escrow.setDepositor(bob, true);
        vm.prank(bob);
        escrow.deposit{value: 0.5 ether}(1, alice);
        (, uint256 balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0.5 ether);

        // Owner revokes bob → he can no longer deposit.
        vm.prank(admin);
        escrow.setDepositor(bob, false);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedDepositor.selector, bob));
        escrow.deposit{value: 0.5 ether}(2, alice);
    }

    function test_SetDepositor_RevertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        escrow.setDepositor(bob, true);
    }

    function test_Deposit_RevertBeneficiaryMismatch() public {
        vm.deal(address(this), 2 ether);
        escrow.deposit{value: 0.5 ether}(1, alice); // escrow bound to alice

        // A second deposit naming a different beneficiary is rejected, not silently
        // credited to the stored beneficiary.
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.BeneficiaryMismatch.selector, uint256(1), alice, bob));
        escrow.deposit{value: 0.5 ether}(1, bob);
    }

    function test_Deposit_FrontRunCapturePrevented() public {
        // An attacker cannot pre-create the escrow to capture the beneficiary —
        // deposits are gated to authorized routers.
        vm.deal(bob, 1 ether);
        vm.prank(bob); // attacker, unauthorized
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.UnauthorizedDepositor.selector, bob));
        escrow.deposit{value: 1}(1, bob);

        // The legitimate router then binds the intended beneficiary.
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        (address beneficiary,,,) = escrow.getEscrow(1);
        assertEq(beneficiary, alice);
    }

    /// @notice #1285 — depositing a fee-on-transfer token reverts instead of crediting
    /// the full amount while the escrow receives less.
    function test_DepositWithAsset_RevertFeeOnTransferToken() public {
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken(100); // 1% fee
        feeToken.mint(address(this), USDC_AMOUNT);
        feeToken.approve(address(escrow), USDC_AMOUNT);

        uint256 received = USDC_AMOUNT - (USDC_AMOUNT * 100) / 10_000;
        vm.expectRevert(
            abi.encodeWithSelector(IRevenueEscrow.FeeOnTransferNotSupported.selector, USDC_AMOUNT, received)
        );
        escrow.depositWithAsset(1, alice, address(feeToken), USDC_AMOUNT);
    }

    /// @notice #1287 — a reverting beneficiary cannot brick release; the payout is
    /// escrowed and the beneficiary reclaims it via claimFailedPayment.
    function test_Release_EscrowsOnRevertingBeneficiary() public {
        RevertingReceiver receiver = new RevertingReceiver();
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, address(receiver));

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        escrow.release(1); // does NOT revert — payout escrowed

        assertEq(escrow.failedPayments(address(0), address(receiver)), 0.5 ether, "payout escrowed");
        (, uint256 balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0, "escrow drained");
        assertEq(address(escrow).balance, 0.5 ether, "funds held for claim");

        // Beneficiary reclaims once it can accept ETH.
        receiver.setReject(false);
        uint256 before = address(receiver).balance;
        vm.prank(address(receiver));
        escrow.claimFailedPayment(address(0));
        assertEq(address(receiver).balance - before, 0.5 ether, "claimed");
        assertEq(escrow.failedPayments(address(0), address(receiver)), 0);
    }

    /// @notice #1279 — the per-token asset list is capped so the whole-token freeze
    /// loop stays bounded; a deposit past the cap reverts.
    function test_TrackEscrowAsset_CapEnforced() public {
        uint256 cap = escrow.MAX_ESCROW_ASSETS();

        // Asset #1: native.
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 1}(1, alice);

        // Fill the rest of the cap with distinct ERC20s.
        for (uint256 i = 0; i < cap - 1; i++) {
            MockUSDC t = new MockUSDC();
            t.mint(address(this), 1);
            t.approve(address(escrow), 1);
            escrow.depositWithAsset(1, alice, address(t), 1);
        }
        assertEq(escrow.getEscrowAssets(1).length, cap);

        // The next distinct asset exceeds the cap.
        MockUSDC extra = new MockUSDC();
        extra.mint(address(this), 1);
        extra.approve(address(escrow), 1);
        vm.expectRevert(abi.encodeWithSelector(IRevenueEscrow.TooManyEscrowAssets.selector, uint256(1)));
        escrow.depositWithAsset(1, alice, address(extra), 1);
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
        vm.expectRevert(IRevenueEscrow.NoEscrow.selector);
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
        _depositUsdc(1, alice, USDC_AMOUNT);

        vm.startPrank(admin);
        escrow.freeze(1);
        escrow.unfreeze(1);
        vm.stopPrank();

        (,,, bool frozen) = escrow.getEscrow(1);
        (,,, bool usdcFrozen) = escrow.getEscrowAsset(1, address(usdc));
        assertFalse(frozen);
        assertFalse(usdcFrozen);
    }

    function test_UnfreezeAsset_USDC() public {
        _depositUsdc(1, alice, USDC_AMOUNT);

        vm.startPrank(admin);
        escrow.freezeAsset(1, address(usdc));
        escrow.unfreezeAsset(1, address(usdc));
        vm.stopPrank();

        (,,, bool frozen) = escrow.getEscrowAsset(1, address(usdc));
        assertFalse(frozen);
    }

    function test_Unfreeze_RevertNotFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        vm.expectRevert(IRevenueEscrow.EscrowNotFrozen.selector);
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

    function test_ReleaseAsset_USDC() public {
        _depositUsdc(1, alice, USDC_AMOUNT);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit EscrowReleasedWithAsset(1, alice, address(usdc), USDC_AMOUNT);
        escrow.releaseAsset(1, address(usdc));

        assertEq(usdc.balanceOf(alice) - aliceBefore, USDC_AMOUNT);
        (, uint256 balance,,) = escrow.getEscrowAsset(1, address(usdc));
        assertEq(balance, 0);
    }

    function test_ReleaseAsset_USDCPreservesNativeEscrow() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);
        _depositUsdc(1, alice, USDC_AMOUNT);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        escrow.releaseAsset(1, address(usdc));

        (, uint256 nativeBalance,,) = escrow.getEscrow(1);
        (, uint256 usdcBalance,,) = escrow.getEscrowAsset(1, address(usdc));
        assertEq(nativeBalance, 0.5 ether);
        assertEq(usdcBalance, 0);
    }

    function test_Release_RevertFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        escrow.freeze(1);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);

        vm.expectRevert(IRevenueEscrow.EscrowIsFrozen.selector);
        escrow.release(1);
    }

    function test_Release_RevertNotExpired() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.expectRevert(IRevenueEscrow.EscrowNotExpired.selector);
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

    function test_RedirectAsset_USDC() public {
        _depositUsdc(1, alice, USDC_AMOUNT);

        vm.prank(admin);
        escrow.freezeAsset(1, address(usdc));

        uint256 rightfulBefore = usdc.balanceOf(rightfulOwner);
        vm.prank(admin);
        vm.expectEmit(true, true, true, true);
        emit EscrowRedirectedWithAsset(1, rightfulOwner, address(usdc), USDC_AMOUNT);
        escrow.redirectAsset(1, address(usdc), rightfulOwner);

        assertEq(usdc.balanceOf(rightfulOwner) - rightfulBefore, USDC_AMOUNT);
        (address beneficiary, uint256 balance,, bool frozen) = escrow.getEscrowAsset(1, address(usdc));
        assertEq(beneficiary, rightfulOwner);
        assertEq(balance, 0);
        assertFalse(frozen);
    }

    function test_Redirect_RevertNotFrozen() public {
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(1, alice);

        vm.prank(admin);
        vm.expectRevert(IRevenueEscrow.EscrowNotFrozen.selector);
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
        // Build vouchers before pranking: signing reads the domain via
        // cp.eip712Domain(), which would otherwise consume the prank.
        bytes memory sig10 = _voucher(alice, 10);
        bytes memory sig20 = _voucher(alice, 20);
        vm.prank(alice);
        cp.attest(10, keccak256("release"), keccak256("release-fp"), "release", AUTH_DEADLINE, sig10);
        vm.prank(alice);
        cp.attest(20, keccak256("track"), keccak256("track-fp"), "track", AUTH_DEADLINE, sig20);

        vm.startPrank(admin);
        cp.registerTrack(10, 20);
        cp.registerStem(20, 30);
        cp.registerStem(20, 31);
        cp.registerStem(20, 32);
        vm.stopPrank();

        vm.deal(address(this), 2 ether);
        escrow.deposit{value: 0.4 ether}(20, alice);
        escrow.deposit{value: 0.3 ether}(30, alice);
        _depositUsdc(20, alice, USDC_AMOUNT);

        vm.prank(admin);
        escrow.freezeByTrack(20);

        (,,, bool trackFrozen) = escrow.getEscrow(20);
        (,,, bool trackUsdcFrozen) = escrow.getEscrowAsset(20, address(usdc));
        (,,, bool stem30Frozen) = escrow.getEscrow(30);
        (,,, bool stem31Frozen) = escrow.getEscrow(31);
        (,,, bool stem32Frozen) = escrow.getEscrow(32);

        assertTrue(trackFrozen);
        assertTrue(trackUsdcFrozen);
        assertTrue(stem30Frozen);
        assertFalse(stem31Frozen);
        assertFalse(stem32Frozen);
    }

    function _depositUsdc(uint256 tokenId, address beneficiary, uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(escrow), amount);
        escrow.depositWithAsset(tokenId, beneficiary, address(usdc), amount);
    }
}
