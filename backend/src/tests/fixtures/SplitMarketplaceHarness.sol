// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Test-only (#2172). NOT a deployable contract: it reproduces, for the indexer
 * and analytics integration specs, exactly what StemMarketplaceV2._buy does to a
 * sale: it pays the royalty, the protocol fee and the seller from the buyer's
 * payment, emits RoyaltyPaid BEFORE Sold (same event signatures), and exposes
 * `protocolFeeBps()` and ERC-2981 `royaltyInfo()` the way the indexer reads
 * them. It is also the StemNFT for the royalty lookup. Native ETH only.
 *
 * Rebuild the embedded bytecode (split_marketplace_harness.ts) with
 *   solc --optimize --bin --abi SplitMarketplaceHarness.sol
 */
contract SplitMarketplaceHarness {
    event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);

    uint256 private constant BPS = 10_000;

    uint256 public protocolFeeBps;
    address public protocolFeeRecipient;
    mapping(uint256 => address) public royaltyReceiver;
    mapping(uint256 => uint96) public royaltyBps;

    constructor(uint256 feeBps, address feeRecipient) {
        protocolFeeBps = feeBps;
        protocolFeeRecipient = feeRecipient;
    }

    function setProtocolFee(uint256 feeBps) external {
        protocolFeeBps = feeBps;
    }

    function setRoyalty(uint256 tokenId, address receiver, uint96 bps) external {
        royaltyReceiver[tokenId] = receiver;
        royaltyBps[tokenId] = bps;
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view returns (address, uint256) {
        return (royaltyReceiver[tokenId], (salePrice * royaltyBps[tokenId]) / BPS);
    }

    /// One purchase; msg.value is the price.
    function buy(uint256 listingId, uint256 tokenId, address seller) external payable {
        _buy(listingId, tokenId, seller, msg.value);
    }

    /// Several purchases in one transaction (a batched user operation); msg.value is the sum of the prices.
    function buyBatch(uint256[] calldata listingIds, uint256[] calldata tokenIds, address[] calldata sellers, uint256[] calldata prices)
        external
        payable
    {
        uint256 sum;
        for (uint256 i = 0; i < listingIds.length; i++) {
            sum += prices[i];
            _buy(listingIds[i], tokenIds[i], sellers[i], prices[i]);
        }
        require(sum == msg.value, "value");
    }

    function _buy(uint256 listingId, uint256 tokenId, address seller, uint256 totalPrice) private {
        (address royaltyRecipient, uint256 royaltyAmount) = royaltyInfo(tokenId, totalPrice);
        uint256 protocolFee = (totalPrice * protocolFeeBps) / BPS;
        uint256 sellerAmount = totalPrice - royaltyAmount - protocolFee;
        if (royaltyAmount > 0) {
            _pay(royaltyRecipient, royaltyAmount);
            emit RoyaltyPaid(tokenId, royaltyRecipient, royaltyAmount);
        }
        if (protocolFee > 0) {
            _pay(protocolFeeRecipient, protocolFee);
        }
        _pay(seller, sellerAmount);
        emit Sold(listingId, msg.sender, 1, totalPrice);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "pay");
    }
}
