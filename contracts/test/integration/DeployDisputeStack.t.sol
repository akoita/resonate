// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {CurationRewards} from "../../src/core/CurationRewards.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {IDisputeResolutionEvents} from "../../src/interfaces/IDisputeResolutionEvents.sol";
import {DeployDisputeStack} from "../../script/DeployDisputeStack.s.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/// @dev The read surface of a DisputeResolution that predates the juror pool.
contract LegacyDisputeResolutionMock {
    address public owner;
    uint256 public disputeCount;

    constructor(address owner_, uint256 disputeCount_) {
        owner = owner_;
        disputeCount = disputeCount_;
    }
}

/// @dev Exposes the script's config resolution and deployment without process env.
contract DeployDisputeStackHarness is DeployDisputeStack {
    function resolveConfig(DisputeStackInputs memory inputs, address deployer)
        external
        view
        returns (DisputeStackConfig memory)
    {
        return _resolveDisputeStackConfig(inputs, deployer);
    }

    function deploy(uint256 deployerKey, DisputeStackConfig memory config)
        external
        returns (DisputeStackResult memory result)
    {
        result = _deployDisputeStack(deployerKey, config);
        _logSummary(config, result);
    }
}

/**
 * @title DeployDisputeStack script tests (#1759)
 * @notice Replacing the dispute stack next to a live ContentProtection keeps dispute
 *         ids unique on the chain, replicates the previous stack's configuration,
 *         binds the new CurationRewards to the new DisputeResolution and the existing
 *         ContentProtection, and turns stake locking on without ever filing an
 *         unlocked dispute.
 */
contract DeployDisputeStackTest is Test {
    DeployDisputeStackHarness internal script;
    ContentProtection internal cp;
    DisputeResolution internal oldDr;
    CurationRewards internal oldCr;

    address internal cpOwner = makeAddr("cpOwner");
    address internal oldDrOwner = makeAddr("oldDrOwner");
    address internal oldCrOwner = makeAddr("oldCrOwner");
    address internal oldTreasury = makeAddr("oldTreasury");
    address internal creator = makeAddr("creator");
    address internal reporter = makeAddr("reporter");
    address internal juror1 = makeAddr("juror1");
    address internal juror2 = makeAddr("juror2");
    address internal juror3 = makeAddr("juror3");

    uint256 internal constant DEPLOYER_PK = 0xD15B07E;
    address internal deployer;

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant TOKEN = 100;
    uint256 internal constant OLD_DISPUTES = 3;
    uint256 internal constant OLD_COUNTER_STAKE_BPS = 2500;

    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    function setUp() public {
        vm.warp(1_700_000_000);
        deployer = vm.addr(DEPLOYER_PK);
        script = new DeployDisputeStackHarness();

        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(
            ContentProtection.initializeFresh, (cpOwner, oldTreasury, STAKE_AMOUNT, makeAddr("upgradeAuthority"))
        );
        cp = ContentProtection(payable(address(new ERC1967Proxy(address(impl), initData))));
        vm.prank(cpOwner);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);

        // The stack being replaced: no stake locking (as a pre-v2.1.0 deployment),
        // three disputes already issued, a juror pool and a tuned counter-stake.
        oldDr = new DisputeResolution(oldDrOwner, 0);
        oldCr = new CurationRewards(oldCrOwner, address(cp), address(oldDr), oldTreasury);
        for (uint256 i = 0; i < OLD_DISPUTES; i++) {
            oldDr.fileDispute(900 + i, reporter, creator, "ipfs://old");
        }
        vm.startPrank(oldDrOwner);
        oldDr.registerJuror(juror1);
        oldDr.registerJuror(juror2);
        oldDr.registerJuror(juror3);
        vm.stopPrank();
        vm.prank(oldCrOwner);
        oldCr.setCounterStakeBps(OLD_COUNTER_STAKE_BPS);

        bytes memory sig = AttestationVoucher.sign(address(cp), REGISTRAR_PK, creator, TOKEN, AUTH_DEADLINE);
        vm.prank(creator);
        cp.attestRelease(TOKEN, keccak256("r"), keccak256("rf"), "ipfs://release", AUTH_DEADLINE, sig);
        vm.deal(creator, STAKE_AMOUNT);
        vm.prank(creator);
        cp.stakeForRelease{value: STAKE_AMOUNT}(TOKEN);
    }

    function _inputs() internal view returns (DeployDisputeStack.DisputeStackInputs memory inputs) {
        inputs.contentProtection = address(cp);
        inputs.previousDisputeResolution = address(oldDr);
        inputs.previousCurationRewards = address(oldCr);
    }

    function _deploy(DeployDisputeStack.DisputeStackInputs memory inputs, uint256 key)
        internal
        returns (DeployDisputeStack.DisputeStackResult memory)
    {
        DeployDisputeStack.DisputeStackConfig memory config = script.resolveConfig(inputs, vm.addr(key));
        return script.deploy(key, config);
    }

    function _report(CurationRewards cr) internal returns (uint256 disputeId) {
        (, uint256 counterStake) = cr.getRequiredCounterStakeForToken(TOKEN, reporter);
        vm.deal(reporter, counterStake);
        vm.prank(reporter);
        disputeId = cr.reportContent{value: counterStake}(TOKEN, "ipfs://evidence");
    }

    // ── replacement next to a ContentProtection the deployer does not own ──

    function test_Replacement_ContinuesNumberingAndReplicatesTheOldStack() public {
        DeployDisputeStack.DisputeStackResult memory r = _deploy(_inputs(), DEPLOYER_PK);
        DisputeResolution dr = r.disputeResolution;
        CurationRewards cr = r.curationRewards;

        assertEq(dr.disputeIdOffset(), OLD_DISPUTES, "offset = previous disputeCount()");
        assertEq(dr.disputeCount(), OLD_DISPUTES);

        assertEq(address(cr.disputeResolution()), address(dr), "CurationRewards bound to the new DR");
        assertEq(address(cr.contentProtection()), address(cp), "CurationRewards bound to the existing CP");
        assertEq(cr.treasury(), oldTreasury, "treasury replicated");
        assertEq(cr.counterStakeBps(), OLD_COUNTER_STAKE_BPS, "counter-stake ratio replicated");

        assertEq(address(dr.contentProtection()), address(cp), "stake locking targets the existing CP");
        assertEq(dr.disputeFiler(), address(cr), "only the new CurationRewards may file");

        assertTrue(dr.eligibleJurors(juror1));
        assertTrue(dr.eligibleJurors(juror2));
        assertTrue(dr.eligibleJurors(juror3));
        assertEq(dr.jurorPool(2), juror3);
        vm.expectRevert();
        dr.jurorPool(3);

        assertEq(dr.owner(), oldDrOwner, "DR owner replicated");
        assertEq(cr.owner(), oldCrOwner, "CR owner replicated");
        assertFalse(r.stakeLockAuthoritySet, "the deployer cannot authorise on a CP it does not own");
        assertEq(cp.stakeLockAuthority(), address(0));
    }

    function test_Replacement_FailsClosedUntilAuthorisedThenLocksAndContinuesIds() public {
        DeployDisputeStack.DisputeStackResult memory r = _deploy(_inputs(), DEPLOYER_PK);
        DisputeResolution dr = r.disputeResolution;
        CurationRewards cr = r.curationRewards;

        // Locking is on but CP does not list the new DR yet: no unlocked dispute.
        (, uint256 counterStake) = cr.getRequiredCounterStakeForToken(TOKEN, reporter);
        vm.deal(reporter, counterStake);
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(IContentProtectionEvents.NotStakeLockAuthority.selector, address(dr)));
        cr.reportContent{value: counterStake}(TOKEN, "ipfs://evidence");

        // A direct filing is refused as well.
        vm.expectRevert(
            abi.encodeWithSelector(IDisputeResolutionEvents.UnauthorizedDisputeFiler.selector, address(this))
        );
        dr.fileDispute(TOKEN, reporter, creator, "ipfs://direct");

        // The configure-content-protection-stake-lock step (CP owner).
        vm.prank(cpOwner);
        cp.setStakeLockAuthority(address(dr));

        uint256 id = _report(cr);
        assertEq(id, OLD_DISPUTES + 1, "first new dispute continues the old numbering");
        assertEq(cr.reporters(id), reporter);
        assertTrue(cp.stakeLocked(TOKEN), "the open dispute holds the creator stake");

        // The old contracts keep their own disputes untouched.
        assertEq(oldDr.disputeCount(), OLD_DISPUTES);
        assertEq(oldDr.getDispute(OLD_DISPUTES).tokenId, 900 + OLD_DISPUTES - 1);
    }

    // ── deployer owns ContentProtection ──

    function test_CpOwnerDeployer_AuthorisesInTheSameRun() public {
        vm.prank(cpOwner);
        cp.transferOwnership(deployer);
        vm.prank(deployer);
        cp.acceptOwnership();

        DeployDisputeStack.DisputeStackResult memory r = _deploy(_inputs(), DEPLOYER_PK);
        assertTrue(r.stakeLockAuthoritySet);
        assertEq(cp.stakeLockAuthority(), address(r.disputeResolution));

        uint256 id = _report(r.curationRewards);
        assertEq(id, OLD_DISPUTES + 1);
        assertTrue(cp.stakeLocked(TOKEN));
    }

    function test_CpOwnerDeployer_DoesNotTakeOverAnotherLiveAuthority() public {
        address liveAuthority = makeAddr("liveAuthority");
        vm.startPrank(cpOwner);
        cp.setStakeLockAuthority(liveAuthority);
        cp.transferOwnership(deployer);
        vm.stopPrank();
        vm.prank(deployer);
        cp.acceptOwnership();

        DeployDisputeStack.DisputeStackResult memory r = _deploy(_inputs(), DEPLOYER_PK);
        assertFalse(r.stakeLockAuthoritySet);
        assertEq(r.stakeLockAuthorityBefore, liveAuthority);
        assertEq(cp.stakeLockAuthority(), liveAuthority, "an existing authority is left for the operator");
    }

    // ── inputs ──

    function test_Headroom_SkipsExtraIds() public {
        DeployDisputeStack.DisputeStackInputs memory inputs = _inputs();
        inputs.disputeIdHeadroom = 100;
        DeployDisputeStack.DisputeStackResult memory r = _deploy(inputs, DEPLOYER_PK);
        assertEq(r.disputeResolution.disputeIdOffset(), OLD_DISPUTES + 100);
    }

    function test_ExplicitInputsWinOverThePreviousStack() public {
        DeployDisputeStack.DisputeStackInputs memory inputs = _inputs();
        address treasury = makeAddr("newTreasury");
        address drOwner = makeAddr("newDrOwner");
        address crOwner = makeAddr("newCrOwner");
        inputs.treasury = treasury;
        inputs.disputeResolutionOwner = drOwner;
        inputs.curationRewardsOwner = crOwner;

        DeployDisputeStack.DisputeStackResult memory r = _deploy(inputs, DEPLOYER_PK);
        assertEq(r.curationRewards.treasury(), treasury);
        assertEq(r.disputeResolution.owner(), drOwner);
        assertEq(r.curationRewards.owner(), crOwner);
    }

    function test_FreshChain_NoPreviousStackStartsAtOneAndDeployerOwns() public {
        DeployDisputeStack.DisputeStackInputs memory inputs;
        inputs.contentProtection = address(cp);
        DeployDisputeStack.DisputeStackResult memory r = _deploy(inputs, DEPLOYER_PK);

        assertEq(r.disputeResolution.disputeIdOffset(), 0);
        assertEq(r.disputeResolution.owner(), deployer);
        assertEq(r.curationRewards.owner(), deployer);
        assertEq(r.curationRewards.treasury(), deployer, "local chains may default the treasury");
        assertEq(r.curationRewards.counterStakeBps(), 2000);
    }

    function test_RemoteChain_RequiresATreasury() public {
        vm.chainId(84532);
        DeployDisputeStack.DisputeStackInputs memory inputs;
        inputs.contentProtection = address(cp);
        vm.expectRevert(bytes("FEE_RECIPIENT is required (or PREVIOUS_CURATION_REWARDS_ADDRESS to reuse its treasury)"));
        script.resolveConfig(inputs, deployer);
    }

    function test_RejectsAContentProtectionWithoutStakeLocking() public {
        DeployDisputeStack.DisputeStackInputs memory inputs = _inputs();
        inputs.contentProtection = address(oldCr); // any contract without V7's surface
        vm.expectRevert(bytes("ContentProtection is not V7 (#1759): execute the V7 upgrade first"));
        script.resolveConfig(inputs, deployer);
    }

    function test_RejectsAMismatchedPreviousPair() public {
        DeployDisputeStack.DisputeStackInputs memory inputs = _inputs();
        inputs.previousCurationRewards = address(
            new CurationRewards(oldCrOwner, address(cp), address(new DisputeResolution(oldDrOwner, 0)), oldTreasury)
        );
        vm.expectRevert(bytes("previous CurationRewards is not wired to the previous DisputeResolution"));
        script.resolveConfig(inputs, deployer);
    }

    function test_RequiresContentProtection() public {
        DeployDisputeStack.DisputeStackInputs memory inputs;
        vm.expectRevert(bytes("CONTENT_PROTECTION_ADDRESS is required"));
        script.resolveConfig(inputs, deployer);
    }

    function test_PreviousWithoutJurorPool_CopiesNoJurorsButKeepsTheCounter() public {
        // A DisputeResolution older than the jury feature has no `jurorPool` getter.
        DeployDisputeStack.DisputeStackInputs memory inputs = _inputs();
        inputs.previousDisputeResolution = address(new LegacyDisputeResolutionMock(oldDrOwner, 12));
        inputs.previousCurationRewards = address(0);
        DeployDisputeStack.DisputeStackConfig memory config = script.resolveConfig(inputs, deployer);
        assertEq(config.jurors.length, 0);
        assertEq(config.previousDisputeCount, 12);
        assertEq(config.disputeIdOffset, 12);
        assertEq(config.disputeResolutionOwner, oldDrOwner);
        assertEq(config.counterStakeBps, 2000, "nothing to replicate without the previous CurationRewards");
    }
}
