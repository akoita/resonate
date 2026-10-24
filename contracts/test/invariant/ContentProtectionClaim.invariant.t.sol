// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {CurationRewards} from "../../src/core/CurationRewards.sol";
import {IDisputeResolution} from "../../src/interfaces/IDisputeResolution.sol";
import {IDisputeResolutionEvents} from "../../src/interfaces/IDisputeResolutionEvents.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title Self-claim vs dispute handler (#1759)
 * @notice Drives the real ContentProtection + DisputeResolution + CurationRewards graph
 *         through reports, resolutions, appeals, time, attester claims, slashes and
 *         re-stakes. It records a violation whenever an attester's claim succeeds while a
 *         dispute holds the stake and the fail-safe has not passed — the front-running
 *         case the lock exists to prevent.
 */
contract StakeClaimHandler is Test {
    ContentProtection public cp;
    DisputeResolution public dr;
    CurationRewards public cr;

    address internal admin = makeAddr("claim_admin");
    address internal treasury = makeAddr("claim_treasury");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant FAIL_SAFE = 180 days;
    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    uint256[3] internal tokens = [uint256(11), 12, 13];
    address[3] internal attesters;
    uint256 internal reporterNonce;

    // Ghost state
    bool public drainedUnderDispute;
    uint256 public gDeposited;
    uint256 public gClaimed;
    uint256 public gSlashPaid;
    uint256 public claims;
    uint256 public blockedHeldClaims; // claim attempts the lock rejected (path is exercised)

    constructor() {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(
            ContentProtection.initializeFresh, (admin, treasury, STAKE_AMOUNT, makeAddr("claim_upgrade"))
        );
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));
        dr = new DisputeResolution(admin);
        cr = new CurationRewards(admin, address(cp), address(dr), treasury);

        vm.startPrank(admin);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);
        cp.setStakeLockAuthority(address(dr));
        dr.configureStakeLocking(address(cp), address(cr));
        vm.stopPrank();

        for (uint256 i; i < tokens.length; ++i) {
            attesters[i] = makeAddr(string(abi.encodePacked("claim_attester_", vm.toString(i))));
            bytes memory sig =
                AttestationVoucher.sign(address(cp), REGISTRAR_PK, attesters[i], tokens[i], AUTH_DEADLINE);
            vm.prank(attesters[i]);
            cp.attestRelease(tokens[i], keccak256("c"), keccak256("f"), "ipfs://r", AUTH_DEADLINE, sig);
            _stake(i);
        }
    }

    function tokenAt(uint256 i) external view returns (uint256) {
        return tokens[i];
    }

    function _stake(uint256 i) internal {
        vm.deal(attesters[i], STAKE_AMOUNT);
        vm.prank(attesters[i]);
        try cp.stakeForRelease{value: STAKE_AMOUNT}(tokens[i]) {
            gDeposited += STAKE_AMOUNT;
        } catch {}
    }

    function report(uint256 seed) external {
        uint256 tokenId = tokens[seed % tokens.length];
        address reporter = makeAddr(string(abi.encodePacked("claim_reporter_", vm.toString(reporterNonce++))));
        try cr.getRequiredCounterStakeForToken(tokenId, reporter) returns (address, uint256 counterStake) {
            vm.deal(reporter, counterStake);
            vm.prank(reporter);
            try cr.reportContent{value: counterStake}(tokenId, "ipfs://e") {} catch {}
        } catch {}
    }

    function resolve(uint256 seed, uint8 outcomeSeed) external {
        uint256 count = dr.disputeCount();
        if (count == 0) return;
        uint256 disputeId = (seed % count) + 1;
        IDisputeResolutionEvents.Outcome outcome = IDisputeResolutionEvents.Outcome((outcomeSeed % 3) + 1);
        vm.prank(admin);
        try dr.resolve(disputeId, outcome) {} catch {}
    }

    function appeal(uint256 seed) external {
        uint256 count = dr.disputeCount();
        if (count == 0) return;
        uint256 disputeId = (seed % count) + 1;
        IDisputeResolution.Dispute memory d = dr.getDispute(disputeId);
        address loser = d.outcome == IDisputeResolutionEvents.Outcome.Upheld ? d.creator : d.reporter;
        uint256 appealStake = cr.counterStakes(disputeId) * 2;
        vm.deal(loser, appealStake);
        vm.prank(loser);
        try cr.appealDispute{value: appealStake}(disputeId) {} catch {}
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 120 days));
    }

    function claim(uint256 seed) external {
        uint256 i = seed % tokens.length;
        uint256 tokenId = tokens[i];
        (uint256 amount,, bool active) = cp.stakes(tokenId);
        bool held = dr.activeStakeHolds(tokenId) > 0;
        bool beforeFailSafe = block.timestamp < cp.stakeClaimableAt(tokenId) + FAIL_SAFE;

        vm.prank(attesters[i]);
        try cp.claimStakeRefund(tokenId) {
            if (held && beforeFailSafe) drainedUnderDispute = true;
            if (active) gClaimed += amount;
            ++claims;
        } catch {
            if (held && beforeFailSafe && active) ++blockedHeldClaims;
        }
    }

    function slash(uint256 seed) external {
        uint256 tokenId = tokens[seed % tokens.length];
        (uint256 amount,, bool active) = cp.stakes(tokenId);
        if (!active) return;
        vm.prank(admin);
        try cp.slash(tokenId, treasury) {
            gSlashPaid += (amount * 6000) / 10000 + (amount * 3000) / 10000;
        } catch {}
    }

    function restake(uint256 seed) external {
        uint256 i = seed % tokens.length;
        (,, bool active) = cp.stakes(tokens[i]);
        if (!active) _stake(i);
    }
}

/**
 * @title Self-claim invariants (#1759)
 * @notice A stake held by an open dispute cannot be drained by its attester before the
 *         dispute releases it or the fail-safe passes; every open dispute keeps its stake
 *         locked; and stake custody is conserved across claims and slashes.
 */
/// forge-config: default.invariant.depth = 40
/// forge-config: ci.invariant.depth = 40
contract ContentProtectionClaimInvariantTest is Test {
    StakeClaimHandler internal handler;

    function setUp() public {
        handler = new StakeClaimHandler();
        targetContract(address(handler));
    }

    /// Coverage evidence: the run reaches both successful claims and lock-blocked ones.
    function afterInvariant() public view {
        console.log("disputes filed:", handler.dr().disputeCount());
        console.log("successful claims:", handler.claims());
        console.log("claims blocked by a dispute hold:", handler.blockedHeldClaims());
    }

    function invariant_noDrainWhileADisputeHoldsTheStake() public view {
        assertFalse(handler.drainedUnderDispute(), "attester claimed a disputed stake before the fail-safe");
    }

    function invariant_everyOpenDisputeLocksItsStake() public view {
        for (uint256 i; i < 3; ++i) {
            uint256 tokenId = handler.tokenAt(i);
            if (handler.dr().activeDisputeByToken(tokenId) != 0) {
                assertTrue(handler.cp().stakeLocked(tokenId), "open dispute without a stake lock");
            }
            if (handler.dr().activeStakeHolds(tokenId) > 0) {
                assertTrue(handler.cp().stakeLocked(tokenId), "held stake without a lock");
            }
        }
    }

    function invariant_stakeCustodyIsConserved() public view {
        // Burned slash remainders stay in the contract, so they are part of the balance.
        assertEq(
            address(handler.cp()).balance,
            handler.gDeposited() - handler.gClaimed() - handler.gSlashPaid(),
            "balance != deposited - claimed - slash payouts"
        );
    }
}
