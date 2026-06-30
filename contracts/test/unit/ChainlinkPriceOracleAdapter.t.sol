// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChainlinkPriceOracleAdapter} from "../../src/payments/ChainlinkPriceOracleAdapter.sol";
import {IChainlinkPriceOracleAdapter} from "../../src/interfaces/IChainlinkPriceOracleAdapter.sol";
import {MockPriceOracle} from "../../src/payments/MockPriceOracle.sol";

contract ChainlinkPriceOracleAdapterTest is Test {
    MockPriceOracle private feed;
    ChainlinkPriceOracleAdapter private adapter;

    function setUp() public {
        feed = new MockPriceOracle("ETH / USD", 8, 3000e8);
        adapter = new ChainlinkPriceOracleAdapter(address(feed), 1 hours);
    }

    function testLatestPriceScalesValidAnswerTo18Decimals() public view {
        (uint256 price, uint256 updatedAt) = adapter.latestPrice();

        assertEq(price, 3000e18);
        assertEq(updatedAt, block.timestamp);
        assertEq(adapter.description(), "ETH / USD");
    }

    function testRevertsOnStaleAnswer() public {
        vm.warp(10 hours);
        feed.setUpdatedAt(block.timestamp - 2 hours);

        vm.expectRevert(IChainlinkPriceOracleAdapter.StaleAnswer.selector);
        adapter.latestPrice();
    }

    function testRevertsOnZeroAnswer() public {
        feed.setAnswer(0);

        vm.expectRevert(IChainlinkPriceOracleAdapter.InvalidAnswer.selector);
        adapter.latestPrice();
    }

    function testRevertsOnNegativeAnswer() public {
        feed.setAnswer(-1);

        vm.expectRevert(IChainlinkPriceOracleAdapter.InvalidAnswer.selector);
        adapter.latestPrice();
    }

    function testRevertsOnIncompleteRound() public {
        feed.setAnswer(3100e8);
        feed.setAnsweredInRound(1);

        vm.expectRevert(IChainlinkPriceOracleAdapter.IncompleteRound.selector);
        adapter.latestPrice();
    }
}
