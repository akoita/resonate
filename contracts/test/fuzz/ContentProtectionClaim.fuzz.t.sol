// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title ContentProtection self-claim fuzz tests (#1759)
 * @notice Timing and authorization properties of `claimStakeRefund`:
 *   - an unlocked stake is claimable exactly from `depositedAt + escrow`;
 *   - a locked stake is claimable exactly from `depositedAt + escrow + 180 days`;
 *   - only the attester can claim, and a claim pays back exactly the stake;
 *   - the recorded escrow is the longest tier escrow at stake time;
 *   - the backfill anchors a legacy deadline on the deposit, whenever it runs.
 */
contract ContentProtectionClaimFuzzTest is Test, IContentProtectionEvents {
    ContentProtection internal cp;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal attester = makeAddr("attester");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant ESCROW = 30 days;
    uint256 internal constant FAIL_SAFE = 180 days;
    uint256 internal constant CLAIMABLE_AT_SLOT = 22;
    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;
    uint256 internal constant TOKEN = 1;

    function setUp() public {
        vm.warp(1_700_000_000);
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(
            ContentProtection.initializeFresh, (owner, treasury, STAKE_AMOUNT, makeAddr("upgradeAuthority"))
        );
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));
        vm.prank(owner);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);
    }

    function _attestAndStake() internal returns (uint256 depositedAt) {
        bytes memory sig = AttestationVoucher.sign(address(cp), REGISTRAR_PK, attester, TOKEN, AUTH_DEADLINE);
        vm.prank(attester);
        cp.attest(TOKEN, keccak256("content"), keccak256("fingerprint"), "ipfs://meta", AUTH_DEADLINE, sig);
        vm.deal(attester, STAKE_AMOUNT);
        vm.prank(attester);
        cp.stake{value: STAKE_AMOUNT}(TOKEN);
        depositedAt = block.timestamp;
    }

    function _tryClaim(address caller) internal returns (bool ok) {
        vm.prank(caller);
        (ok,) = address(cp).call(abi.encodeCall(ContentProtection.claimStakeRefund, (TOKEN)));
    }

    function testFuzz_UnlockedClaimOpensExactlyAtTheEscrowDeadline(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 3 * 365 days);
        uint256 depositedAt = _attestAndStake();
        vm.warp(depositedAt + elapsed);

        uint256 before = attester.balance;
        bool ok = _tryClaim(attester);
        assertEq(ok, elapsed >= ESCROW, "claimable iff the escrow has elapsed");
        assertEq(cp.isStaked(TOKEN), !ok);
        if (ok) assertEq(attester.balance - before, STAKE_AMOUNT, "pays back exactly the stake");
    }

    function testFuzz_LockedClaimOpensExactlyAtTheFailSafe(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 3 * 365 days);
        uint256 depositedAt = _attestAndStake();
        vm.prank(owner);
        cp.setStakeLock(TOKEN, true);
        vm.warp(depositedAt + elapsed);

        bool ok = _tryClaim(attester);
        assertEq(ok, elapsed >= ESCROW + FAIL_SAFE, "a lock holds until escrow + 180 days");
        assertEq(cp.isStaked(TOKEN), !ok);
    }

    function testFuzz_OnlyTheAttesterCanClaim(address caller, uint256 elapsed) public {
        vm.assume(caller != attester);
        elapsed = bound(elapsed, ESCROW, 3 * 365 days);
        uint256 depositedAt = _attestAndStake();
        vm.warp(depositedAt + elapsed);

        assertFalse(_tryClaim(caller));
        assertTrue(cp.isStaked(TOKEN));
        assertEq(address(cp).balance, STAKE_AMOUNT);
    }

    function testFuzz_RecordedEscrowIsTheLongestTierEscrow(uint256 newDays, uint256 trustedDays) public {
        newDays = bound(newDays, 0, 3650);
        trustedDays = bound(trustedDays, 0, 3650);
        vm.startPrank(owner);
        cp.setTierPolicy("new", STAKE_AMOUNT, newDays);
        cp.setTierPolicy("trusted", STAKE_AMOUNT / 10, trustedDays);
        vm.stopPrank();

        _attestAndStake();
        uint256 longest = newDays;
        if (trustedDays > longest) longest = trustedDays;
        if (14 > longest) longest = 14; // "established" default
        assertEq(cp.escrowSeconds(TOKEN), longest * 1 days);
    }

    function testFuzz_BackfillAnchorsOnTheDepositWheneverItRuns(uint256 backfillDelay) public {
        backfillDelay = bound(backfillDelay, 0, 3 * 365 days);
        uint256 depositedAt = _attestAndStake();
        vm.store(address(cp), keccak256(abi.encode(TOKEN, CLAIMABLE_AT_SLOT)), bytes32(0));
        vm.warp(depositedAt + backfillDelay);

        uint256[] memory ids = new uint256[](1);
        ids[0] = TOKEN;
        vm.prank(owner);
        cp.backfillStakeEscrow(ids);
        assertEq(cp.stakeClaimableAt(TOKEN), depositedAt + ESCROW);
        assertEq(_tryClaim(attester), backfillDelay >= ESCROW);
    }
}
