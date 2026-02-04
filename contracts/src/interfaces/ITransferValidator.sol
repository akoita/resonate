// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ITransferValidator
 * @notice Interface for transfer validation module
 * @dev Plug into NFT contracts to enforce royalty-compliant transfers
 */
interface ITransferValidator {
    /// @notice Validate a transfer
    /// @param caller The address initiating the transfer (operator or owner)
    /// @param from The sender
    /// @param to The recipient
    /// @return True if transfer is allowed
    function validateTransfer(address caller, address from, address to) external view returns (bool);

    /// @notice Check if an operator is whitelisted
    function isWhitelistedOperator(address operator) external view returns (bool);

    /// @notice Check if a marketplace is whitelisted
    function isWhitelistedMarketplace(address marketplace) external view returns (bool);
}
