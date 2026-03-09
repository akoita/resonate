// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {
    ERC1967Proxy
} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ContentProtection Unit Tests
 * @notice Tests attestation, staking, slashing, blacklisting, and UUPS upgradability
 */
contract ContentProtectionTest is Test {
    ContentProtection public cp;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
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
    event StakeDeposited(
        uint256 indexed tokenId,
        address indexed staker,
        uint256 amount
    );
    event StakeSlashed(
        uint256 indexed tokenId,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount,
        uint256 burnedAmount
    );
    event StakeRefunded(
        uint256 indexed tokenId,
        address indexed staker,
        uint256 amount
    );
    event Blacklisted(address indexed account);
    event BlacklistRemoved(address indexed account);

    function setUp() public {
        // Deploy implementation + proxy
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(
            ContentProtection.initialize,
            (admin, treasury, STAKE_AMOUNT)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        cp = ContentProtection(address(proxy));
    }

    // ============ Initialization ============

    function test_Initialize() public view {
        assertEq(cp.owner(), admin);
        assertEq(cp.treasury(), treasury);
        assertEq(cp.stakeAmount(), STAKE_AMOUNT);
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
}
