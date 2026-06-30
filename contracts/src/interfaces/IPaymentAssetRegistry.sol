// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPaymentAssetRegistry
/// @notice Canonical shared surface (struct, events) for PaymentAssetRegistry.
/// `PaymentAsset` is the public return type of getAsset/getAssetByToken and is
/// consumed by tests, the marketplace, and indexers, so it lives here. The
/// registry guards admin calls with require-strings (not custom errors), which
/// stay local to avoid changing revert data.
interface IPaymentAssetRegistry {
    // ============ Structs ============

    struct PaymentAsset {
        bytes32 assetId;
        address token;
        uint8 decimals;
        bool enabled;
        bool isStablecoin;
        string symbol;
    }

    // ============ Events ============

    event AssetConfigured(
        bytes32 indexed assetId, address indexed token, string symbol, uint8 decimals, bool enabled, bool isStablecoin
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
