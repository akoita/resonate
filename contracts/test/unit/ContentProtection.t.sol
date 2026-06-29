// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {MockFeeOnTransferToken} from "../mocks/MockFeeOnTransferToken.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ContentProtection Unit Tests
 * @notice Tests attestation, staking, slashing, blacklisting, and UUPS upgradability
 */
contract ContentProtectionTest is Test {
    ContentProtection public cp;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public registrar = makeAddr("registrar");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public reporter = makeAddr("reporter");

    uint256 constant STAKE_AMOUNT = 0.01 ether;
    uint256 constant USDC_STAKE_AMOUNT = 10_000000;
    bytes32 constant LOCAL_ETH = keccak256("local:eth");
    bytes32 constant LOCAL_USDC = keccak256("local:usdc");

    event ContentAttested(
        uint256 indexed tokenId,
        address indexed attester,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string metadataURI
    );
    event StakeDeposited(uint256 indexed tokenId, address indexed staker, uint256 amount);
    event StakeDepositedWithAsset(
        uint256 indexed tokenId, address indexed staker, address indexed token, uint256 amount
    );
    event StakeSlashed(
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );
    event StakeRefunded(uint256 indexed tokenId, address indexed staker, uint256 amount);
    event StakeRefundedWithAsset(
        uint256 indexed tokenId, address indexed staker, address indexed token, uint256 amount
    );
    event Blacklisted(address indexed account);
    event BlacklistRemoved(address indexed account);
    event RegistrarUpdated(address indexed registrar, bool allowed);
    event MaxPriceMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier);
    event TierPolicyUpdated(
        string tierName,
        uint256 oldStakeAmountWei,
        uint256 oldEscrowDays,
        uint256 newStakeAmountWei,
        uint256 newEscrowDays
    );
    event TrackRegistered(uint256 indexed releaseId, uint256 indexed trackId);
    event StemRegistered(uint256 indexed trackId, uint256 indexed stemTokenId);
    event StemProtectionRootRegistered(uint256 indexed releaseId, uint256 indexed stemTokenId);
    event TrackRevoked(uint256 indexed trackId);
    event ReleaseRevoked(uint256 indexed releaseId);

    function setUp() public {
        // Deploy implementation + proxy
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (admin, treasury, STAKE_AMOUNT));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cp = ContentProtection(address(proxy));
    }

    // ============ Initialization ============

    function test_Initialize() public view {
        assertEq(cp.owner(), admin);
        assertEq(cp.treasury(), treasury);
        assertEq(cp.stakeAmount(), STAKE_AMOUNT);
        assertEq(cp.maxPriceMultiplier(), 10);
    }

    function test_Initialize_SeedsTierPolicies() public view {
        (uint256 newStake, uint256 newEscrowDays) = cp.getTierPolicy("new");
        (uint256 establishedStake, uint256 establishedEscrowDays) = cp.getTierPolicy("established");
        (uint256 trustedStake, uint256 trustedEscrowDays) = cp.getTierPolicy("trusted");
        (uint256 verifiedStake, uint256 verifiedEscrowDays) = cp.getTierPolicy("verified");

        assertEq(newStake, STAKE_AMOUNT);
        assertEq(newEscrowDays, 30);
        assertEq(establishedStake, STAKE_AMOUNT / 2);
        assertEq(establishedEscrowDays, 14);
        assertEq(trustedStake, STAKE_AMOUNT / 10);
        assertEq(trustedEscrowDays, 7);
        assertEq(verifiedStake, 0);
        assertEq(verifiedEscrowDays, 3);
    }

    function test_Initialize_RevertDoubleInit() public {
        vm.expectRevert();
        cp.initialize(admin, treasury, STAKE_AMOUNT);
    }

    // ============ Attestation ============

    function test_Attest() public {
        bytes32 contentHash = keccak256("audio_content");
        bytes32 fpHash = keccak256("fingerprint");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ContentAttested(1, alice, contentHash, fpHash, "ipfs://meta");
        cp.attest(1, contentHash, fpHash, "ipfs://meta");

        assertTrue(cp.isAttested(1));
    }

    function test_AttestRelease() public {
        bytes32 contentHash = keccak256("release_audio_content");
        bytes32 fpHash = keccak256("release_fingerprint");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ContentAttested(100, alice, contentHash, fpHash, "ipfs://release-meta");
        cp.attestRelease(100, contentHash, fpHash, "ipfs://release-meta");

        assertTrue(cp.isAttested(100));
        assertTrue(cp.isReleaseVerified(100));
    }

    function test_Attest_RevertAlreadyAttested() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        vm.prank(bob);
        vm.expectRevert(ContentProtection.AlreadyAttested.selector);
        cp.attest(1, keccak256("c"), keccak256("d"), "uri2");
    }

    function test_Attest_RevertBlacklisted() public {
        vm.prank(admin);
        cp.blacklist(alice);

        vm.prank(alice);
        vm.expectRevert(ContentProtection.IsBlacklisted.selector);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
    }

    // ============ Staking ============

    function test_Stake() public {
        // Attest first
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        // Stake
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit StakeDeposited(1, alice, STAKE_AMOUNT);
        cp.stake{value: STAKE_AMOUNT}(1);

        assertTrue(cp.isStaked(1));
    }

    function test_StakeForRelease() public {
        vm.prank(alice);
        cp.attestRelease(100, keccak256("release"), keccak256("release-fp"), "release-uri");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit StakeDeposited(100, alice, STAKE_AMOUNT);
        cp.stakeForRelease{value: STAKE_AMOUNT}(100);

        assertTrue(cp.isStaked(100));
    }

    function test_StakeWithAsset_USDC() public {
        MockUSDC usdc = _configureUsdcStakeAsset();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        usdc.mint(alice, USDC_STAKE_AMOUNT);
        vm.startPrank(alice);
        usdc.approve(address(cp), USDC_STAKE_AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit StakeDepositedWithAsset(1, alice, address(usdc), USDC_STAKE_AMOUNT);
        cp.stakeWithAsset(1, address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();

        (address token, uint256 amount, bool active) = cp.getStakeAsset(1);
        assertTrue(active);
        assertEq(token, address(usdc));
        assertEq(amount, USDC_STAKE_AMOUNT);
        assertEq(usdc.balanceOf(address(cp)), USDC_STAKE_AMOUNT);
    }

    function test_StakeForReleaseWithAsset_USDC() public {
        MockUSDC usdc = _configureUsdcStakeAsset();

        vm.prank(alice);
        cp.attestRelease(100, keccak256("release"), keccak256("release-fp"), "release-uri");

        usdc.mint(alice, USDC_STAKE_AMOUNT);
        vm.startPrank(alice);
        usdc.approve(address(cp), USDC_STAKE_AMOUNT);
        cp.stakeForReleaseWithAsset(100, address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();

        assertTrue(cp.isStaked(100));
        (address token, uint256 amount, bool active) = cp.getStakeAsset(100);
        assertTrue(active);
        assertEq(token, address(usdc));
        assertEq(amount, USDC_STAKE_AMOUNT);
    }

    // ── #1280: stake records the canonical required amount, not the overpayment ──

    function test_Stake_RecordsRequiredAndRefundsNativeSurplus() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        uint256 overpay = STAKE_AMOUNT + 0.05 ether;
        vm.deal(alice, overpay);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit StakeDeposited(1, alice, STAKE_AMOUNT); // records required, not msg.value
        cp.stake{value: overpay}(1);

        (uint256 amount,, bool active) = cp.stakes(1);
        assertTrue(active);
        assertEq(amount, STAKE_AMOUNT, "records required, not msg.value");
        assertEq(alice.balance, 0.05 ether, "surplus refunded to staker");
        assertEq(address(cp).balance, STAKE_AMOUNT, "contract holds only the required stake");
    }

    function test_StakeWithAsset_RecordsRequiredNotExcess() public {
        MockUSDC usdc = _configureUsdcStakeAsset();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        uint256 overpay = USDC_STAKE_AMOUNT * 3;
        usdc.mint(alice, overpay);
        vm.startPrank(alice);
        usdc.approve(address(cp), overpay);
        vm.expectEmit(true, true, true, true);
        emit StakeDepositedWithAsset(1, alice, address(usdc), USDC_STAKE_AMOUNT);
        cp.stakeWithAsset(1, address(usdc), overpay);
        vm.stopPrank();

        (, uint256 amount, bool active) = cp.getStakeAsset(1);
        assertTrue(active);
        assertEq(amount, USDC_STAKE_AMOUNT, "records required, not the passed amount");
        assertEq(usdc.balanceOf(address(cp)), USDC_STAKE_AMOUNT, "pulls only the required stake");
        assertEq(usdc.balanceOf(alice), overpay - USDC_STAKE_AMOUNT, "excess stays with the staker");
    }

    function test_Slash_OnOverpaidStakeUsesRequiredNotOverpayment() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT + 0.5 ether}(1); // large overpayment, refunded

        // Slash distributes 60/30/10 of the *required* stake only — overpayment
        // can no longer inflate the punishment.
        vm.prank(admin);
        cp.slash(1, reporter);
        assertEq(reporter.balance, (STAKE_AMOUNT * 6000) / 10000, "reporter gets 60% of required");
        assertEq(treasury.balance, (STAKE_AMOUNT * 3000) / 10000, "treasury gets 30% of required");
    }

    /// @notice #1285 — staking a fee-on-transfer token reverts instead of recording a
    /// stake the contract never fully received.
    function test_StakeWithAsset_RevertFeeOnTransferToken() public {
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken(100); // 1% fee
        PaymentAssetRegistry registry = new PaymentAssetRegistry(admin);
        vm.startPrank(admin);
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        registry.configureAsset(keccak256("local:fee"), address(feeToken), "FEE", 18, true, true);
        cp.setPaymentAssetRegistry(address(registry));
        cp.setStakeAmountForAsset(address(feeToken), USDC_STAKE_AMOUNT);
        vm.stopPrank();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        feeToken.mint(alice, USDC_STAKE_AMOUNT * 2);
        vm.startPrank(alice);
        feeToken.approve(address(cp), type(uint256).max);
        uint256 received = USDC_STAKE_AMOUNT - (USDC_STAKE_AMOUNT * 100) / 10_000;
        vm.expectRevert(
            abi.encodeWithSelector(ContentProtection.FeeOnTransferNotSupported.selector, USDC_STAKE_AMOUNT, received)
        );
        cp.stakeWithAsset(1, address(feeToken), USDC_STAKE_AMOUNT);
        vm.stopPrank();
    }

    /// @notice #1287 — a reverting reporter cannot brick a slash; the reporter's share
    /// is escrowed and reclaimed via claimFailedPayment (treasury is paid normally).
    function test_Slash_EscrowsOnRevertingReporter() public {
        RevertingReceiver receiver = new RevertingReceiver();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        vm.prank(admin);
        cp.slash(1, address(receiver)); // reporter rejects ETH → escrowed, no revert

        uint256 reporterShare = (STAKE_AMOUNT * 6000) / 10000;
        assertEq(cp.failedPayments(address(0), address(receiver)), reporterShare, "reporter share escrowed");
        assertEq(treasury.balance, (STAKE_AMOUNT * 3000) / 10000, "treasury paid normally");

        receiver.setReject(false);
        uint256 before = address(receiver).balance;
        vm.prank(address(receiver));
        cp.claimFailedPayment(address(0));
        assertEq(address(receiver).balance - before, reporterShare, "claimed");
    }

    function test_Stake_RevertNotAttested() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ContentProtection.NotAttested.selector);
        cp.stake{value: STAKE_AMOUNT}(1);
    }

    function test_Stake_RevertInsufficientAmount() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ContentProtection.InsufficientStake.selector);
        cp.stake{value: STAKE_AMOUNT - 1}(1);
    }

    function test_Stake_RevertNotAttester() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(ContentProtection.NotOwner.selector);
        cp.stake{value: STAKE_AMOUNT}(1);
    }

    // ============ Slashing ============

    function test_Slash() public {
        // Setup: attest + stake
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        uint256 reporterBefore = reporter.balance;
        uint256 treasuryBefore = treasury.balance;

        // Slash
        vm.prank(admin);
        cp.slash(1, reporter);

        // Verify split: 60% reporter, 30% treasury, 10% burned
        uint256 expectedReporter = (STAKE_AMOUNT * 6000) / 10000;
        uint256 expectedTreasury = (STAKE_AMOUNT * 3000) / 10000;

        assertEq(reporter.balance - reporterBefore, expectedReporter);
        assertEq(treasury.balance - treasuryBefore, expectedTreasury);
        assertFalse(cp.isStaked(1));
        assertFalse(cp.isAttested(1));
        assertTrue(cp.isBlacklisted(alice)); // Auto-blacklisted
    }

    function test_Slash_USDCStake() public {
        MockUSDC usdc = _configureUsdcStakeAsset();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        usdc.mint(alice, USDC_STAKE_AMOUNT);
        vm.startPrank(alice);
        usdc.approve(address(cp), USDC_STAKE_AMOUNT);
        cp.stakeWithAsset(1, address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();

        uint256 expectedReporter = (USDC_STAKE_AMOUNT * 6000) / 10000;
        uint256 expectedTreasury = (USDC_STAKE_AMOUNT * 3000) / 10000;

        vm.prank(admin);
        cp.slash(1, reporter);

        assertEq(usdc.balanceOf(reporter), expectedReporter);
        assertEq(usdc.balanceOf(treasury), expectedTreasury);
        assertEq(usdc.balanceOf(address(cp)), USDC_STAKE_AMOUNT - expectedReporter - expectedTreasury);
        assertFalse(cp.isStaked(1));
        assertFalse(cp.isAttested(1));
        assertTrue(cp.isBlacklisted(alice));
    }

    // ── #1282: the retained slash remainder is sweepable to the treasury ────

    function test_Slash_AccumulatesAndSweepsBurned() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        vm.prank(admin);
        cp.slash(1, reporter);

        uint256 burned = STAKE_AMOUNT - (STAKE_AMOUNT * 6000) / 10000 - (STAKE_AMOUNT * 3000) / 10000; // 10%
        assertEq(cp.totalBurned(address(0)), burned, "burn remainder tracked");
        assertEq(address(cp).balance, burned, "remainder retained in contract");

        uint256 treasuryBefore = treasury.balance;
        vm.prank(admin);
        cp.sweepBurned(address(0));
        assertEq(treasury.balance - treasuryBefore, burned, "swept to treasury");
        assertEq(cp.totalBurned(address(0)), 0, "cleared");
        assertEq(address(cp).balance, 0, "contract drained of the remainder");
    }

    function test_SweepBurned_RevertNothingToSweep() public {
        vm.prank(admin);
        vm.expectRevert(ContentProtection.NothingToClaim.selector);
        cp.sweepBurned(address(0));
    }

    function test_SweepBurned_RevertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(ContentProtection.NotOwner.selector);
        cp.sweepBurned(address(0));
    }

    function test_Slash_RevertNotOwner() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        vm.prank(bob); // Not admin
        vm.expectRevert(ContentProtection.NotOwner.selector);
        cp.slash(1, reporter);
    }

    // ============ Refund ============

    function test_RefundStake() public {
        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(1);

        uint256 aliceBefore = alice.balance;
        vm.prank(admin);
        cp.refundStake(1);

        assertEq(alice.balance - aliceBefore, STAKE_AMOUNT);
        assertFalse(cp.isStaked(1));
    }

    function test_RefundStake_USDCStake() public {
        MockUSDC usdc = _configureUsdcStakeAsset();

        vm.prank(alice);
        cp.attest(1, keccak256("a"), keccak256("b"), "uri");
        usdc.mint(alice, USDC_STAKE_AMOUNT);
        vm.startPrank(alice);
        usdc.approve(address(cp), USDC_STAKE_AMOUNT);
        cp.stakeWithAsset(1, address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectEmit(true, true, true, true);
        emit StakeRefundedWithAsset(1, alice, address(usdc), USDC_STAKE_AMOUNT);
        cp.refundStake(1);

        assertEq(usdc.balanceOf(alice), USDC_STAKE_AMOUNT);
        assertEq(usdc.balanceOf(address(cp)), 0);
        assertFalse(cp.isStaked(1));
    }

    // ============ Blacklist ============

    function test_Blacklist() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit Blacklisted(alice);
        cp.blacklist(alice);

        assertTrue(cp.isBlacklisted(alice));
    }

    function test_RemoveBlacklist() public {
        vm.prank(admin);
        cp.blacklist(alice);

        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit BlacklistRemoved(alice);
        cp.removeBlacklist(alice);

        assertFalse(cp.isBlacklisted(alice));
    }

    function test_Blacklist_RevertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ContentProtection.ZeroAddress.selector);
        cp.blacklist(address(0));
    }

    // ============ Admin ============

    function test_SetStakeAmount() public {
        vm.prank(admin);
        cp.setStakeAmount(0.05 ether);
        assertEq(cp.stakeAmount(), 0.05 ether);

        (uint256 newStake, uint256 newEscrowDays) = cp.getTierPolicy("new");
        (uint256 establishedStake, uint256 establishedEscrowDays) = cp.getTierPolicy("established");
        (uint256 trustedStake, uint256 trustedEscrowDays) = cp.getTierPolicy("trusted");

        assertEq(newStake, 0.05 ether);
        assertEq(newEscrowDays, 30);
        assertEq(establishedStake, 0.025 ether);
        assertEq(establishedEscrowDays, 14);
        assertEq(trustedStake, 0.005 ether);
        assertEq(trustedEscrowDays, 7);
    }

    function test_SetStakeAmount_PreservesCustomizedTierPolicy() public {
        vm.prank(admin);
        cp.setTierPolicy("new", 0.001 ether, 10);

        vm.prank(admin);
        cp.setStakeAmount(0.05 ether);

        (uint256 updatedStake, uint256 updatedEscrowDays) = cp.getTierPolicy("new");
        assertEq(updatedStake, 0.001 ether);
        assertEq(updatedEscrowDays, 10);
    }

    function test_SetTierPolicy() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit TierPolicyUpdated("new", STAKE_AMOUNT, 30, 0.001 ether, 10);
        cp.setTierPolicy("new", 0.001 ether, 10);

        (uint256 updatedStake, uint256 updatedEscrowDays) = cp.getTierPolicy("new");
        assertEq(updatedStake, 0.001 ether);
        assertEq(updatedEscrowDays, 10);
    }

    function test_SetTierPolicy_RevertInvalidTier() public {
        vm.prank(admin);
        vm.expectRevert(ContentProtection.InvalidTier.selector);
        cp.setTierPolicy("unknown", 1, 1);
    }

    function test_SetMaxPriceMultiplier() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit MaxPriceMultiplierUpdated(10, 12);
        cp.setMaxPriceMultiplier(12);

        assertEq(cp.maxPriceMultiplier(), 12);
    }

    function test_SetMaxPriceMultiplier_RevertZero() public {
        vm.prank(admin);
        vm.expectRevert(ContentProtection.InvalidMultiplier.selector);
        cp.setMaxPriceMultiplier(0);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(admin);
        cp.setTreasury(newTreasury);
        assertEq(cp.treasury(), newTreasury);
    }

    function test_TransferOwnership() public {
        vm.prank(admin);
        cp.transferOwnership(bob);
        assertEq(cp.owner(), bob);
    }

    function test_SetRegistrar() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit RegistrarUpdated(registrar, true);
        cp.setRegistrar(registrar, true);

        assertTrue(cp.registrars(registrar));
    }

    function test_RegisterTrack_ByRegistrar() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(admin);
        cp.setRegistrar(registrar, true);

        vm.prank(registrar);
        vm.expectEmit(true, true, false, false);
        emit TrackRegistered(100, 200);
        cp.registerTrack(100, 200);

        uint256[] memory trackIds = cp.getReleaseTracks(100);
        assertEq(trackIds.length, 1);
        assertEq(trackIds[0], 200);
        assertEq(cp.trackToParentRelease(200), 100);
    }

    function test_RegisterTrack_Idempotent() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(admin);
        cp.registerTrack(100, 200);

        vm.prank(admin);
        cp.registerTrack(100, 200);

        uint256[] memory trackIds = cp.getReleaseTracks(100);
        assertEq(trackIds.length, 1);
    }

    function test_RegisterTrack_RevertConflict() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(alice);
        cp.attest(101, keccak256("release2"), keccak256("fp2"), "release-2");

        vm.prank(admin);
        cp.registerTrack(100, 200);

        vm.prank(admin);
        vm.expectRevert(ContentProtection.RegistrationConflict.selector);
        cp.registerTrack(101, 200);
    }

    function test_RegisterTrack_RevertNotRegistrar() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(bob);
        vm.expectRevert(ContentProtection.NotRegistrar.selector);
        cp.registerTrack(100, 200);
    }

    function test_RegisterStem_ByRegistrar() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(admin);
        cp.setRegistrar(registrar, true);
        vm.prank(admin);
        cp.registerTrack(100, 200);

        vm.prank(registrar);
        vm.expectEmit(true, true, false, false);
        emit StemRegistered(200, 300);
        cp.registerStem(200, 300);

        uint256[] memory stemIds = cp.getTrackStems(200);
        assertEq(stemIds.length, 1);
        assertEq(stemIds[0], 300);
        assertEq(cp.stemToCanonicalTrack(300), 200);
    }

    function test_RegisterStemProtectionRoot_ByRegistrar() public {
        vm.prank(alice);
        cp.attestRelease(
            100,
            keccak256(abi.encodePacked("release", uint256(100))),
            keccak256(abi.encodePacked("release-fp", uint256(100))),
            "release"
        );

        vm.prank(admin);
        cp.setRegistrar(registrar, true);

        vm.prank(registrar);
        vm.expectEmit(true, true, false, false);
        emit StemProtectionRootRegistered(100, 300);
        cp.registerStemProtectionRoot(100, 300);

        assertEq(cp.stemToProtectionRoot(300), 100);
    }

    function test_VerificationHierarchy() public {
        _attestReleaseAndTrack(100, 200);

        vm.startPrank(admin);
        cp.registerTrack(100, 200);
        cp.registerStem(200, 300);
        vm.stopPrank();

        assertTrue(cp.isReleaseVerified(100));
        assertTrue(cp.isTrackVerified(200));
        assertTrue(cp.isStemVerified(300));
        assertEq(cp.resolveCanonicalTrack(300), 200);
        assertEq(cp.resolveProtectionTarget(300), 200);
        assertEq(cp.resolveProtectionTarget(200), 200);
    }

    function test_ResolveStakeRoot_ViaDirectStemRoot() public {
        vm.prank(alice);
        cp.attestRelease(
            100,
            keccak256(abi.encodePacked("release", uint256(100))),
            keccak256(abi.encodePacked("release-fp", uint256(100))),
            "release"
        );

        vm.prank(admin);
        cp.registerStemProtectionRoot(100, 300);

        assertEq(cp.resolveStakeRoot(300), 100);
    }

    function test_ResolveStakeRoot_ViaTrackHierarchy() public {
        _attestReleaseAndTrack(100, 200);

        vm.startPrank(admin);
        cp.registerTrack(100, 200);
        cp.registerStem(200, 300);
        vm.stopPrank();

        assertEq(cp.resolveStakeRoot(300), 100);
        assertEq(cp.resolveStakeRoot(200), 100);
        assertEq(cp.resolveStakeRoot(100), 100);
    }

    function test_GetMaxListingPrice_UsesReleaseStake() public {
        vm.prank(alice);
        cp.attestRelease(
            100,
            keccak256(abi.encodePacked("release", uint256(100))),
            keccak256(abi.encodePacked("release-fp", uint256(100))),
            "release"
        );

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stakeForRelease{value: STAKE_AMOUNT}(100);

        vm.prank(admin);
        cp.registerStemProtectionRoot(100, 300);

        assertEq(cp.getMaxListingPrice(300), STAKE_AMOUNT * 10);
    }

    function test_GetMaxListingPrice_NoStake() public view {
        assertEq(cp.getMaxListingPrice(999), type(uint256).max);
    }

    function test_IsTrackVerified_FalseAfterTrackSlash() public {
        _attestReleaseAndTrack(100, 200);

        vm.startPrank(admin);
        cp.registerTrack(100, 200);
        cp.registerStem(200, 300);
        vm.stopPrank();

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        cp.stake{value: STAKE_AMOUNT}(200);

        vm.prank(admin);
        cp.slash(200, reporter);

        assertTrue(cp.isReleaseVerified(100));
        assertFalse(cp.isTrackVerified(200));
        assertFalse(cp.isStemVerified(300));
    }

    function test_RevokeTrack_InvalidatesDerivedStemVerification() public {
        _attestReleaseAndTrack(100, 200);

        vm.startPrank(admin);
        cp.registerTrack(100, 200);
        cp.registerStem(200, 300);
        vm.expectEmit(true, false, false, false);
        emit TrackRevoked(200);
        cp.revokeTrack(200);
        vm.stopPrank();

        assertFalse(cp.isTrackVerified(200));
        assertFalse(cp.isStemVerified(300));
    }

    function test_RevokeRelease_CascadesToTracksAndStems() public {
        _attestReleaseAndTrack(100, 200);

        vm.prank(bob);
        cp.attest(201, keccak256("track2"), keccak256("tfp2"), "track-2");

        vm.startPrank(admin);
        cp.registerTrack(100, 200);
        cp.registerTrack(100, 201);
        cp.registerStem(200, 300);
        cp.registerStem(201, 301);
        vm.expectEmit(true, false, false, false);
        emit ReleaseRevoked(100);
        cp.revokeRelease(100);
        vm.stopPrank();

        assertFalse(cp.isReleaseVerified(100));
        assertFalse(cp.isTrackVerified(200));
        assertFalse(cp.isTrackVerified(201));
        assertFalse(cp.isStemVerified(300));
        assertFalse(cp.isStemVerified(301));
    }

    function _attestReleaseAndTrack(uint256 releaseId, uint256 trackId) internal {
        vm.prank(alice);
        cp.attestRelease(
            releaseId,
            keccak256(abi.encodePacked("release", releaseId)),
            keccak256(abi.encodePacked("release-fp", releaseId)),
            "release"
        );

        vm.prank(alice);
        cp.attest(
            trackId,
            keccak256(abi.encodePacked("track", trackId)),
            keccak256(abi.encodePacked("track-fp", trackId)),
            "track"
        );
    }

    function _configureUsdcStakeAsset() internal returns (MockUSDC usdc) {
        usdc = new MockUSDC();
        PaymentAssetRegistry registry = new PaymentAssetRegistry(admin);

        vm.startPrank(admin);
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        cp.setPaymentAssetRegistry(address(registry));
        cp.setStakeAmountForAsset(address(usdc), USDC_STAKE_AMOUNT);
        vm.stopPrank();
    }
}
