// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurationRewards} from "../../src/core/CurationRewards.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IDisputeResolution} from "../../src/interfaces/IDisputeResolution.sol";

/**
 * @title CurationRewards Unit Tests
 * @notice Tests report → dispute lifecycle, bounty claims, counter-stake slashing
 */
contract CurationRewardsTest is Test {
    CurationRewards public cr;
    DisputeResolution public dr;
    ContentProtection public cp;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public creator = makeAddr("creator");
    address public reporter = makeAddr("reporter");

    uint256 constant STAKE_AMOUNT = 0.01 ether;
    uint256 constant COUNTER_STAKE = 0.002 ether; // 20% of stake

    event ContentReported(
        uint256 indexed disputeId,
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 counterStake,
        string evidenceURI
    );

    event BountyClaimed(uint256 indexed disputeId, address indexed reporter, uint256 amount);

    event CounterStakeSlashed(
        uint256 indexed disputeId, address indexed reporter, address indexed creator, uint256 amount
    );

    event CounterStakeRefunded(uint256 indexed disputeId, address indexed reporter, uint256 amount);

    function setUp() public {
        // Deploy ContentProtection (UUPS proxy)
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (admin, treasury, STAKE_AMOUNT));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cp = ContentProtection(address(proxy));

        // Deploy DisputeResolution
        dr = new DisputeResolution(admin);

        // Deploy CurationRewards
        cr = new CurationRewards(admin, address(cp), address(dr), treasury);

        // Setup: creator attests + stakes token #1
        vm.prank(creator);
        cp.attest(1, keccak256("audio"), keccak256("fp"), "ipfs://meta");
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        cp.stake{value: STAKE_AMOUNT}(1);
    }

    // ============ Report Content ============

    function test_ReportContent() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        vm.expectEmit(true, true, true, true);
        emit ContentReported(1, 1, reporter, COUNTER_STAKE, "ipfs://evidence");

        uint256 id = cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        assertEq(id, 1);
        assertEq(cr.counterStakes(1), COUNTER_STAKE);
        assertEq(cr.reporters(1), reporter);
    }

    function test_ReportContent_RevertSelfReport() public {
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert(CurationRewards.SelfReport.selector);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://self-flag");
    }

    function test_ReportContent_RevertInsufficientStake() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        vm.expectRevert(CurationRewards.InsufficientCounterStake.selector);
        cr.reportContent{value: COUNTER_STAKE - 1}(1, "ipfs://e");
    }

    function test_ReportContent_RequiredStakeCalc() public view {
        uint256 required = cr.getRequiredCounterStake();
        assertEq(required, COUNTER_STAKE); // 20% of 0.01 ether
    }

    function test_ReportContent_TrustedCuratorGetsReducedStake() public {
        vm.prank(creator);
        cp.attest(2, keccak256("audio-2"), keccak256("fp-2"), "ipfs://meta-2");
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        cp.stake{value: STAKE_AMOUNT}(2);

        vm.deal(reporter, 2 ether);

        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence-1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
        vm.prank(reporter);
        cr.claimBounty(1);

        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(2, "ipfs://evidence-2");
        vm.prank(admin);
        dr.resolve(2, IDisputeResolution.Outcome.Upheld);
        vm.prank(reporter);
        cr.claimBounty(2);

        uint256 reducedStake = cr.getRequiredCounterStakeFor(reporter);
        assertEq(reducedStake, 0.0015 ether);
    }

    function test_ReportContent_HighRiskCuratorPaysMore() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);
        cr.processRejection(1);

        uint256 increasedStake = cr.getRequiredCounterStakeFor(reporter);
        assertEq(increasedStake, 0.003 ether);
    }

    function test_ReportContent_StemResolvesToCanonicalTrack() public {
        vm.prank(creator);
        cp.attest(10, keccak256("release"), keccak256("release-fp"), "release");

        vm.prank(admin);
        cp.registerTrack(10, 1);

        vm.prank(admin);
        cp.registerStem(1, 99);

        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        vm.expectEmit(true, true, true, true);
        emit ContentReported(1, 1, reporter, COUNTER_STAKE, "ipfs://stem-evidence");

        uint256 disputeId = cr.reportContent{value: COUNTER_STAKE}(99, "ipfs://stem-evidence");

        assertEq(disputeId, 1);

        IDisputeResolution.Dispute memory dispute = dr.getDispute(disputeId);
        assertEq(dispute.tokenId, 1);
        assertEq(dispute.creator, creator);
    }

    function test_ReportContent_RevertRepeatReporterAfterResolution() public {
        vm.deal(reporter, 1 ether);

        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");

        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        vm.prank(reporter);
        vm.expectRevert(DisputeResolution.AlreadyReported.selector);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence-2");
    }

    // ============ Bounty Claim (Upheld) ============

    function test_ClaimBounty() public {
        // Report
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");

        // Admin resolves as upheld
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        // Claim bounty
        uint256 balBefore = reporter.balance;
        vm.prank(reporter);
        vm.expectEmit(true, true, false, true);
        emit BountyClaimed(1, reporter, COUNTER_STAKE);
        cr.claimBounty(1);

        // Counter-stake refunded
        assertEq(reporter.balance - balBefore, COUNTER_STAKE);

        // Reputation updated (+10)
        assertEq(cr.getReputation(reporter), 10);
        assertEq(cr.successfulReports(reporter), 1);
    }

    function test_ClaimBounty_RevertNotResolved() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");

        vm.prank(reporter);
        vm.expectRevert(CurationRewards.DisputeNotResolved.selector);
        cr.claimBounty(1);
    }

    function test_ClaimBounty_RevertDoubleClaim() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        vm.prank(reporter);
        cr.claimBounty(1);

        vm.prank(reporter);
        vm.expectRevert(CurationRewards.AlreadyClaimed.selector);
        cr.claimBounty(1);
    }

    function test_ClaimBounty_RevertNotUpheld() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        vm.prank(reporter);
        vm.expectRevert(CurationRewards.NotUpheld.selector);
        cr.claimBounty(1);
    }

    // ============ Rejection (Counter-stake Slashed) ============

    function test_ProcessRejection() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Rejected);

        uint256 creatorBalBefore = creator.balance;

        vm.expectEmit(true, true, true, true);
        emit CounterStakeSlashed(1, reporter, creator, COUNTER_STAKE);
        cr.processRejection(1);

        // Counter-stake goes to creator
        assertEq(creator.balance - creatorBalBefore, COUNTER_STAKE);

        // Reporter reputation decreased (-15)
        assertEq(cr.getReputation(reporter), -15);
        assertEq(cr.rejectedReports(reporter), 1);
    }

    function test_ProcessRejection_RevertNotRejected() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);

        vm.expectRevert(CurationRewards.NotUpheld.selector);
        cr.processRejection(1);
    }

    // ============ Inconclusive (Counter-stake Refunded) ============

    function test_ProcessInconclusive() public {
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://evidence");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Inconclusive);

        uint256 reporterBalBefore = reporter.balance;

        vm.expectEmit(true, true, false, true);
        emit CounterStakeRefunded(1, reporter, COUNTER_STAKE);
        cr.processInconclusive(1);

        // Counter-stake refunded to reporter
        assertEq(reporter.balance - reporterBalBefore, COUNTER_STAKE);

        // No reputation change
        assertEq(cr.getReputation(reporter), 0);
    }

    // ============ Admin ============

    function test_SetCounterStakeBps() public {
        vm.prank(admin);
        cr.setCounterStakeBps(3000); // 30%
        assertEq(cr.counterStakeBps(), 3000);

        uint256 required = cr.getRequiredCounterStake();
        assertEq(required, (STAKE_AMOUNT * 3000) / 10000);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(admin);
        cr.setTreasury(newTreasury);
        assertEq(cr.treasury(), newTreasury);
    }

    function test_SetTreasury_RevertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(CurationRewards.ZeroAddress.selector);
        cr.setTreasury(address(0));
    }

    // ============ Reputation Tracking ============

    function test_ReputationAccumulates() public {
        // Two reports on different tokens — need token #2
        vm.prank(creator);
        cp.attest(2, keccak256("audio2"), keccak256("fp2"), "ipfs://meta2");
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        cp.stake{value: STAKE_AMOUNT}(2);

        // Report #1 — upheld
        vm.deal(reporter, 1 ether);
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(1, "ipfs://e1");
        vm.prank(admin);
        dr.resolve(1, IDisputeResolution.Outcome.Upheld);
        vm.prank(reporter);
        cr.claimBounty(1);

        // Report #2 — rejected
        vm.prank(reporter);
        cr.reportContent{value: COUNTER_STAKE}(2, "ipfs://e2");
        vm.prank(admin);
        dr.resolve(2, IDisputeResolution.Outcome.Rejected);
        cr.processRejection(2);

        // Net reputation: +10 - 15 = -5
        assertEq(cr.getReputation(reporter), -5);
        assertEq(cr.successfulReports(reporter), 1);
        assertEq(cr.rejectedReports(reporter), 1);
    }
}
