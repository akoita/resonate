// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title ContentProtection self-claim unit tests (#1759)
 * @notice Attester-callable stake refund: per-stake escrow deadline, dispute lock with
 *         the 180-day fail-safe, blacklist and pause gates, the owner backfill for
 *         pre-V7 stakes, the lock authority, and the V6 -> V7 upgrade path.
 */
contract ContentProtectionClaimTest is Test, IContentProtectionEvents {
    ContentProtection internal cp;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal reporter = makeAddr("reporter");
    address internal upgradeAuthority = makeAddr("upgradeAuthority");
    address internal disputeContract = makeAddr("disputeResolution");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant USDC_STAKE_AMOUNT = 10_000000;
    uint256 internal constant DEFAULT_ESCROW = 30 days; // longest default tier ("new")
    uint256 internal constant FAIL_SAFE = 180 days;

    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    // Linear storage slots appended by V7 (see storage-layout/ContentProtection.json).
    uint256 internal constant CLAIMABLE_AT_SLOT = 22;
    uint256 internal constant STAKE_LOCKED_SLOT = 23;
    uint256 internal constant LOCK_AUTHORITY_SLOT = 24;
    bytes32 internal constant INITIALIZABLE_STORAGE =
        0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    function setUp() public {
        vm.warp(1_700_000_000);
        cp = _deployProxy();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    function _deployProxy() internal returns (ContentProtection proxy) {
        ContentProtection impl = new ContentProtection();
        bytes memory initData =
            abi.encodeCall(ContentProtection.initializeFresh, (admin, treasury, STAKE_AMOUNT, upgradeAuthority));
        proxy = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));
        vm.prank(admin);
        proxy.setRegistrar(vm.addr(REGISTRAR_PK), true);
    }

    function _attest(ContentProtection target, address who, uint256 tokenId) internal {
        bytes memory sig = AttestationVoucher.sign(address(target), REGISTRAR_PK, who, tokenId, AUTH_DEADLINE);
        vm.prank(who);
        target.attest(tokenId, keccak256("content"), keccak256("fingerprint"), "ipfs://meta", AUTH_DEADLINE, sig);
    }

    function _stakeNative(ContentProtection target, address who, uint256 tokenId) internal {
        _attest(target, who, tokenId);
        vm.deal(who, STAKE_AMOUNT);
        vm.prank(who);
        target.stake{value: STAKE_AMOUNT}(tokenId);
    }

    function _configureUsdc(ContentProtection target) internal returns (MockUSDC usdc) {
        usdc = new MockUSDC();
        PaymentAssetRegistry registry = new PaymentAssetRegistry(admin);
        vm.startPrank(admin);
        registry.configureAsset(keccak256("local:eth"), address(0), "ETH", 18, true, false);
        registry.configureAsset(keccak256("local:usdc"), address(usdc), "USDC", 6, true, true);
        target.setPaymentAssetRegistry(address(registry));
        target.setStakeAmountForAsset(address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();
    }

    function _stakeUsdc(ContentProtection target, MockUSDC usdc, address who, uint256 tokenId) internal {
        _attest(target, who, tokenId);
        usdc.mint(who, USDC_STAKE_AMOUNT);
        vm.startPrank(who);
        usdc.approve(address(target), USDC_STAKE_AMOUNT);
        target.stakeWithAsset(tokenId, address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();
    }

    function _lock(uint256 tokenId) internal {
        vm.prank(admin);
        cp.setStakeLock(tokenId, true);
    }

    function _claimableAtSlot(uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encode(tokenId, CLAIMABLE_AT_SLOT));
    }

    // ── deadline recording ───────────────────────────────────────────────

    function test_Stake_RecordsDeadlineFromLongestTierEscrow() public {
        _attest(cp, alice, 1);
        vm.deal(alice, STAKE_AMOUNT);
        vm.expectEmit(true, false, false, true);
        emit StakeEscrowRecorded(1, block.timestamp + DEFAULT_ESCROW);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        assertEq(cp.stakeClaimableAt(1), block.timestamp + DEFAULT_ESCROW);
        assertEq(cp.escrowSeconds(1), DEFAULT_ESCROW);
    }

    function test_Stake_UsesWhicheverTierEscrowIsLongest() public {
        vm.prank(admin);
        cp.setTierPolicy("trusted", STAKE_AMOUNT / 10, 45);
        _stakeNative(cp, alice, 1);
        assertEq(cp.escrowSeconds(1), 45 days, "a longer non-default tier wins");
    }

    function test_TierPolicyChange_DoesNotMoveAnExistingDeadline() public {
        _stakeNative(cp, alice, 1);
        uint256 recorded = cp.stakeClaimableAt(1);

        vm.startPrank(admin);
        cp.setTierPolicy("new", STAKE_AMOUNT, 1);
        cp.setTierPolicy("established", STAKE_AMOUNT / 2, 1);
        cp.setTierPolicy("trusted", STAKE_AMOUNT / 10, 1);
        cp.setTierPolicy("verified", 0, 1);
        vm.stopPrank();

        assertEq(cp.stakeClaimableAt(1), recorded, "deadline is a per-stake snapshot");
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeEscrowActive.selector, 1, recorded));
        cp.claimStakeRefund(1);
    }

    // ── happy paths ──────────────────────────────────────────────────────

    function test_Claim_NativeAfterEscrow() public {
        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1));

        (,,, bool claimable) = cp.getStakeClaimState(1);
        assertTrue(claimable);

        uint256 before = alice.balance;
        vm.expectEmit(true, true, true, true);
        emit StakeRefundClaimed(1, alice, address(0), STAKE_AMOUNT);
        vm.prank(alice);
        cp.claimStakeRefund(1);

        assertEq(alice.balance - before, STAKE_AMOUNT);
        assertEq(address(cp).balance, 0);
        assertFalse(cp.isStaked(1));
        assertTrue(cp.isAttested(1), "a claim does not revoke the attestation");
        (,,, claimable) = cp.getStakeClaimState(1);
        assertFalse(claimable);
    }

    function test_Claim_ERC20PaysBackInTheStakeAsset() public {
        MockUSDC usdc = _configureUsdc(cp);
        _stakeUsdc(cp, usdc, alice, 7);
        vm.warp(cp.stakeClaimableAt(7));

        vm.expectEmit(true, true, true, true);
        emit StakeRefundClaimed(7, alice, address(usdc), USDC_STAKE_AMOUNT);
        vm.prank(alice);
        cp.claimStakeRefund(7);

        assertEq(usdc.balanceOf(alice), USDC_STAKE_AMOUNT);
        assertEq(usdc.balanceOf(address(cp)), 0);
        assertFalse(cp.isStaked(7));
    }

    function test_Claim_EscrowsPayoutForARejectingAttester() public {
        RevertingReceiver wallet = new RevertingReceiver();
        _stakeNative(cp, address(wallet), 3);
        vm.warp(cp.stakeClaimableAt(3));

        vm.prank(address(wallet));
        cp.claimStakeRefund(3);

        assertFalse(cp.isStaked(3));
        assertEq(cp.failedPayments(address(0), address(wallet)), STAKE_AMOUNT, "push failed, escrowed");

        wallet.setReject(false);
        vm.prank(address(wallet));
        cp.claimFailedPayment(address(0));
        assertEq(address(wallet).balance, STAKE_AMOUNT);
    }

    function test_Claim_RestakeAfterClaimRecordsANewDeadline() public {
        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1));
        vm.prank(alice);
        cp.claimStakeRefund(1);

        vm.warp(block.timestamp + 5 days);
        vm.deal(alice, STAKE_AMOUNT);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);
        assertEq(cp.stakeClaimableAt(1), block.timestamp + DEFAULT_ESCROW);
    }

    // ── gates ────────────────────────────────────────────────────────────

    function test_Claim_RevertsUntilTheExactDeadline() public {
        _stakeNative(cp, alice, 1);
        uint256 claimableAt = cp.stakeClaimableAt(1);

        vm.warp(claimableAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeEscrowActive.selector, 1, claimableAt));
        cp.claimStakeRefund(1);

        vm.warp(claimableAt);
        vm.prank(alice);
        cp.claimStakeRefund(1);
        assertFalse(cp.isStaked(1));
    }

    function test_Claim_RevertsForAnyoneButTheAttester() public {
        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NotStakeAttester.selector, 1, bob));
        cp.claimStakeRefund(1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(NotStakeAttester.selector, 1, admin));
        cp.claimStakeRefund(1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NotStakeAttester.selector, 99, bob));
        cp.claimStakeRefund(99);
    }

    function test_Claim_RevertsForABlacklistedAttester() public {
        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1) + FAIL_SAFE);
        vm.prank(admin);
        cp.blacklist(alice);

        (,,, bool claimable) = cp.getStakeClaimState(1);
        assertFalse(claimable);
        vm.prank(alice);
        vm.expectRevert(IsBlacklisted.selector);
        cp.claimStakeRefund(1);
    }

    function test_Claim_RevertsWithoutAnActiveStake() public {
        _attest(cp, alice, 2);
        vm.prank(alice);
        vm.expectRevert(NotStaked.selector);
        cp.claimStakeRefund(2);

        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1));
        vm.startPrank(alice);
        cp.claimStakeRefund(1);
        vm.expectRevert(NotStaked.selector);
        cp.claimStakeRefund(1);
        vm.stopPrank();
    }

    function test_Claim_RevertsAfterOwnerRefundOrSlash() public {
        _stakeNative(cp, alice, 1);
        _stakeNative(cp, bob, 2);
        vm.warp(cp.stakeClaimableAt(1));

        vm.startPrank(admin);
        cp.refundStake(1);
        cp.slash(2, reporter);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(NotStaked.selector);
        cp.claimStakeRefund(1);
        vm.prank(bob);
        vm.expectRevert(IsBlacklisted.selector); // the slash blacklisted bob
        cp.claimStakeRefund(2);
    }

    function test_Claim_RevertsWhilePaused() public {
        _stakeNative(cp, alice, 1);
        vm.warp(cp.stakeClaimableAt(1));
        vm.prank(admin);
        cp.setPaused(true);

        (,,, bool claimable) = cp.getStakeClaimState(1);
        assertFalse(claimable);
        vm.prank(alice);
        vm.expectRevert(Paused.selector);
        cp.claimStakeRefund(1);
    }

    function test_Claim_RevertsForAnUnrecordedPreV7Stake() public {
        _stakeNative(cp, alice, 1);
        vm.store(address(cp), _claimableAtSlot(1), bytes32(0));
        vm.warp(block.timestamp + 365 days);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeEscrowNotRecorded.selector, 1));
        cp.claimStakeRefund(1);
        (uint256 claimableAt, uint256 failSafeAt,, bool claimable) = cp.getStakeClaimState(1);
        assertEq(claimableAt, 0);
        assertEq(failSafeAt, 0);
        assertFalse(claimable);
        assertEq(cp.escrowSeconds(1), 0);
    }

    // ── dispute lock and fail-safe ───────────────────────────────────────

    function test_Lock_BlocksTheClaimUntilTheFailSafe() public {
        _stakeNative(cp, alice, 1);
        _lock(1);
        uint256 failSafeAt = cp.stakeClaimableAt(1) + FAIL_SAFE;

        vm.warp(cp.stakeClaimableAt(1));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeLockActive.selector, 1, failSafeAt));
        cp.claimStakeRefund(1);

        vm.warp(failSafeAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeLockActive.selector, 1, failSafeAt));
        cp.claimStakeRefund(1);

        vm.warp(failSafeAt);
        (,, bool locked, bool claimable) = cp.getStakeClaimState(1);
        assertTrue(locked);
        assertTrue(claimable, "the fail-safe opens the claim while still locked");
        vm.prank(alice);
        cp.claimStakeRefund(1);
        assertFalse(cp.isStaked(1));
    }

    function test_Lock_EscrowGateStillAppliesBeforeTheDeadline() public {
        _stakeNative(cp, alice, 1);
        _lock(1);
        uint256 claimableAt = cp.stakeClaimableAt(1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeEscrowActive.selector, 1, claimableAt));
        cp.claimStakeRefund(1);
    }

    function test_Lock_ClearedLockReopensTheClaim() public {
        _stakeNative(cp, alice, 1);
        _lock(1);
        vm.warp(cp.stakeClaimableAt(1));
        vm.prank(admin);
        cp.setStakeLock(1, false);

        vm.prank(alice);
        cp.claimStakeRefund(1);
        assertFalse(cp.isStaked(1));
    }

    function test_Lock_SlashAndOwnerRefundStillWorkOnALockedStake() public {
        _stakeNative(cp, alice, 1);
        _stakeNative(cp, bob, 2);
        _lock(1);
        _lock(2);

        vm.startPrank(admin);
        cp.slash(1, reporter);
        cp.refundStake(2);
        vm.stopPrank();

        assertFalse(cp.isStaked(1));
        assertFalse(cp.isStaked(2));
        assertEq(reporter.balance, (STAKE_AMOUNT * 6000) / 10000);
        assertEq(bob.balance, STAKE_AMOUNT);
    }

    function test_SetStakeLock_OwnerOrAuthorityOnly() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NotStakeLockAuthority.selector, bob));
        cp.setStakeLock(1, true);

        vm.prank(disputeContract);
        vm.expectRevert(abi.encodeWithSelector(NotStakeLockAuthority.selector, disputeContract));
        cp.setStakeLock(1, true);

        vm.expectEmit(true, true, false, true);
        emit StakeLockAuthorityUpdated(address(0), disputeContract);
        vm.prank(admin);
        cp.setStakeLockAuthority(disputeContract);

        vm.expectEmit(true, true, false, true);
        emit StakeLockUpdated(1, true, disputeContract);
        vm.prank(disputeContract);
        cp.setStakeLock(1, true);
        assertTrue(cp.stakeLocked(1));

        vm.prank(admin);
        cp.setStakeLock(1, false);
        assertFalse(cp.stakeLocked(1));

        vm.prank(admin);
        cp.setStakeLockAuthority(address(0));
        vm.prank(disputeContract);
        vm.expectRevert(abi.encodeWithSelector(NotStakeLockAuthority.selector, disputeContract));
        cp.setStakeLock(1, true);
    }

    function test_SetStakeLockAuthority_OnlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(NotOwner.selector);
        cp.setStakeLockAuthority(bob);
    }

    function test_SetStakeLock_AvailableWhilePaused() public {
        vm.startPrank(admin);
        cp.setStakeLockAuthority(disputeContract);
        cp.setPaused(true);
        vm.stopPrank();

        vm.prank(disputeContract);
        cp.setStakeLock(1, true);
        assertTrue(cp.stakeLocked(1), "a dispute can hold a stake during an incident");
        vm.prank(disputeContract);
        cp.setStakeLock(1, false);
        assertFalse(cp.stakeLocked(1));
    }

    // ── backfill ─────────────────────────────────────────────────────────

    function test_Backfill_RecordsPreV7StakesFromTheirDepositTime() public {
        _stakeNative(cp, alice, 1);
        (, uint256 depositedAt,) = cp.stakes(1);
        vm.store(address(cp), _claimableAtSlot(1), bytes32(0));
        vm.warp(block.timestamp + 10 days);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.expectEmit(true, false, false, true);
        emit StakeEscrowRecorded(1, depositedAt + DEFAULT_ESCROW);
        vm.prank(admin);
        uint256 recorded = cp.backfillStakeEscrow(ids);

        assertEq(recorded, 1);
        assertEq(cp.stakeClaimableAt(1), depositedAt + DEFAULT_ESCROW, "anchored on deposit, not on backfill");
    }

    function test_Backfill_IsIdempotentAndNeverMovesARecordedDeadline() public {
        _stakeNative(cp, alice, 1); // recorded at stake time
        _stakeNative(cp, alice, 2);
        vm.store(address(cp), _claimableAtSlot(2), bytes32(0)); // legacy
        _attest(cp, alice, 3); // attested, never staked
        _stakeNative(cp, bob, 4);
        vm.prank(admin);
        cp.refundStake(4); // inactive

        uint256 recordedBefore = cp.stakeClaimableAt(1);
        vm.prank(admin);
        cp.setTierPolicy("new", STAKE_AMOUNT, 90); // a longer policy must not touch stake 1

        uint256[] memory ids = new uint256[](5);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        ids[3] = 4;
        ids[4] = 2; // duplicate
        vm.prank(admin);
        assertEq(cp.backfillStakeEscrow(ids), 1, "only the legacy active stake is recorded");

        assertEq(cp.stakeClaimableAt(1), recordedBefore);
        (, uint256 depositedAt2,) = cp.stakes(2);
        assertEq(cp.stakeClaimableAt(2), depositedAt2 + 90 days);
        assertEq(cp.stakeClaimableAt(3), 0);

        vm.prank(admin);
        assertEq(cp.backfillStakeEscrow(ids), 0, "second run changes nothing");
    }

    function test_Backfill_OnlyOwnerAndAvailableWhilePaused() public {
        uint256[] memory ids = new uint256[](0);
        vm.prank(bob);
        vm.expectRevert(NotOwner.selector);
        cp.backfillStakeEscrow(ids);

        _stakeNative(cp, alice, 1);
        vm.store(address(cp), _claimableAtSlot(1), bytes32(0));
        vm.prank(admin);
        cp.setPaused(true);
        ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(admin);
        assertEq(cp.backfillStakeEscrow(ids), 1);
    }

    // ── V7 upgrade ───────────────────────────────────────────────────────

    function test_InitializeFresh_ConsumesV7() public {
        vm.expectRevert();
        cp.reinitializeV7();
    }

    /// Simulates the deployed V6 proxy: initialized version 6, stakes deposited with no
    /// recorded deadline (the V7 slots were part of `__gap`, which is always zero), then
    /// upgrades through the upgrade authority with the atomic V7 reinitializer, backfills
    /// and claims on both asset paths with the deadline anchored on the original deposit.
    function test_UpgradeFromV6_BackfillThenClaimWithTheRightDeadline() public {
        ContentProtection legacy = _deployProxy();
        MockUSDC usdc = _configureUsdc(legacy);
        _stakeNative(legacy, alice, 1);
        vm.warp(block.timestamp + 3 days);
        _stakeUsdc(legacy, usdc, bob, 2);
        (, uint256 depositedAt1,) = legacy.stakes(1);
        (, uint256 depositedAt2,) = legacy.stakes(2);

        vm.store(address(legacy), INITIALIZABLE_STORAGE, bytes32(uint256(6)));
        vm.store(address(legacy), _claimableAtSlot(1), bytes32(0));
        vm.store(address(legacy), _claimableAtSlot(2), bytes32(0));
        for (uint256 slot = CLAIMABLE_AT_SLOT; slot <= LOCK_AUTHORITY_SLOT; ++slot) {
            assertEq(vm.load(address(legacy), bytes32(slot)), bytes32(0), "V7 slots start empty");
        }

        ContentProtection newImpl = new ContentProtection();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, admin));
        legacy.upgradeToAndCall(address(newImpl), abi.encodeCall(ContentProtection.reinitializeV7, ()));
        vm.prank(upgradeAuthority);
        legacy.upgradeToAndCall(address(newImpl), abi.encodeCall(ContentProtection.reinitializeV7, ()));

        vm.expectRevert();
        legacy.reinitializeV7();

        // Pre-existing state survives the upgrade.
        assertEq(legacy.owner(), admin);
        assertEq(legacy.upgradeAuthority(), upgradeAuthority);
        assertTrue(legacy.isStaked(1));
        assertTrue(legacy.isStaked(2));

        // Before the backfill a legacy stake is not claimable early — nor at all.
        vm.warp(depositedAt2 + DEFAULT_ESCROW);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StakeEscrowNotRecorded.selector, 1));
        legacy.claimStakeRefund(1);

        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 999;
        vm.prank(admin);
        assertEq(legacy.backfillStakeEscrow(ids), 2);
        assertEq(legacy.stakeClaimableAt(1), depositedAt1 + DEFAULT_ESCROW);
        assertEq(legacy.stakeClaimableAt(2), depositedAt2 + DEFAULT_ESCROW);

        // The lock state lands in the expected appended slots.
        vm.prank(admin);
        legacy.setStakeLockAuthority(disputeContract);
        assertEq(vm.load(address(legacy), bytes32(LOCK_AUTHORITY_SLOT)), bytes32(uint256(uint160(disputeContract))));
        vm.prank(admin);
        legacy.setStakeLock(2, true);
        assertEq(
            vm.load(address(legacy), keccak256(abi.encode(uint256(2), STAKE_LOCKED_SLOT))), bytes32(uint256(1))
        );

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        legacy.claimStakeRefund(1);
        assertEq(alice.balance - aliceBefore, STAKE_AMOUNT);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(StakeLockActive.selector, 2, depositedAt2 + DEFAULT_ESCROW + FAIL_SAFE)
        );
        legacy.claimStakeRefund(2);
        vm.prank(admin);
        legacy.setStakeLock(2, false);
        vm.prank(bob);
        legacy.claimStakeRefund(2);
        assertEq(usdc.balanceOf(bob), USDC_STAKE_AMOUNT);
        assertEq(usdc.balanceOf(address(legacy)), 0);
    }
}
