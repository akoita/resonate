/**
 * @title StemMarketplaceV2 Formal Verification Specification
 * @notice Certora Prover rules for marketplace payment conservation, fee/royalty
 *         caps, and listing-lifecycle access control (issue #944).
 * @dev Run with: certoraRun certora/conf/stem_marketplace.conf
 *
 * Mirrors the StemMarketplaceV2 Halmos checks as Prover rules:
 *   1. A quote's royalty + protocol fee + seller proceeds equal the total price.
 *   2. Royalty is capped at MAX_ROYALTY and the protocol fee at MAX_PROTOCOL_FEE
 *      of the total price; protocolFeeBps never exceeds MAX_PROTOCOL_FEE.
 *   3. Only the owner can change the protocol fee; the cap is enforced.
 *   4. Only the seller can cancel a listing; expired listings cannot be bought.
 *
 * The royalty cap holds even though royaltyInfo is an external call, because
 * `_getRoyalty` clamps the result to (salePrice * MAX_ROYALTY / BPS).
 */

using StemMarketplaceV2 as market;

// ============ Methods ============

methods {
    function BPS() external returns (uint256) envfree;
    function MAX_PROTOCOL_FEE() external returns (uint256) envfree;
    function MAX_ROYALTY() external returns (uint256) envfree;
    function protocolFeeBps() external returns (uint256) envfree;
    function owner() external returns (address) envfree;
    function quoteBuy(uint256, uint256) external returns (uint256, uint256, uint256, uint256) envfree;
    function listings(uint256) external returns (address, uint256, uint256, uint256, address, uint40) envfree;
}

// ============ Payment conservation & caps ============

/// A quote's royalty + protocol fee + seller proceeds always equal the total price.
rule quotePaymentsConserved(uint256 listingId, uint256 amount) {
    uint256 total;
    uint256 royalty;
    uint256 fee;
    uint256 sellerAmount;
    (total, royalty, fee, sellerAmount) = quoteBuy(listingId, amount);

    assert to_mathint(royalty) + to_mathint(fee) + to_mathint(sellerAmount) == to_mathint(total),
        "royalty + protocol fee + seller proceeds must equal the total price";
}

/// Royalty never exceeds MAX_ROYALTY of the total price (enforced by the clamp in _getRoyalty).
rule quoteRoyaltyCapped(uint256 listingId, uint256 amount) {
    uint256 total;
    uint256 royalty;
    uint256 fee;
    uint256 sellerAmount;
    (total, royalty, fee, sellerAmount) = quoteBuy(listingId, amount);

    assert to_mathint(royalty) * to_mathint(BPS()) <= to_mathint(total) * to_mathint(MAX_ROYALTY()),
        "royalty must not exceed MAX_ROYALTY of the total price";
}

/// Protocol fee never exceeds MAX_PROTOCOL_FEE of the total price.
rule quoteProtocolFeeBounded(uint256 listingId, uint256 amount) {
    require to_mathint(protocolFeeBps()) <= to_mathint(MAX_PROTOCOL_FEE());

    uint256 total;
    uint256 royalty;
    uint256 fee;
    uint256 sellerAmount;
    (total, royalty, fee, sellerAmount) = quoteBuy(listingId, amount);

    assert to_mathint(fee) * to_mathint(BPS()) <= to_mathint(total) * to_mathint(MAX_PROTOCOL_FEE()),
        "protocol fee must not exceed MAX_PROTOCOL_FEE of the total price";
}

/// protocolFeeBps can never exceed MAX_PROTOCOL_FEE across any call.
rule protocolFeeBpsNeverExceedsCap(env e, method f, calldataarg args) {
    require to_mathint(protocolFeeBps()) <= to_mathint(MAX_PROTOCOL_FEE());

    f(e, args);

    assert to_mathint(protocolFeeBps()) <= to_mathint(MAX_PROTOCOL_FEE()),
        "protocolFeeBps must never exceed MAX_PROTOCOL_FEE";
}

// ============ Admin access control ============

/// Setting a protocol fee above the cap must revert.
rule setProtocolFeeRespectsCap(env e, uint256 feeBps) {
    require to_mathint(feeBps) > to_mathint(MAX_PROTOCOL_FEE());

    setProtocolFee@withrevert(e, feeBps);

    assert lastReverted, "setProtocolFee above MAX_PROTOCOL_FEE must revert";
}

/// Only the owner can change the protocol fee.
rule onlyOwnerSetsProtocolFee(env e, uint256 feeBps) {
    require e.msg.sender != owner();

    setProtocolFee@withrevert(e, feeBps);

    assert lastReverted, "non-owner must not set the protocol fee";
}

// ============ Listing lifecycle ============

/// Only the seller can cancel a listing.
rule onlySellerCancels(env e, uint256 listingId) {
    address seller;
    uint256 tokenId;
    uint256 amount;
    uint256 pricePerUnit;
    address paymentToken;
    uint40 expiry;
    (seller, tokenId, amount, pricePerUnit, paymentToken, expiry) = listings(listingId);

    require seller != 0;            // listing exists
    require e.msg.sender != seller; // caller is not the seller

    cancel@withrevert(e, listingId);

    assert lastReverted, "only the seller may cancel a listing";
}

/// An expired listing cannot be purchased.
rule buyRejectsExpiredListing(env e, uint256 listingId, uint256 amount) {
    address seller;
    uint256 tokenId;
    uint256 listingAmount;
    uint256 pricePerUnit;
    address paymentToken;
    uint40 expiry;
    (seller, tokenId, listingAmount, pricePerUnit, paymentToken, expiry) = listings(listingId);

    require seller != 0;                                         // listing exists
    require to_mathint(e.block.timestamp) > to_mathint(expiry);  // past expiry

    buy@withrevert(e, listingId, amount);

    assert lastReverted, "an expired listing must not be purchasable";
}
