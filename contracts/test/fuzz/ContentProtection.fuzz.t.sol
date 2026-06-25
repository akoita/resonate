// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
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
        vm.expectRevert(ContentProtection.InsufficientStake.selector);
        cp.stake{value: amount}(tokenId);
    }

    function testFuzz_DoubleStakeReverts(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.deal(attester, amount);
        vm.prank(attester);
        vm.expectRevert(ContentProtection.AlreadyStaked.selector);
        cp.stake{value: amount}(tokenId);
    }

    // ----------------------------------------------------------------------
    // Slash distribution
    // ----------------------------------------------------------------------

    function testFuzz_SlashDistributionSumsToStake(uint256 tokenId, uint256 amount) public {
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        uint256 expReporter = (amount * REPORTER_BPS) / BPS;
        uint256 expTreasury = (amount * TREASURY_BPS) / BPS;
        uint256 expBurned = amount - expReporter - expTreasury;

        uint256 rBefore = reporter.balance;
        uint256 tBefore = treasury.balance;

        vm.prank(owner);
        cp.slash(tokenId, reporter);

        assertEq(reporter.balance - rBefore, expReporter, "reporter gets 60%");
        assertEq(treasury.balance - tBefore, expTreasury, "treasury gets 30%");
        assertEq(expReporter + expTreasury + expBurned, amount, "splits sum to stake");
        // 10% burned stays in the contract
        assertEq(address(cp).balance, expBurned, "burned remainder retained in contract");

        // slash invalidates the attestation, deactivates the stake, blacklists the attester
        (,,,, , bool valid) = cp.attestations(tokenId);
        assertFalse(valid, "attestation invalidated by slash");
        (, , bool active) = cp.stakes(tokenId);
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

        assertEq(attester.balance - before, amount, "attester refunded the exact stake");
        assertEq(address(cp).balance, 0, "contract fully drained on refund");
        (, , bool active) = cp.stakes(tokenId);
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

        // staked == paid out + retained in contract (burned remainder, or 0 after refund)
        assertEq(amount, paidOut + address(cp).balance, "staked == paidOut + retained");
    }

    // ----------------------------------------------------------------------
    // Access control
    // ----------------------------------------------------------------------

    function testFuzz_OnlyOwnerCanSlash(address caller, uint256 tokenId, uint256 amount) public {
        vm.assume(caller != owner);
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.prank(caller);
        vm.expectRevert(ContentProtection.NotOwner.selector);
        cp.slash(tokenId, reporter);
    }

    function testFuzz_OnlyOwnerCanRefund(address caller, uint256 tokenId, uint256 amount) public {
        vm.assume(caller != owner);
        amount = bound(amount, STAKE_AMOUNT, 1000 ether);
        _attestAndStake(tokenId, amount);

        vm.prank(caller);
        vm.expectRevert(ContentProtection.NotOwner.selector);
        cp.refundStake(tokenId);
    }

    function testFuzz_SlashRequiresActiveStake(uint256 tokenId) public {
        _attest(tokenId); // attested but never staked
        vm.prank(owner);
        vm.expectRevert(ContentProtection.NotStaked.selector);
        cp.slash(tokenId, reporter);
    }
}
