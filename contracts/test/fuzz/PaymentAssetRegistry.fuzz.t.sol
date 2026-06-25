// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {ChainlinkPriceOracleAdapter} from "../../src/payments/ChainlinkPriceOracleAdapter.sol";
import {MockPriceOracle} from "../../src/payments/MockPriceOracle.sol";

/**
 * @title PaymentAssetRegistry & Oracle Adapter Fuzz Tests
 * @notice Property-based coverage for asset-configuration bounds, unsupported-asset
 *         behavior, and price-oracle staleness/scaling (issue #943).
 */
contract PaymentAssetRegistryFuzzTest is Test {
    PaymentAssetRegistry internal registry;
    address internal owner = makeAddr("owner");

    function setUp() public {
        registry = new PaymentAssetRegistry(owner);
    }

    // ----------------------------------------------------------------------
    // Registry configuration
    // ----------------------------------------------------------------------

    function testFuzz_ConfigureAndReadBack(bytes32 assetId, address token, uint8 decimals, bool enabled, bool stable)
        public
    {
        vm.assume(assetId != bytes32(0));
        vm.assume(token != address(0));

        vm.prank(owner);
        registry.configureAsset(assetId, token, "TKN", decimals, enabled, stable);

        PaymentAssetRegistry.PaymentAsset memory a = registry.getAssetByToken(token);
        assertEq(a.assetId, assetId, "assetId round-trips");
        assertEq(a.token, token, "token round-trips");
        assertEq(a.decimals, decimals, "decimals round-trip");
        assertEq(a.enabled, enabled, "enabled round-trips");
        assertEq(a.isStablecoin, stable, "isStablecoin round-trips");
        assertEq(registry.isTokenEnabled(token), enabled, "isTokenEnabled reflects enabled flag");
    }

    function testFuzz_OnlyOwnerConfigures(address caller, bytes32 assetId, address token) public {
        vm.assume(caller != owner);
        vm.assume(assetId != bytes32(0) && token != address(0));

        vm.prank(caller);
        vm.expectRevert();
        registry.configureAsset(assetId, token, "TKN", 18, true, false);
    }

    function testFuzz_UnknownAssetReverts(bytes32 assetId, address token) public {
        vm.assume(assetId != bytes32(0) && token != address(0));
        // nothing configured
        vm.expectRevert();
        registry.getAsset(assetId);
        vm.expectRevert();
        registry.getAssetByToken(token);
    }

    function testFuzz_UnknownTokenNotEnabled(address token) public view {
        // An unconfigured token is never reported enabled.
        assertFalse(registry.isTokenEnabled(token), "unconfigured token must not be enabled");
    }

    function testFuzz_DuplicateTokenDifferentIdReverts(bytes32 idA, bytes32 idB, address token) public {
        vm.assume(token != address(0));
        vm.assume(idA != bytes32(0) && idB != bytes32(0) && idA != idB);

        vm.startPrank(owner);
        registry.configureAsset(idA, token, "TKN", 18, true, false);
        vm.expectRevert();
        registry.configureAsset(idB, token, "TKN", 18, true, false);
        vm.stopPrank();
    }

    function testFuzz_DisabledAssetNotEnabled(bytes32 assetId, address token) public {
        vm.assume(assetId != bytes32(0) && token != address(0));
        vm.prank(owner);
        registry.configureAsset(assetId, token, "TKN", 18, false, false);
        assertFalse(registry.isTokenEnabled(token), "disabled asset must not be enabled");
    }

    // ----------------------------------------------------------------------
    // Oracle adapter — scaling & safety
    // ----------------------------------------------------------------------

    function testFuzz_ScaleTo18(uint256 rawAnswer, uint8 decimals) public {
        uint256 answer = bound(rawAnswer, 1, 1e30);
        uint8 dec = uint8(bound(uint256(decimals), 0, 30));

        MockPriceOracle feed = new MockPriceOracle("X / USD", dec, int256(answer));
        ChainlinkPriceOracleAdapter adapter = new ChainlinkPriceOracleAdapter(address(feed), 1 hours);

        (uint256 price,) = adapter.latestPrice();

        uint256 expected;
        if (dec == 18) {
            expected = answer;
        } else if (dec < 18) {
            expected = answer * (10 ** (18 - dec));
        } else {
            expected = answer / (10 ** (dec - 18));
        }
        assertEq(price, expected, "price scaled to 18 decimals");
    }

    function testFuzz_StalePriceReverts(uint256 rawAnswer, uint256 staleness, uint256 jump) public {
        uint256 answer = bound(rawAnswer, 1, 1e30);
        uint256 maxStaleness = bound(staleness, 1, 365 days);
        uint256 over = bound(jump, 1, 365 days);

        MockPriceOracle feed = new MockPriceOracle("X / USD", 8, int256(answer));
        ChainlinkPriceOracleAdapter adapter = new ChainlinkPriceOracleAdapter(address(feed), maxStaleness);

        // Move past the staleness window since the feed's updatedAt was set at construction.
        vm.warp(block.timestamp + maxStaleness + over);

        vm.expectRevert(ChainlinkPriceOracleAdapter.StaleAnswer.selector);
        adapter.latestPrice();
    }

    function testFuzz_IncompleteRoundReverts(uint256 rawAnswer) public {
        uint256 answer = bound(rawAnswer, 1, 1e30);
        MockPriceOracle feed = new MockPriceOracle("X / USD", 8, int256(answer));
        ChainlinkPriceOracleAdapter adapter = new ChainlinkPriceOracleAdapter(address(feed), 1 hours);

        feed.setAnsweredInRound(0); // < roundId (1)

        vm.expectRevert(ChainlinkPriceOracleAdapter.IncompleteRound.selector);
        adapter.latestPrice();
    }

    function testFuzz_NonPositiveAnswerReverts(int256 rawAnswer) public {
        int256 answer = rawAnswer > 0 ? -rawAnswer : rawAnswer; // <= 0
        MockPriceOracle feed = new MockPriceOracle("X / USD", 8, answer);
        ChainlinkPriceOracleAdapter adapter = new ChainlinkPriceOracleAdapter(address(feed), 1 hours);

        vm.expectRevert(ChainlinkPriceOracleAdapter.InvalidAnswer.selector);
        adapter.latestPrice();
    }

    function testFuzz_InvalidFeedConstructorReverts(uint256 staleness) public {
        MockPriceOracle feed = new MockPriceOracle("X / USD", 8, 1e8);

        // zero feed address
        vm.expectRevert(ChainlinkPriceOracleAdapter.InvalidFeed.selector);
        new ChainlinkPriceOracleAdapter(address(0), bound(staleness, 1, 365 days));

        // zero staleness
        vm.expectRevert(ChainlinkPriceOracleAdapter.InvalidFeed.selector);
        new ChainlinkPriceOracleAdapter(address(feed), 0);
    }
}
