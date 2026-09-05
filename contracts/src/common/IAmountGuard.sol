// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical error for shared non-zero-amount preconditions.
interface IAmountGuard {
    error ZeroAmount();
}
