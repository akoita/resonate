// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ContentProtection Invariant Handler
 * @notice Drives stake / slash / refund across a fixed set of pre-attested tokens,
 *         tracking ghost accounting for fund-conservation invariants (issue #943).
 *
 * The handler IS the ContentProtection owner, so it can drive the admin-only
 * slash/refund paths. Each token has a dedicated attester (one attestation + one
 * active stake per token). Reporter/treasury/attesters are EOAs so native payouts
 * never spuriously revert.
 */
contract ContentProtectionHandler is Test {
    ContentProtection public cp;

    address internal treasury = makeAddr("cp_treasury");
    address internal reporter = makeAddr("cp_reporter");

    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant REPORTER_BPS = 6000;
    uint256 internal constant TREASURY_BPS = 3000;
    uint256 internal constant BPS = 10000;

    uint256[5] internal tokens = [uint256(1), 2, 3, 4, 5];
    address[5] internal attesters;

    // Ghost accounting
    uint256 public gDeposited;
    uint256 public gRefunded;
    uint256 public gSlashPaid; // reporter + treasury
    uint256 public gBurned;

    constructor() {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (address(this), treasury, STAKE_AMOUNT));
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));

        for (uint256 i; i < tokens.length; ++i) {
            attesters[i] = makeAddr(string(abi.encodePacked("cp_attester_", vm.toString(i))));
            vm.prank(attesters[i]);
            cp.attest(tokens[i], keccak256("content"), keccak256("fingerprint"), "ipfs://meta");
        }
    }

    function _idx(uint256 seed) internal view returns (uint256) {
        return seed % tokens.length;
    }

    function doStake(uint256 seed, uint256 amountSeed) public {
        uint256 i = _idx(seed);
        uint256 amount = bound(amountSeed, STAKE_AMOUNT, 100 ether);
        vm.deal(attesters[i], amount);
        vm.prank(attesters[i]);
        try cp.stake{value: amount}(tokens[i]) {
            gDeposited += amount;
        } catch {}
    }

    function doRefund(uint256 seed) public {
        uint256 i = _idx(seed);
        (uint256 amount,, bool active) = cp.stakes(tokens[i]);
        if (!active) return;
        try cp.refundStake(tokens[i]) {
            gRefunded += amount;
        } catch {}
    }

    function doSlash(uint256 seed) public {
        uint256 i = _idx(seed);
        (uint256 amount,, bool active) = cp.stakes(tokens[i]);
        if (!active) return;
        uint256 reporterAmount = (amount * REPORTER_BPS) / BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / BPS;
        uint256 burned = amount - reporterAmount - treasuryAmount;
        try cp.slash(tokens[i], reporter) {
            gSlashPaid += reporterAmount + treasuryAmount;
            gBurned += burned;
        } catch {}
    }
}

/**
 * @title ContentProtection Invariant Tests
 * @notice Conservation of staked funds under arbitrary stake/slash/refund sequences (#943).
 */
contract ContentProtectionInvariantTest is Test {
    ContentProtectionHandler internal handler;

    function setUp() public {
        handler = new ContentProtectionHandler();
        targetContract(address(handler));
    }

    /// Every wei in is either still held, refunded, or paid out on slash — nothing is created or lost.
    function invariant_stakeConservation() public view {
        assertEq(
            address(handler.cp()).balance,
            handler.gDeposited() - handler.gRefunded() - handler.gSlashPaid(),
            "contract balance != deposited - refunded - slashPaid"
        );
    }

    /// Burned (retained) slash remainders never leave the contract.
    function invariant_burnedNeverLeaves() public view {
        assertGe(address(handler.cp()).balance, handler.gBurned(), "burned remainder must stay in the contract");
    }
}
