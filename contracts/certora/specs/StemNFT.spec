/**
 * @title StemNFT Formal Verification Specification
 * @notice Certora Prover rules for the StemNFT royalty bounds, creator
 *         immutability, supply conservation, and access control (issue #944).
 * @dev Run with: certoraRun certora/conf/stem_nft.conf
 *
 * Mirrors the StemNFT Halmos checks as Prover rules:
 *   1. Royalty never exceeds MAX_ROYALTY_BPS of the sale price, and minting
 *      above the cap reverts.
 *   2. A token's creator is immutable once minted.
 *   3. Transfers conserve a token's total supply (no mint/burn on transfer).
 *   4. Only an admin can set the transfer validator.
 */

using StemNFT as nft;

// ============ Methods ============

methods {
    function MAX_ROYALTY_BPS() external returns (uint96) envfree;
    function getCreator(uint256) external returns (address) envfree;
    function totalSupply(uint256) external returns (uint256) envfree;
    function royaltyInfo(uint256, uint256) external returns (address, uint256) envfree;
    function hasRole(bytes32, address) external returns (bool) envfree;
    function DEFAULT_ADMIN_ROLE() external returns (bytes32) envfree;
}

// ============ Royalty bounds ============

/// Royalty owed never exceeds MAX_ROYALTY_BPS of the sale price (EIP-2981 denominator 10000).
rule royaltyInfoBoundedByMax(uint256 tokenId, uint256 salePrice) {
    address receiver;
    uint256 amount;
    (receiver, amount) = royaltyInfo(tokenId, salePrice);

    assert to_mathint(amount) * 10000 <= to_mathint(salePrice) * to_mathint(MAX_ROYALTY_BPS()),
        "royalty must not exceed MAX_ROYALTY_BPS of the sale price";
}

/// Minting with a royalty above the cap must revert.
rule mintRoyaltyCapped(
    env e,
    address to,
    uint256 amount,
    string uri,
    address royaltyReceiver,
    uint96 royaltyBps,
    bool remixable,
    uint256[] parentIds
) {
    require to_mathint(royaltyBps) > to_mathint(MAX_ROYALTY_BPS());

    mint@withrevert(e, to, amount, uri, royaltyReceiver, royaltyBps, remixable, parentIds);

    assert lastReverted, "mint above MAX_ROYALTY_BPS must revert";
}

// ============ Creator immutability ============

/// Once a token exists, no call may change its creator.
rule creatorImmutable(env e, method f, calldataarg args, uint256 tokenId) {
    address creatorBefore = getCreator(tokenId);
    require creatorBefore != 0; // token already exists

    f@withrevert(e, args);

    assert getCreator(tokenId) == creatorBefore, "a token's creator must be immutable";
}

// ============ Supply conservation ============

/// A successful transfer never changes a token's total supply.
rule transferConservesSupply(
    env e,
    address from,
    address to,
    uint256 tokenId,
    uint256 amount,
    bytes data
) {
    uint256 supplyBefore = totalSupply(tokenId);

    safeTransferFrom@withrevert(e, from, to, tokenId, amount, data);

    assert lastReverted || totalSupply(tokenId) == supplyBefore,
        "transfer must conserve total supply";
}

// ============ Access control ============

/// Only an admin can set the transfer validator.
rule onlyAdminSetsTransferValidator(env e, address newValidator) {
    require !hasRole(DEFAULT_ADMIN_ROLE(), e.msg.sender);

    setTransferValidator@withrevert(e, newValidator);

    assert lastReverted, "non-admin must not set the transfer validator";
}
