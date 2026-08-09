// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAddressGuard} from "../common/IAddressGuard.sol";
import {IFailedPaymentRecovery} from "../common/IFailedPaymentRecovery.sol";
import {IFeeOnTransferGuard} from "../common/IFeeOnTransferGuard.sol";
import {INativePayment} from "../common/INativePayment.sol";
import {IPausableGuard} from "../common/IPausableGuard.sol";
import {IPaymentAssetRegistryConsumer} from "../common/IPaymentAssetRegistryConsumer.sol";
import {IUpgradeAuthority} from "../common/IUpgradeAuthority.sol";

/// @title IStemMarketplaceV2
/// @notice Canonical shared surface (struct, events, errors) for StemMarketplaceV2.
/// Production code, tests, indexers, and the backend import this so the
/// listing/event/error contract cannot silently drift. `Listing` is the public
/// return type of `getListing`, so it lives here too.
interface IStemMarketplaceV2 is
    IAddressGuard,
    IFailedPaymentRecovery,
    IFeeOnTransferGuard,
    INativePayment,
    IPausableGuard,
    IPaymentAssetRegistryConsumer,
    IUpgradeAuthority
{
    // ============ Structs ============

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 pricePerUnit;
        address paymentToken; // address(0) = ETH
        uint40 expiry;
    }

    // ============ Events ============

    event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, uint256 amount, uint256 price);
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);
    event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event MarketplacePaused(bool paused);

    // ============ Errors ============

    error NotSeller();
    error InvalidListing();
    error Expired();
    error InsufficientPayment();
    error InsufficientAmount();
    error InvalidFee();
    error InvalidRecipient();
    error MarketplaceNotApproved();
    error CannotBuyOwnListing();
    error NoRecentMint();
    error PriceExceedsStakeCap();
    error UnsupportedPaymentAsset();
    error ListingExpiryOverflow();
    error AuthorityMustDifferFromOwner();
}
