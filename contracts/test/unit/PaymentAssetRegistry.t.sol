// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {WrappedNativeMock} from "../../src/payments/WrappedNativeMock.sol";

contract PaymentAssetRegistryTest is Test {
    bytes32 private constant LOCAL_ETH = keccak256("local:eth");
    bytes32 private constant LOCAL_USDC = keccak256("local:usdc");

    address private owner = makeAddr("owner");
    address private other = makeAddr("other");
    PaymentAssetRegistry private registry;

    function setUp() public {
        registry = new PaymentAssetRegistry(owner);
    }

    function testOwnerCanConfigureNativeAndStablecoinAssets() public {
        MockUSDC usdc = new MockUSDC();

        vm.startPrank(owner);
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        vm.stopPrank();

        PaymentAssetRegistry.PaymentAsset memory ethAsset = registry.getAsset(LOCAL_ETH);
        assertEq(ethAsset.symbol, "ETH");
        assertEq(ethAsset.token, address(0));
        assertEq(ethAsset.decimals, 18);
        assertTrue(ethAsset.enabled);
        assertFalse(ethAsset.isStablecoin);

        PaymentAssetRegistry.PaymentAsset memory usdcAsset = registry.getAsset(LOCAL_USDC);
        assertEq(usdcAsset.symbol, "USDC");
        assertEq(usdcAsset.token, address(usdc));
        assertEq(usdcAsset.decimals, 6);
        assertTrue(usdcAsset.enabled);
        assertTrue(usdcAsset.isStablecoin);

        bytes32[] memory assetIds = registry.listAssetIds();
        assertEq(assetIds.length, 2);
        assertEq(assetIds[0], LOCAL_ETH);
        assertEq(assetIds[1], LOCAL_USDC);
    }

    function testNonOwnerCannotConfigureAsset() public {
        vm.prank(other);
        vm.expectRevert("PaymentAssetRegistry: not owner");
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
    }

    function testTokenLookupTracksEnabledAssets() public {
        MockUSDC usdc = new MockUSDC();

        vm.startPrank(owner);
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        vm.stopPrank();

        assertTrue(registry.isTokenEnabled(address(0)));
        assertTrue(registry.isTokenEnabled(address(usdc)));

        PaymentAssetRegistry.PaymentAsset memory usdcAsset = registry.getAssetByToken(address(usdc));
        assertEq(usdcAsset.assetId, LOCAL_USDC);
    }

    function testDisabledAssetIsNotTokenEnabled() public {
        MockUSDC usdc = new MockUSDC();

        vm.prank(owner);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, false, true);

        assertFalse(registry.isTokenEnabled(address(usdc)));
    }

    function testCannotConfigureDuplicateTokenForDifferentAsset() public {
        MockUSDC usdc = new MockUSDC();

        vm.startPrank(owner);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        vm.expectRevert("PaymentAssetRegistry: duplicate token");
        registry.configureAsset(LOCAL_ETH, address(usdc), "ETH", 18, true, false);
        vm.stopPrank();
    }

    function testMockUsdcUsesSixDecimals() public {
        MockUSDC usdc = new MockUSDC();
        usdc.mint(other, 123_000000);

        assertEq(usdc.decimals(), 6);
        assertEq(usdc.balanceOf(other), 123_000000);
    }

    function testWrappedNativeDepositAndWithdraw() public {
        WrappedNativeMock weth = new WrappedNativeMock();
        vm.deal(other, 2 ether);

        vm.prank(other);
        weth.deposit{value: 1 ether}();
        assertEq(weth.balanceOf(other), 1 ether);

        vm.prank(other);
        weth.withdraw(0.4 ether);
        assertEq(weth.balanceOf(other), 0.6 ether);
    }
}
