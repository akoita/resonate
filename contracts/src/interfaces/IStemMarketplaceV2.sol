// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IStemMarketplaceV2
/// @notice Canonical shared surface (struct, events, errors) for StemMarketplaceV2.
/// Production code, tests, indexers, and the backend import this so the
/// listing/event/error contract cannot silently drift. `Listing` is the public
/// return type of `getListing`, so it lives here too.
interface IStemMarketplaceV2 {
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

    event Listed(
        uint256 indexed listingId, address indexed seller, uint256 tokenId, uint256 amount, uint256 price
    );
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);
    event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event PaymentEscrowed(address indexed token, address indexed recipient, uint256 amount);
    event FailedPaymentClaimed(address indexed token, address indexed recipient, uint256 amount);

    // ============ Errors ============

    error NotSeller();
    error InvalidListing();
    error Expired();
    error InsufficientPayment();
    error InsufficientAmount();
    error TransferFailed();
    error InvalidFee();
    error InvalidRecipient();
    error MarketplaceNotApproved();
    error CannotBuyOwnListing();
    error UnexpectedETH();
    error NoRecentMint();
    error PriceExceedsStakeCap();
    error ZeroAddress();
    error UnsupportedPaymentAsset();
    error ListingExpiryOverflow();
    error FeeOnTransferNotSupported(uint256 expected, uint256 received);
    error NothingToClaim();
    error OnlySelf();
}
