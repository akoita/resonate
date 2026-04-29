// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PaymentAssetRegistry
 * @notice Chain-local registry of assets enabled for Resonate payment surfaces.
 * @dev This first version is intentionally small so local dev and future
 *      protocol contracts can share the same asset identity without committing
 *      to the full marketplace V3 router yet.
 */
contract PaymentAssetRegistry {
    address public owner;

    struct PaymentAsset {
        bytes32 assetId;
        address token;
        uint8 decimals;
        bool enabled;
        bool isStablecoin;
        string symbol;
    }

    mapping(bytes32 => PaymentAsset) private assetsById;
    bytes32[] private assetIds;

    event AssetConfigured(
        bytes32 indexed assetId,
        address indexed token,
        string symbol,
        uint8 decimals,
        bool enabled,
        bool isStablecoin
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "PaymentAssetRegistry: not owner");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "PaymentAssetRegistry: zero owner");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PaymentAssetRegistry: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function configureAsset(
        bytes32 assetId,
        address token,
        string calldata symbol,
        uint8 decimals,
        bool enabled,
        bool isStablecoin
    ) external onlyOwner {
        require(assetId != bytes32(0), "PaymentAssetRegistry: empty asset id");
        require(bytes(symbol).length > 0, "PaymentAssetRegistry: empty symbol");

        if (assetsById[assetId].assetId == bytes32(0)) {
            assetIds.push(assetId);
        }

        assetsById[assetId] = PaymentAsset({
            assetId: assetId,
            token: token,
            decimals: decimals,
            enabled: enabled,
            isStablecoin: isStablecoin,
            symbol: symbol
        });

        emit AssetConfigured(assetId, token, symbol, decimals, enabled, isStablecoin);
    }

    function getAsset(bytes32 assetId) external view returns (PaymentAsset memory) {
        PaymentAsset memory asset = assetsById[assetId];
        require(asset.assetId != bytes32(0), "PaymentAssetRegistry: unknown asset");
        return asset;
    }

    function isEnabled(bytes32 assetId) external view returns (bool) {
        return assetsById[assetId].enabled;
    }

    function listAssetIds() external view returns (bytes32[] memory) {
        return assetIds;
    }
}
