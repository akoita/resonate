// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemNFT} from "../src/core/StemNFT.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DisputeResolution} from "../src/core/DisputeResolution.sol";
import {CurationRewards} from "../src/core/CurationRewards.sol";
import {TransferValidator} from "../src/modules/TransferValidator.sol";
import {PaymentAssetRegistry} from "../src/payments/PaymentAssetRegistry.sol";
import {ChainlinkPriceOracleAdapter} from "../src/payments/ChainlinkPriceOracleAdapter.sol";
import {ContentProtectionDeployment} from "./ContentProtectionDeployment.s.sol";
import {RevenueEscrowDeployment} from "./RevenueEscrowDeployment.s.sol";
import {StemMarketplaceDeployment} from "./StemMarketplaceDeployment.s.sol";

/**
 * @title DeployProtocol
 * @notice Deploys the Resonate Protocol (modular architecture)
 *
 * Deployment order:
 *   1. TransferValidator (optional module)
 *   2. ContentProtection (UUPS proxy)
 *   3. DisputeResolution
 *   4. CurationRewards
 *   5. RevenueEscrow
 *   6. StemNFT (core)
 *   7. StemMarketplaceV2 (core)
 *   8. Configure: link modules, whitelist marketplace
 *
 * Run:
 *   forge script script/DeployProtocol.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployProtocol is ContentProtectionDeployment, RevenueEscrowDeployment, StemMarketplaceDeployment {
    bytes32 private constant BASE_SEPOLIA_ETH = keccak256("base-sepolia:eth");
    bytes32 private constant BASE_SEPOLIA_USDC = keccak256("base-sepolia:usdc");
    bytes32 private constant BASE_SEPOLIA_WETH = keccak256("base-sepolia:weth");

    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);

        // Config
        string memory baseUri = vm.envOr("BASE_URI", string("https://api.resonate.fm/metadata/"));
        // Fee recipient may default to the deployer only on local chains; remote
        // deployments must name the platform wallet explicitly (mirrors
        // DeployShowCampaignEscrow).
        address feeRecipient;
        if (block.chainid == 31337 || block.chainid == 1337) {
            feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        } else {
            feeRecipient = vm.envAddress("FEE_RECIPIENT");
        }
        address mintAuthorizer = vm.envOr("MINT_AUTHORIZER_ADDRESS", deployer);
        uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(1000)); // 10% — ADR-BM-2
        uint256 stakeAmountWei = vm.envOr("STAKE_AMOUNT", uint256(0.005 ether)); // Default 0.005 ETH
        RevenueEscrowConfig memory revenueEscrowConfig = _revenueEscrowConfig(deployer);
        StemMarketplaceConfig memory marketplaceConfig = _stemMarketplaceConfig(deployer);
        ContentProtectionConfig memory contentProtectionConfig = _contentProtectionConfig(deployer);
        address usdcAddress = vm.envOr("PAYMENT_USDC_ADDRESS", address(0));
        address wethAddress = vm.envOr("PAYMENT_WETH_ADDRESS", address(0));
        bool enableWeth = vm.envOr("PAYMENT_ENABLE_WETH", false);
        address ethUsdFeed = vm.envOr("PAYMENT_ETH_USD_FEED", address(0));
        address usdcUsdFeed = vm.envOr("PAYMENT_USDC_USD_FEED", address(0));
        uint256 oracleMaxStaleness = vm.envOr("PAYMENT_ORACLE_MAX_STALENESS", uint256(1 days));
        uint256 usdcStakeAmount = vm.envOr("STAKE_USDC_AMOUNT", uint256(5_000000)); // Default 5 USDC

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Resonate Protocol (Modular) ===");
        console.log("Deployer:", deployer);
        console.log("");

        // 1. Deploy TransferValidator (optional module)
        TransferValidator validator = new TransferValidator();
        console.log("TransferValidator:", address(validator));

        // 2. Deploy ContentProtection (UUPS proxy)
        ContentProtectionDeploymentResult memory contentProtectionDeployment =
            _deployContentProtection(deployer, contentProtectionConfig, feeRecipient, stakeAmountWei);
        ContentProtection contentProtection = contentProtectionDeployment.contentProtection;
        console.log("ContentProtection implementation:", address(contentProtectionDeployment.implementation));
        console.log("ContentProtection timelock:", address(contentProtectionDeployment.timelock));
        console.log("ContentProtection (proxy):", address(contentProtection));

        // 3. Deploy DisputeResolution
        DisputeResolution disputeResolution = new DisputeResolution(deployer);
        console.log("DisputeResolution:", address(disputeResolution));

        // 4. Deploy CurationRewards
        CurationRewards curationRewards =
            new CurationRewards(deployer, address(contentProtection), address(disputeResolution), feeRecipient);
        console.log("CurationRewards:", address(curationRewards));

        // 5. Deploy RevenueEscrow UUPS graph
        RevenueEscrowDeploymentResult memory revenueEscrowDeployment =
            _deployRevenueEscrow(deployer, revenueEscrowConfig);
        console.log("RevenueEscrow implementation:", address(revenueEscrowDeployment.implementation));
        console.log("RevenueEscrow timelock:", address(revenueEscrowDeployment.timelock));
        console.log("RevenueEscrow (proxy):", address(revenueEscrowDeployment.escrow));

        // 6. Deploy StemNFT (core)
        StemNFT stemNFT = new StemNFT(baseUri);
        console.log("StemNFT:", address(stemNFT));

        // 7. Deploy payment asset registry
        PaymentAssetRegistry paymentAssetRegistry = new PaymentAssetRegistry(deployer);
        paymentAssetRegistry.configureAsset(BASE_SEPOLIA_ETH, address(0), "ETH", 18, true, false);
        if (usdcAddress != address(0)) {
            paymentAssetRegistry.configureAsset(BASE_SEPOLIA_USDC, usdcAddress, "USDC", 6, true, true);
        }
        if (wethAddress != address(0)) {
            paymentAssetRegistry.configureAsset(BASE_SEPOLIA_WETH, wethAddress, "WETH", 18, enableWeth, false);
        }
        console.log("PaymentAssetRegistry:", address(paymentAssetRegistry));
        console.log("  -> ETH enabled for native marketplace payments");
        console.log("  -> USDC:", usdcAddress);
        console.log("  -> WETH:", wethAddress, "enabled:", enableWeth);
        contentProtection.setPaymentAssetRegistry(address(paymentAssetRegistry));
        console.log("  -> ContentProtection linked to PaymentAssetRegistry");
        if (usdcAddress != address(0)) {
            contentProtection.setStakeAmountForAsset(usdcAddress, usdcStakeAmount);
            console.log("  -> USDC stake amount:", usdcStakeAmount);
        }

        address ethUsdAdapter = address(0);
        address usdcUsdAdapter = address(0);
        if (ethUsdFeed != address(0)) {
            ethUsdAdapter = address(new ChainlinkPriceOracleAdapter(ethUsdFeed, oracleMaxStaleness));
        }
        if (usdcUsdFeed != address(0)) {
            usdcUsdAdapter = address(new ChainlinkPriceOracleAdapter(usdcUsdFeed, oracleMaxStaleness));
        }
        console.log("ETH/USD Oracle Adapter:", ethUsdAdapter);
        console.log("USDC/USD Oracle Adapter:", usdcUsdAdapter);

        // 8. Deploy StemMarketplaceV2 guarded UUPS graph
        StemMarketplaceDeploymentResult memory marketplaceDeployment = _deployStemMarketplace(
            deployer,
            marketplaceConfig,
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            feeRecipient,
            protocolFeeBps
        );
        console.log("StemMarketplaceV2 implementation:", address(marketplaceDeployment.implementation));
        console.log("StemMarketplaceV2 timelock:", address(marketplaceDeployment.timelock));
        console.log("StemMarketplaceV2 (proxy):", address(marketplaceDeployment.marketplace));

        // 9. Configure
        stemNFT.setTransferValidator(address(validator));
        console.log("  -> Validator linked to StemNFT");

        if (mintAuthorizer != deployer) {
            stemNFT.grantRole(stemNFT.MINT_AUTHORIZER_ROLE(), mintAuthorizer);
            console.log("  -> Mint authorizer granted:", mintAuthorizer);
        }

        stemNFT.setContentProtection(address(contentProtection));
        console.log("  -> ContentProtection linked to StemNFT");

        contentProtection.setRegistrar(address(stemNFT), true);
        console.log("  -> StemNFT granted ContentProtection registrar role");

        contentProtection.setRegistrar(address(marketplaceDeployment.marketplace), true);
        console.log("  -> Marketplace granted ContentProtection registrar role");

        validator.setWhitelist(address(marketplaceDeployment.marketplace), true);
        console.log("  -> Marketplace whitelisted in validator");

        validator.setContentProtection(address(contentProtection));
        console.log("  -> ContentProtection linked to TransferValidator");

        if (revenueEscrowConfig.owner == deployer) {
            revenueEscrowDeployment.escrow.setContentProtection(address(contentProtection));
            console.log("  -> ContentProtection linked to RevenueEscrow");
        } else {
            console.log("  -> RevenueEscrow owner must link ContentProtection after deployment");
        }

        if (contentProtectionConfig.owner != deployer) {
            contentProtection.transferOwnership(contentProtectionConfig.owner);
            console.log("  -> ContentProtection ownership transfer pending:", contentProtectionConfig.owner);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("");
        console.log("Core Contracts:");
        console.log("  StemNFT:", address(stemNFT));
        console.log("  StemMarketplaceV2 (proxy):", address(marketplaceDeployment.marketplace));
        console.log("  StemMarketplaceV2 implementation:", address(marketplaceDeployment.implementation));
        console.log("  StemMarketplaceV2 timelock:", address(marketplaceDeployment.timelock));
        console.log("  PaymentAssetRegistry:", address(paymentAssetRegistry));
        console.log("");
        console.log("Content Protection:");
        console.log("  ContentProtection (proxy):", address(contentProtection));
        console.log("  ContentProtection implementation:", address(contentProtectionDeployment.implementation));
        console.log("  ContentProtection timelock:", address(contentProtectionDeployment.timelock));
        console.log("  DisputeResolution:", address(disputeResolution));
        console.log("  CurationRewards:", address(curationRewards));
        console.log("  RevenueEscrow (proxy):", address(revenueEscrowDeployment.escrow));
        console.log("  RevenueEscrow implementation:", address(revenueEscrowDeployment.implementation));
        console.log("  RevenueEscrow timelock:", address(revenueEscrowDeployment.timelock));
        console.log("");
        console.log("Modules:");
        console.log("  TransferValidator:", address(validator));
        console.log("");
        console.log("Config:");
        console.log("  Protocol Fee:", protocolFeeBps, "bps");
        console.log("  Fee Recipient:", feeRecipient);
        console.log("  Mint Authorizer:", mintAuthorizer);
        console.log("  Stake Amount:", stakeAmountWei, "wei");
        console.log("  Escrow Period:", revenueEscrowConfig.escrowPeriod, "seconds");
        console.log("  RevenueEscrow owner:", revenueEscrowConfig.owner);
        console.log("  RevenueEscrow guardian:", revenueEscrowConfig.guardian);
        console.log("  RevenueEscrow timelock delay:", revenueEscrowConfig.timelockMinDelay, "seconds");
        console.log("  ContentProtection owner:", contentProtectionConfig.owner);
        console.log("  ContentProtection guardian:", contentProtectionConfig.guardian);
        console.log("  ContentProtection timelock delay:", contentProtectionConfig.timelockMinDelay, "seconds");
        console.log("  Marketplace owner:", marketplaceConfig.owner);
        console.log("  Marketplace guardian:", marketplaceConfig.guardian);
        console.log("  Marketplace timelock delay:", marketplaceConfig.timelockMinDelay, "seconds");
    }
}
