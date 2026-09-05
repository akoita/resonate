// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical error for accounting paths that require an exact ERC-20 amount.
interface IFeeOnTransferGuard {
    error FeeOnTransferNotSupported(uint256 expected, uint256 received);
}
