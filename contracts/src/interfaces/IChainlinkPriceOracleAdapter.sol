// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IChainlinkPriceOracleAdapter
/// @notice Canonical shared surface (custom errors) for ChainlinkPriceOracleAdapter.
/// Production code and tests import this so the error contract has a single
/// definition. The Chainlink-feed read interface (AggregatorV3Interface) stays
/// local to the adapter: it is an external upstream standard, not Resonate's
/// own surface.
interface IChainlinkPriceOracleAdapter {
    // ============ Errors ============

    error InvalidFeed();
    error InvalidAnswer();
    error StaleAnswer();
    error IncompleteRound();
}
