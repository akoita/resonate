// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PaymentAssetRegistry} from "../src/payments/PaymentAssetRegistry.sol";
import {ChainlinkPriceOracleAdapter} from "../src/payments/ChainlinkPriceOracleAdapter.sol";
import {MockPriceOracle} from "../src/payments/MockPriceOracle.sol";
import {MockUSDC} from "../src/payments/MockUSDC.sol";
import {WrappedNativeMock} from "../src/payments/WrappedNativeMock.sol";

/**
 * @title DeployLocalPayments
 * @notice Deploys local-only payment dev contracts for Anvil.
 */
contract DeployLocalPayments is Script {
    bytes32 private constant LOCAL_ETH = keccak256("local:eth");
    bytes32 private constant LOCAL_USDC = keccak256("local:usdc");
    bytes32 private constant LOCAL_WETH = keccak256("local:weth");

    function run() external {
        uint256 deployerKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerKey);
        bool enableWeth = vm.envOr("PAYMENT_DEV_ENABLE_WETH", false);

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Local Payment Dev Contracts ===");
        console.log("Deployer:", deployer);

        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC:", address(usdc));

        MockPriceOracle ethUsd = new MockPriceOracle("ETH / USD", 8, 3000e8);
        console.log("Mock ETH/USD Oracle:", address(ethUsd));
        ChainlinkPriceOracleAdapter ethUsdAdapter = new ChainlinkPriceOracleAdapter(address(ethUsd), 1 hours);
        console.log("ETH/USD Oracle Adapter:", address(ethUsdAdapter));

        MockPriceOracle usdcUsd = new MockPriceOracle("USDC / USD", 8, 1e8);
        console.log("Mock USDC/USD Oracle:", address(usdcUsd));
        ChainlinkPriceOracleAdapter usdcUsdAdapter = new ChainlinkPriceOracleAdapter(address(usdcUsd), 1 hours);
        console.log("USDC/USD Oracle Adapter:", address(usdcUsdAdapter));

        PaymentAssetRegistry registry = new PaymentAssetRegistry(deployer);
        registry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        registry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        console.log("PaymentAssetRegistry:", address(registry));

        if (enableWeth) {
            WrappedNativeMock weth = new WrappedNativeMock();
            registry.configureAsset(LOCAL_WETH, address(weth), "WETH", 18, true, false);
            console.log("WrappedNativeMock:", address(weth));
        } else {
            console.log("WrappedNativeMock: disabled");
        }

        vm.stopBroadcast();
    }
}
