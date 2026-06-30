// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ContentProtection Fuzz Tests
 * @notice Property-based coverage for the stake / slash / refund accounting and
 *         access control of ContentProtection (issue #943), native-ETH path.
 *
 * Properties:
 *   - slash distribution sums exactly to the stake (60% reporter / 30% treasury /
 *     10% burned-and-retained), and pays the disclosed splits;
 *   - refund returns the exact staked amount to the attester;
 *   - conservation: staked == paidOut(reporter+treasury or attester) + retained;
 *   - one active stake per token; staking below the minimum reverts;
 *   - slash invalidates the attestation and blacklists the attester;
 *   - only the owner can slash or refund.
 */
contract ContentProtectionFuzzTest is Test {
    ContentProtection internal cp;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal attester = makeAddr("attester");
    address internal reporter = makeAddr("reporter");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant REPORTER_BPS = 6000;
    uint256 internal constant TREASURY_BPS = 3000;
    uint256 internal constant BPS = 10000;

    function setUp() public {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (owner, treasury, STAKE_AMOUNT));
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));
    }

    function _attest(uint256 tokenId) internal {
        vm.prank(attester);
        cp.attest(tokenId, keccak256("content"), keccak256("fingerprint"), "ipfs://meta");
    }

    function _attestAndStake(uint256 tokenId, uint256 amount) internal {
        _attest(tokenId);
        vm.deal(attester, amount);
        vm.prank(attester);
        cp.stake{value: amount}(tokenId);
    }

    // ----------------------------------------------------------------------
    // Staking
    // ----------------------------------------------------------------------

    function testFuzz_StakeBelowMinimumReverts(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, 0, STAKE_AMOUNT - 1);
        _attest(tokenId);
        vm.deal(attester, amount);
        vm.prank(attester);
        vm.expectRevert(IContentProtectionEvents.InsufficientStake.selector);
        cp.stake{value: amount}(tokenId);
    }

    function testFuzz_DoubleStakeReverts(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.deal(attester, amount);
        vm.prank(attester);
        vm.expectRevert(IContentProtectionEvents.AlreadyStaked.selector);
        cp.stake{value: amount}(tokenId);
    }

    /// @notice Overpaying records only the required stake and refunds the surplus (#1280).
    function testFuzz_StakeRecordsRequiredAndRefundsSurplus(uint256 tokenId, uint256 surplus) public {
        surplus = bound(surplus, 0, 1000 ether);
        _attest(tokenId);

        uint256 sent = STAKE_AMOUNT + surplus;
        vm.deal(attester, sent);
        vm.prank(attester);
        cp.stake{value: sent}(tokenId);

        (uint256 recorded,, bool active) = cp.stakes(tokenId);
        assertTrue(active);
        assertEq(recorded, STAKE_AMOUNT, "records required regardless of overpayment");
        assertEq(attester.balance, surplus, "surplus refunded to staker");
        assertEq(address(cp).balance, STAKE_AMOUNT, "contract holds only the required stake");
    }

    // ----------------------------------------------------------------------
    // Slash distribution
    // ----------------------------------------------------------------------

    function testFuzz_SlashDistributionSumsToStake(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        // The recorded (slashable) stake is always the required STAKE_AMOUNT — any
        // overpayment was refunded at stake time (#1280).
        uint256 staked = STAKE_AMOUNT;
        uint256 expReporter = (staked * REPORTER_BPS) / BPS;
        uint256 expTreasury = (staked * TREASURY_BPS) / BPS;
        uint256 expBurned = staked - expReporter - expTreasury;

        uint256 rBefore = reporter.balance;
        uint256 tBefore = treasury.balance;

        vm.prank(owner);
        cp.slash(tokenId, reporter);

        assertEq(reporter.balance - rBefore, expReporter, "reporter gets 60%");
        assertEq(treasury.balance - tBefore, expTreasury, "treasury gets 30%");
        assertEq(expReporter + expTreasury + expBurned, staked, "splits sum to stake");
        // 10% burned stays in the contract
        assertEq(address(cp).balance, expBurned, "burned remainder retained in contract");

        // slash invalidates the attestation, deactivates the stake, blacklists the attester
        (,,,,, bool valid) = cp.attestations(tokenId);
        assertFalse(valid, "attestation invalidated by slash");
        (,, bool active) = cp.stakes(tokenId);
        assertFalse(active, "stake deactivated by slash");
        assertTrue(cp.isBlacklisted(attester), "attester blacklisted by slash");
    }

    // ----------------------------------------------------------------------
    // Refund
    // ----------------------------------------------------------------------

    function testFuzz_RefundReturnsExactStake(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        uint256 before = attester.balance;
        vm.prank(owner);
        cp.refundStake(tokenId);

        // Only the required stake was held — overpayment was already refunded at stake time (#1280).
        assertEq(attester.balance - before, STAKE_AMOUNT, "attester refunded the exact required stake");
        assertEq(address(cp).balance, 0, "contract fully drained on refund");
        (,, bool active) = cp.stakes(tokenId);
        assertFalse(active, "stake deactivated by refund");
    }

    // ----------------------------------------------------------------------
    // Conservation
    // ----------------------------------------------------------------------

    function testFuzz_StakeConservation(uint256 tokenId, uint256 amount, bool doSlash) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        uint256 paidOut;
        if (doSlash) {
            uint256 rBefore = reporter.balance;
            uint256 tBefore = treasury.balance;
            vm.prank(owner);
            cp.slash(tokenId, reporter);
            paidOut = (reporter.balance - rBefore) + (treasury.balance - tBefore);
        } else {
            uint256 before = attester.balance;
            vm.prank(owner);
            cp.refundStake(tokenId);
            paidOut = attester.balance - before;
        }

        // The required stake == paid out + retained in contract (burned remainder, or
        // 0 after refund); overpayment was refunded at stake time, so `amount` is moot (#1280).
        assertEq(STAKE_AMOUNT, paidOut + address(cp).balance, "required stake == paidOut + retained");
    }

    // ----------------------------------------------------------------------
    // Access control
    // ----------------------------------------------------------------------

    function testFuzz_OnlyOwnerCanSlash(address caller, uint256 tokenId, uint256 amount) public {
        vm.assume(caller != owner);
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.prank(caller);
        vm.expectRevert(IContentProtectionEvents.NotOwner.selector);
        cp.slash(tokenId, reporter);
    }

    function testFuzz_OnlyOwnerCanRefund(address caller, uint256 tokenId, uint256 amount) public {
        vm.assume(caller != owner);
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.prank(caller);
        vm.expectRevert(IContentProtectionEvents.NotOwner.selector);
        cp.refundStake(tokenId);
    }

    function testFuzz_SlashRequiresActiveStake(uint256 tokenId) public {
        _attest(tokenId); // attested but never staked
        vm.prank(owner);
        vm.expectRevert(IContentProtectionEvents.NotStaked.selector);
        cp.slash(tokenId, reporter);
    }
}
