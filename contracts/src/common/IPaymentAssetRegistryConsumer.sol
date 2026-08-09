// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical event for contracts whose accepted payment assets are
/// controlled by an external registry.
interface IPaymentAssetRegistryConsumer {
    event PaymentAssetRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
}
