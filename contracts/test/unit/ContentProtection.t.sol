// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
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

    event ContentAttested(
        uint256 indexed tokenId,
        address indexed attester,
        bytes32 contentHash,
        bytes32 fingerprintHash,
        string metadataURI
    );
    event StakeDeposited(uint256 indexed tokenId, address indexed staker, uint256 amount);
    event StakeSlashed(
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );
    event StakeRefunded(uint256 indexed tokenId, address indexed staker, uint256 amount);
    event Blacklisted(address indexed account);
    event BlacklistRemoved(address indexed account);
    event RegistrarUpdated(address indexed registrar, bool allowed);
    event MaxPriceMultiplierUpdated(
        uint256 oldMultiplier,
        uint256 newMultiplier
    );
    event TrackRegistered(uint256 indexed releaseId, uint256 indexed trackId);
    event StemRegistered(uint256 indexed trackId, uint256 indexed stemTokenId);
    event StemProtectionRootRegistered(
        uint256 indexed releaseId,
        uint256 indexed stemTokenId
    );
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
}
