// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockPriceOracle
 * @notice Minimal Chainlink-like aggregator for deterministic local quotes.
 */
contract MockPriceOracle {
    int256 private answer;
    uint8 public immutable decimals;
    string public description;
    uint256 public version = 1;
    uint80 private roundId = 1;
    uint256 private updatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(string memory description_, uint8 decimals_, int256 initialAnswer) {
        description = description_;
        decimals = decimals_;
        _setAnswer(initialAnswer);
    }

    function setAnswer(int256 nextAnswer) external {
        roundId += 1;
        _setAnswer(nextAnswer);
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }

    function _setAnswer(int256 nextAnswer) private {
        answer = nextAnswer;
        updatedAt = block.timestamp;
        emit AnswerUpdated(nextAnswer, roundId, updatedAt);
    }
}
