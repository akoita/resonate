// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title RevenueEscrow Formal Verification Tests
 * @notice Halmos symbolic checks for the custody conservation properties (issue #944).
 * @dev Run with: halmos --contract RevenueEscrowFormalTest
 *
 * The formal layer holds only the positive conservation properties that Halmos
 * verifies cleanly. The revert-path properties (frozen-blocks-release,
 * release-before-expiry, redirect-requires-frozen) use `vm.expectRevert`, which
 * Halmos does not support; they are covered by the fuzz/unit suites and the
 * Certora spec's with-revert rules.
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
        vm.prank(owner);
        escrow.setDepositor(depositor, true);
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
