// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical errors for native-token transfer and value handling.
interface INativePayment {
    error TransferFailed();
    error UnexpectedETH();
}
