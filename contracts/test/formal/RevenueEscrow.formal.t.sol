// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title RevenueEscrow Formal Verification Tests
 * @notice Halmos-style symbolic checks for the core custody safety properties (issue #944).
 * @dev Run with: halmos --contract RevenueEscrowFormalTest
 *      Also runs under `forge test` as bounded property tests.
 *
 * Checks the hardest-to-exhaust properties on the ERC20 escrow path:
 *   1. Release after expiry pays the beneficiary exactly the deposit (conservation).
 *   2. Frozen escrows cannot be released, only redirected.
 *   3. Release before expiry always reverts.
 *   4. Redirect requires a frozen escrow and pays the recipient exactly.
 */
contract RevenueEscrowFormalTest is Test, SymTest {
    RevenueEscrow public escrow;
    MockUSDC public usdc;

    address public owner = address(0x1000);
    address public beneficiary = address(0x2000);
    address public recipient = address(0x3000);
    address public depositor = address(0x4000);

    uint256 public constant PERIOD = 30 days;

    function setUp() public {
        escrow = new RevenueEscrow(owner, PERIOD);
        usdc = new MockUSDC();
    }

    function _deposit(uint256 tokenId, uint256 amount) internal {
        usdc.mint(depositor, amount);
        vm.startPrank(depositor);
        usdc.approve(address(escrow), amount);
        escrow.depositWithAsset(tokenId, beneficiary, address(usdc), amount);
        vm.stopPrank();
    }

    /// Release after expiry pays the beneficiary exactly the deposit; escrow drains to zero.
    function check_releaseAssetConservesDeposit(uint256 tokenId, uint256 amount) public {
        vm.assume(amount > 0 && amount <= 1e30);
        _deposit(tokenId, amount);

        vm.warp(block.timestamp + PERIOD);
        escrow.releaseAsset(tokenId, address(usdc));

        assert(usdc.balanceOf(beneficiary) == amount);
        (, uint256 bal,,) = escrow.getEscrowAsset(tokenId, address(usdc));
        assert(bal == 0);
        assert(usdc.balanceOf(address(escrow)) == 0);
    }

    /// A frozen escrow cannot be released even after the period expires.
    function check_frozenAssetCannotRelease(uint256 tokenId, uint256 amount) public {
        vm.assume(amount > 0 && amount <= 1e30);
        _deposit(tokenId, amount);

        vm.prank(owner);
        escrow.freezeAsset(tokenId, address(usdc));
        vm.warp(block.timestamp + PERIOD + 1);

        vm.expectRevert(RevenueEscrow.EscrowIsFrozen.selector);
        escrow.releaseAsset(tokenId, address(usdc));
    }

    /// Release before the escrow period expires always reverts.
    function check_releaseBeforeExpiryReverts(uint256 tokenId, uint256 amount, uint256 wait) public {
        vm.assume(amount > 0 && amount <= 1e30);
        vm.assume(wait < PERIOD);
        _deposit(tokenId, amount);

        vm.warp(block.timestamp + wait);
        vm.expectRevert(RevenueEscrow.EscrowNotExpired.selector);
        escrow.releaseAsset(tokenId, address(usdc));
    }

    /// Redirect requires a frozen escrow.
    function check_redirectAssetRequiresFrozen(uint256 tokenId, uint256 amount) public {
        vm.assume(amount > 0 && amount <= 1e30);
        _deposit(tokenId, amount);

        vm.prank(owner);
        vm.expectRevert(RevenueEscrow.EscrowNotFrozen.selector);
        escrow.redirectAsset(tokenId, address(usdc), recipient);
    }

    /// Redirecting a frozen escrow pays the recipient exactly and clears the balance.
    function check_redirectAssetConservesDeposit(uint256 tokenId, uint256 amount) public {
        vm.assume(amount > 0 && amount <= 1e30);
        _deposit(tokenId, amount);

        vm.prank(owner);
        escrow.freezeAsset(tokenId, address(usdc));
        vm.prank(owner);
        escrow.redirectAsset(tokenId, address(usdc), recipient);

        assert(usdc.balanceOf(recipient) == amount);
        (address benef, uint256 bal,, bool frozen) = escrow.getEscrowAsset(tokenId, address(usdc));
        assert(bal == 0);
        assert(!frozen);
        assert(benef == recipient);
    }
}
