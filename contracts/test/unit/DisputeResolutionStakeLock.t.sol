// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {CurationRewards} from "../../src/core/CurationRewards.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {IDisputeResolutionEvents} from "../../src/interfaces/IDisputeResolutionEvents.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title DisputeResolution stake hold tests (#1759)
 * @notice The dispute flow, not an operator, sets and clears the ContentProtection
 *         stake lock: filing (through CurationRewards) holds the release's stake root,
 *         Rejected/Inconclusive outcomes release it, Upheld keeps it for the slash,
 *         appeals re-hold it, and several disputes on one root clear it only together.
 */
contract DisputeResolutionStakeLockTest is Test, IDisputeResolutionEvents {
    ContentProtection internal cp;
    DisputeResolution internal dr;
    CurationRewards internal cr;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal reporter = makeAddr("reporter");
    address internal reporter2 = makeAddr("reporter2");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant RELEASE = 100;
    uint256 internal constant TRACK_A = 200;
    uint256 internal constant TRACK_B = 201;
    uint256 internal constant FAIL_SAFE = 180 days;

    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    function setUp() public {
        vm.warp(1_700_000_000);
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(
            ContentProtection.initializeFresh, (admin, treasury, STAKE_AMOUNT, makeAddr("upgradeAuthority"))
        );
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));
        dr = new DisputeResolution(admin, 0);
        cr = new CurationRewards(admin, address(cp), address(dr), treasury);

        vm.startPrank(admin);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);
        cp.setStakeLockAuthority(address(dr));
        dr.configureStakeLocking(address(cp), address(cr));
        vm.stopPrank();

        _attest(RELEASE, true);
        _attest(TRACK_A, false);
        _attest(TRACK_B, false);
        vm.startPrank(admin);
        cp.registerTrack(RELEASE, TRACK_A);
        cp.registerTrack(RELEASE, TRACK_B);
        vm.stopPrank();

        vm.deal(creator, STAKE_AMOUNT);
        vm.prank(creator);
        cp.stakeForRelease{value: STAKE_AMOUNT}(RELEASE);
    }

    function _attest(uint256 tokenId, bool release) internal {
        bytes memory sig = AttestationVoucher.sign(address(cp), REGISTRAR_PK, creator, tokenId, AUTH_DEADLINE);
        vm.prank(creator);
        if (release) {
            cp.attestRelease(tokenId, keccak256("r"), keccak256("rf"), "ipfs://release", AUTH_DEADLINE, sig);
        } else {
            cp.attest(tokenId, keccak256("t"), keccak256("tf"), "ipfs://track", AUTH_DEADLINE, sig);
        }
    }

    function _report(address who, uint256 tokenId) internal returns (uint256 disputeId) {
        (, uint256 counterStake) = cr.getRequiredCounterStakeForToken(tokenId, who);
        vm.deal(who, counterStake);
        vm.prank(who);
        disputeId = cr.reportContent{value: counterStake}(tokenId, "ipfs://evidence");
    }

    function _resolve(uint256 disputeId, Outcome outcome) internal {
        vm.prank(admin);
        dr.resolve(disputeId, outcome);
    }

    function _assertClaimBlocked() internal {
        uint256 failSafeAt = cp.stakeClaimableAt(RELEASE) + FAIL_SAFE;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(IContentProtectionEvents.StakeLockActive.selector, RELEASE, failSafeAt));
        cp.claimStakeRefund(RELEASE);
    }

    // ── hold on file ─────────────────────────────────────────────────────

    function test_Report_HoldsTheReleaseStakeRoot() public {
        vm.expectEmit(true, true, false, true);
        emit StakeHoldUpdated(1, RELEASE, true);
        uint256 id = _report(reporter, TRACK_A);

        assertTrue(cp.stakeLocked(RELEASE), "a track dispute locks its release stake");
        assertEq(dr.activeStakeHolds(RELEASE), 1);
        (uint256 root, bool recorded, bool held) = dr.stakeHolds(id);
        assertEq(root, RELEASE);
        assertTrue(recorded);
        assertTrue(held);

        vm.warp(cp.stakeClaimableAt(RELEASE));
        _assertClaimBlocked();
    }

    function test_Rejected_ReleasesTheLockAndTheCreatorCanClaim() public {
        uint256 id = _report(reporter, TRACK_A);
        vm.expectEmit(true, true, false, true);
        emit StakeHoldUpdated(id, RELEASE, false);
        _resolve(id, Outcome.Rejected);

        assertFalse(cp.stakeLocked(RELEASE));
        assertEq(dr.activeStakeHolds(RELEASE), 0);
        vm.warp(cp.stakeClaimableAt(RELEASE));
        vm.prank(creator);
        cp.claimStakeRefund(RELEASE);
        assertFalse(cp.isStaked(RELEASE));
    }

    function test_Inconclusive_ReleasesTheLock() public {
        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Inconclusive);
        assertFalse(cp.stakeLocked(RELEASE));
    }

    function test_Upheld_KeepsHoldingForTheSlash() public {
        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Upheld);

        assertTrue(cp.stakeLocked(RELEASE), "an upheld dispute keeps the stake for the slash");
        vm.warp(cp.stakeClaimableAt(RELEASE));
        _assertClaimBlocked();

        vm.prank(admin);
        cp.slash(RELEASE, reporter);
        assertFalse(cp.isStaked(RELEASE), "slashing works on a locked stake");

        vm.prank(admin);
        dr.releaseStakeHold(id);
        assertFalse(cp.stakeLocked(RELEASE));
        assertEq(dr.activeStakeHolds(RELEASE), 0);
    }

    function test_Upheld_FailSafeStillLetsTheCreatorLeave() public {
        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Upheld);

        vm.warp(cp.stakeClaimableAt(RELEASE) + FAIL_SAFE);
        vm.prank(creator);
        cp.claimStakeRefund(RELEASE);
        assertFalse(cp.isStaked(RELEASE));
    }

    function test_Appeal_ReHoldsAReleasedStake() public {
        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Rejected);
        assertFalse(cp.stakeLocked(RELEASE));

        uint256 appealStake = cr.counterStakes(id) * 2;
        vm.deal(reporter, appealStake);
        vm.prank(reporter);
        cr.appealDispute{value: appealStake}(id);

        assertTrue(cp.stakeLocked(RELEASE), "an appeal holds the stake again");
        assertEq(dr.activeStakeHolds(RELEASE), 1);

        _resolve(id, Outcome.Rejected);
        assertFalse(cp.stakeLocked(RELEASE));
    }

    function test_Appeal_OfAnUpheldDisputeKeepsASingleHold() public {
        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Upheld);

        uint256 appealStake = cr.counterStakes(id) * 2;
        vm.deal(creator, appealStake);
        vm.prank(creator);
        cr.appealDispute{value: appealStake}(id);
        assertEq(dr.activeStakeHolds(RELEASE), 1, "the hold is per dispute, not per filing");

        _resolve(id, Outcome.Rejected);
        assertFalse(cp.stakeLocked(RELEASE));
        assertEq(dr.activeStakeHolds(RELEASE), 0);
    }

    function test_TwoDisputesOnOneRoot_ClearOnlyTogether() public {
        uint256 first = _report(reporter, TRACK_A);
        uint256 second = _report(reporter2, TRACK_B);
        assertEq(dr.activeStakeHolds(RELEASE), 2);

        _resolve(first, Outcome.Rejected);
        assertTrue(cp.stakeLocked(RELEASE), "the other open dispute still holds the stake");

        _resolve(second, Outcome.Inconclusive);
        assertFalse(cp.stakeLocked(RELEASE));
        assertEq(dr.activeStakeHolds(RELEASE), 0);
    }

    function test_JuryRejection_ReleasesTheLock() public {
        address[3] memory jurors = [makeAddr("j1"), makeAddr("j2"), makeAddr("j3")];
        vm.startPrank(admin);
        for (uint256 i; i < jurors.length; ++i) {
            dr.registerJuror(jurors[i]);
        }
        vm.stopPrank();

        uint256 id = _report(reporter, TRACK_A);
        vm.startPrank(admin);
        dr.markUnderReview(id);
        dr.escalateToJury(id);
        vm.stopPrank();

        for (uint256 i; i < jurors.length; ++i) {
            vm.prank(jurors[i]);
            dr.castJuryVote(id, JuryVote.Creator);
        }
        dr.finalizeJuryDecision(id);
        assertFalse(cp.stakeLocked(RELEASE));
    }

    function test_JuryUphold_KeepsTheHold() public {
        address[3] memory jurors = [makeAddr("j1"), makeAddr("j2"), makeAddr("j3")];
        vm.startPrank(admin);
        for (uint256 i; i < jurors.length; ++i) {
            dr.registerJuror(jurors[i]);
        }
        vm.stopPrank();

        uint256 id = _report(reporter, TRACK_A);
        vm.startPrank(admin);
        dr.markUnderReview(id);
        dr.escalateToJury(id);
        vm.stopPrank();
        for (uint256 i; i < jurors.length; ++i) {
            vm.prank(jurors[i]);
            dr.castJuryVote(id, JuryVote.Reporter);
        }
        dr.finalizeJuryDecision(id);
        assertTrue(cp.stakeLocked(RELEASE));
    }

    // ── filer gate ───────────────────────────────────────────────────────

    function test_DirectFilingAndAppealRevertWhileLockingIsOn() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDisputeFiler.selector, attacker));
        dr.fileDispute(RELEASE, attacker, creator, "ipfs://free-lock");
        assertFalse(cp.stakeLocked(RELEASE), "nobody can lock a deposit without a counter-stake");

        uint256 id = _report(reporter, TRACK_A);
        _resolve(id, Outcome.Rejected);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedDisputeFiler.selector, attacker));
        dr.appeal(id, reporter);
        assertFalse(cp.stakeLocked(RELEASE));
    }

    function test_Report_RevertsWhenDisputeResolutionIsNotTheLockAuthority() public {
        vm.prank(admin);
        cp.setStakeLockAuthority(address(0));

        (, uint256 counterStake) = cr.getRequiredCounterStakeForToken(TRACK_A, reporter);
        vm.deal(reporter, counterStake);
        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(IContentProtectionEvents.NotStakeLockAuthority.selector, address(dr))
        );
        cr.reportContent{value: counterStake}(TRACK_A, "ipfs://evidence");
    }

    // ── configuration ────────────────────────────────────────────────────

    function test_ConfigureStakeLocking_RejectsAHalfConfigAndNonOwners() public {
        vm.startPrank(admin);
        vm.expectRevert(InvalidStakeLockConfig.selector);
        dr.configureStakeLocking(address(cp), address(0));
        vm.expectRevert(InvalidStakeLockConfig.selector);
        dr.configureStakeLocking(address(0), address(cr));
        vm.stopPrank();

        vm.prank(attacker);
        vm.expectRevert();
        dr.configureStakeLocking(address(cp), attacker);
    }

    function test_LockingOff_RestoresThePreviousBehaviour() public {
        vm.expectEmit(true, true, false, true);
        emit StakeLockingConfigured(address(0), address(0));
        vm.prank(admin);
        dr.configureStakeLocking(address(0), address(0));

        uint256 id = dr.fileDispute(RELEASE, attacker, creator, "ipfs://direct");
        assertFalse(cp.stakeLocked(RELEASE), "no hold when locking is off");
        (,, bool held) = dr.stakeHolds(id);
        assertFalse(held);
        _resolve(id, Outcome.Rejected);
    }

    function test_ReleaseStakeHold_Guards() public {
        uint256 id = _report(reporter, TRACK_A);

        vm.prank(attacker);
        vm.expectRevert();
        dr.releaseStakeHold(id);

        vm.prank(admin);
        vm.expectRevert(DisputeNotResolved.selector);
        dr.releaseStakeHold(id);

        vm.prank(admin);
        vm.expectRevert(DisputeNotFound.selector);
        dr.releaseStakeHold(999);

        _resolve(id, Outcome.Rejected);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(NoStakeHold.selector, id));
        dr.releaseStakeHold(id);
    }
}
