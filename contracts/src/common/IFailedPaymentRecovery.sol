// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical surface for contracts that escrow a failed outbound
/// payment and let its recipient pull the funds later.
interface IFailedPaymentRecovery {
    event PaymentEscrowed(address indexed token, address indexed recipient, uint256 amount);
    event FailedPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);

    error NothingToClaim();
    error OnlySelf();
}
