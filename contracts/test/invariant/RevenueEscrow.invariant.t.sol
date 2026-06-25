// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";

/**
 * @title RevenueEscrow Invariant Handler
 * @notice Drives deposit / freeze / unfreeze / release / redirect across a fixed set of
 *         token ids and two assets (native + ERC20), tracking ghost accounting so the
 *         test can assert fund conservation and solvency (issue #943).
 *
 * The handler IS the escrow owner, so it can exercise the admin-only freeze/redirect
 * paths directly. Deposits are permissionless. Payouts always target EOAs, so native
 * transfers never spuriously revert.
 */
contract RevenueEscrowHandler is Test {
    RevenueEscrow internal escrow;
    MockUSDC internal usdc;

    address internal beneficiary = makeAddr("beneficiary");
    address internal recipient = makeAddr("recipient");

    uint256 internal constant ESCROW_PERIOD = 30 days;
    uint256[5] internal ids = [uint256(1), 2, 3, 4, 5];

    // Ghost accounting
    uint256 public gDepositedNative;
    uint256 public gPaidOutNative;
    uint256 public gDepositedAsset;
    uint256 public gPaidOutAsset;

    constructor(RevenueEscrow _escrow, MockUSDC _usdc) {
        escrow = _escrow;
        usdc = _usdc;
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return ids[seed % ids.length];
    }

    function depositNative(uint256 idSeed, uint256 amount) public {
        amount = bound(amount, 1, 1e24);
        vm.deal(address(this), address(this).balance + amount);
        escrow.deposit{value: amount}(_id(idSeed), beneficiary);
        gDepositedNative += amount;
    }

    function depositAsset(uint256 idSeed, uint256 amount) public {
        amount = bound(amount, 1, 1e15);
        usdc.mint(address(this), amount);
        usdc.approve(address(escrow), amount);
        escrow.depositWithAsset(_id(idSeed), beneficiary, address(usdc), amount);
        gDepositedAsset += amount;
    }

    function freeze(uint256 idSeed) public {
        try escrow.freeze(_id(idSeed)) {} catch {}
    }

    function unfreeze(uint256 idSeed) public {
        try escrow.unfreeze(_id(idSeed)) {} catch {}
    }

    function releaseNative(uint256 idSeed) public {
        uint256 id = _id(idSeed);
        (, uint256 bal,,) = escrow.getEscrow(id);
        try escrow.release(id) {
            gPaidOutNative += bal; // release pays the full balance on success
        } catch {}
    }

    function releaseAsset(uint256 idSeed) public {
        uint256 id = _id(idSeed);
        (, uint256 bal,,) = escrow.getEscrowAsset(id, address(usdc));
        try escrow.releaseAsset(id, address(usdc)) {
            gPaidOutAsset += bal;
        } catch {}
    }

    function redirectNative(uint256 idSeed) public {
        uint256 id = _id(idSeed);
        (, uint256 bal,,) = escrow.getEscrow(id);
        try escrow.redirect(id, recipient) {
            gPaidOutNative += bal;
        } catch {}
    }

    function redirectAsset(uint256 idSeed) public {
        uint256 id = _id(idSeed);
        (, uint256 bal,,) = escrow.getEscrowAsset(id, address(usdc));
        try escrow.redirectAsset(id, address(usdc), recipient) {
            gPaidOutAsset += bal;
        } catch {}
    }

    function advanceTime(uint256 dt) public {
        vm.warp(block.timestamp + bound(dt, 1, 60 days));
    }

    // Sum of outstanding per-token escrow balances (used by the invariant test).
    function sumNativeBalances() external view returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            (, uint256 bal,,) = escrow.getEscrow(ids[i]);
            total += bal;
        }
    }

    function sumAssetBalances() external view returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            (, uint256 bal,,) = escrow.getEscrowAsset(ids[i], address(usdc));
            total += bal;
        }
    }

    receive() external payable {}
}

/**
 * @title RevenueEscrow Invariant Tests
 * @notice Conservation and solvency of escrowed funds under arbitrary
 *         deposit/freeze/release/redirect sequences (issue #943).
 */
contract RevenueEscrowInvariantTest is Test {
    RevenueEscrow internal escrow;
    MockUSDC internal usdc;
    RevenueEscrowHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        // Deploy escrow owned by this test, then hand ownership to the handler so it can
        // drive the admin-only freeze/unfreeze/redirect paths directly.
        escrow = new RevenueEscrow(address(this), 30 days);
        handler = new RevenueEscrowHandler(escrow, usdc);
        escrow.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// Contract native balance always equals the sum of outstanding native escrow balances.
    function invariant_nativeBalanceMatchesOutstanding() public view {
        assertEq(
            address(escrow).balance,
            handler.sumNativeBalances(),
            "native: contract balance != sum of outstanding escrow balances"
        );
    }

    /// Contract ERC20 balance always equals the sum of outstanding asset escrow balances.
    function invariant_assetBalanceMatchesOutstanding() public view {
        assertEq(
            usdc.balanceOf(address(escrow)),
            handler.sumAssetBalances(),
            "asset: contract balance != sum of outstanding escrow balances"
        );
    }

    /// Conservation: deposited == paid out + still held (native).
    function invariant_nativeConservation() public view {
        assertEq(
            handler.gDepositedNative(),
            handler.gPaidOutNative() + address(escrow).balance,
            "native: deposited != paidOut + held"
        );
    }

    /// Conservation: deposited == paid out + still held (asset).
    function invariant_assetConservation() public view {
        assertEq(
            handler.gDepositedAsset(),
            handler.gPaidOutAsset() + usdc.balanceOf(address(escrow)),
            "asset: deposited != paidOut + held"
        );
    }
}
