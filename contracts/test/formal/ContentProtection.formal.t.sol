// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";

/**
 * @title ContentProtection Formal Verification Tests
 * @notice Halmos symbolic checks for the slash-distribution and refund custody
 *         arithmetic on the ERC20 stake path (issue #944).
 * @dev Run with: halmos --contract ContentProtectionFormalTest
 *
 * The ERC20 path is used so the prover can reason about exact token balances
 * (mirroring the project's other formal tests). Properties:
 *   1. Slash pays 60% reporter / 30% treasury and retains the 10% remainder;
 *      the three parts sum exactly to the stake.
 *   2. Refund returns the exact stake to the attester.
 */
contract ContentProtectionFormalTest is Test, SymTest {
    ContentProtection public cp;
    PaymentAssetRegistry public registry;
    MockUSDC public usdc;

    address public owner = address(0x1000);
    address public treasury = address(0x2000);
    address public attester = address(0x3000);
    address public reporter = address(0x4000);

    uint256 public constant MIN_STAKE = 1e6;
    uint256 public constant REPORTER_BPS = 6000;
    uint256 public constant TREASURY_BPS = 3000;
    uint256 public constant BPS = 10000;

    // Registrar signing attestation authorization vouchers (CP-1, #1271).
    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;

    function setUp() public {
        ContentProtection impl = new ContentProtection();
        bytes memory initData = abi.encodeCall(ContentProtection.initialize, (owner, treasury, 0.01 ether));
        cp = ContentProtection(address(new ERC1967Proxy(address(impl), initData)));

        usdc = new MockUSDC();
        registry = new PaymentAssetRegistry(owner);

        vm.startPrank(owner);
        registry.configureAsset(keccak256("local:usdc"), address(usdc), "USDC", 6, true, true);
        cp.setPaymentAssetRegistry(address(registry));
        cp.setStakeAmountForAsset(address(usdc), MIN_STAKE);
        cp.setRegistrar(vm.addr(REGISTRAR_PK), true);
        vm.stopPrank();
    }

    function _attestAndStakeAsset(uint256 tokenId, uint256 amount) internal {
        bytes memory sig = AttestationVoucher.sign(address(cp), REGISTRAR_PK, attester, tokenId, AUTH_DEADLINE);
        vm.prank(attester);
        cp.attest(tokenId, keccak256("content"), keccak256("fingerprint"), "ipfs://meta", AUTH_DEADLINE, sig);

        usdc.mint(attester, amount);
        vm.startPrank(attester);
        usdc.approve(address(cp), amount);
        cp.stakeWithAsset(tokenId, address(usdc), amount);
        vm.stopPrank();
    }

    /// Slash distributes 60/30 and retains the 10% remainder; the parts sum to the
    /// recorded stake. Staking any `amount >= MIN_STAKE` records only MIN_STAKE — the
    /// overpayment is never pulled (#1280) — so the slash conserves exactly MIN_STAKE
    /// regardless of how much the attester over-funded.
    function check_slashAssetConservesStake(uint256 tokenId, uint256 amount) public {
        vm.assume(amount >= MIN_STAKE && amount <= 1e24);
        _attestAndStakeAsset(tokenId, amount);

        uint256 staked = MIN_STAKE; // recorded stake, not the (possibly larger) sent amount

        vm.prank(owner);
        cp.slash(tokenId, reporter);

        uint256 expReporter = (staked * REPORTER_BPS) / BPS;
        uint256 expTreasury = (staked * TREASURY_BPS) / BPS;
        uint256 expBurned = staked - expReporter - expTreasury;

        assert(usdc.balanceOf(reporter) == expReporter);
        assert(usdc.balanceOf(treasury) == expTreasury);
        assert(usdc.balanceOf(address(cp)) == expBurned);
        assert(expReporter + expTreasury + expBurned == staked);
    }

    /// Refund returns the exact staked amount to the attester.
    function check_refundAssetReturnsStake(uint256 tokenId, uint256 amount) public {
        vm.assume(amount >= MIN_STAKE && amount <= 1e24);
        _attestAndStakeAsset(tokenId, amount);

        vm.prank(owner);
        cp.refundStake(tokenId);

        assert(usdc.balanceOf(attester) == amount);
        assert(usdc.balanceOf(address(cp)) == 0);
    }
}
