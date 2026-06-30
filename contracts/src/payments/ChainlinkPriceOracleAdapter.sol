// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IChainlinkPriceOracleAdapter} from "../interfaces/IChainlinkPriceOracleAdapter.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title ChainlinkPriceOracleAdapter
 * @notice Normalizes Chainlink-style price feeds to 18 decimals with basic safety checks.
 */
contract ChainlinkPriceOracleAdapter is IChainlinkPriceOracleAdapter {
    AggregatorV3Interface public immutable feed;
    uint256 public immutable maxStaleness;
    uint8 public immutable feedDecimals;

    constructor(address feed_, uint256 maxStaleness_) {
        if (feed_ == address(0) || maxStaleness_ == 0) revert InvalidFeed();
        feed = AggregatorV3Interface(feed_);
        feedDecimals = feed.decimals();
        maxStaleness = maxStaleness_;
    }

    function latestPrice() external view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer,, uint256 answerUpdatedAt, uint80 answeredInRound) = feed.latestRoundData();

        if (answer <= 0 || answerUpdatedAt == 0) revert InvalidAnswer();
        if (answeredInRound < roundId) revert IncompleteRound();
        if (block.timestamp > answerUpdatedAt + maxStaleness) revert StaleAnswer();

        // Cast is safe after rejecting non-positive answers above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return (_scaleTo18(uint256(answer)), answerUpdatedAt);
    }

    function description() external view returns (string memory) {
        return feed.description();
    }

    function _scaleTo18(uint256 value) private view returns (uint256) {
        if (feedDecimals == 18) return value;
        if (feedDecimals < 18) return value * (10 ** (18 - feedDecimals));
        return value / (10 ** (feedDecimals - 18));
    }
}
