// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StemMarketplaceV2
 * @author Resonate Protocol
 * @notice Minimal marketplace with enforced royalties
 * @dev 
 *   - Single responsibility: buy/sell with enforced royalties
 *   - Reads royalty info from EIP-2981
 *   - Routes payments directly (use 0xSplits address as royalty receiver for splits)
 *   - ~200 lines instead of ~600
 * 
 * @custom:version 2.0.0
 */
contract StemMarketplaceV2 is Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct Listing {
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 pricePerUnit;
        address paymentToken;   // address(0) = ETH
        uint40 expiry;
    }

    // ============ Constants ============
    uint256 public constant BPS = 10000;
    uint256 public constant MAX_PROTOCOL_FEE = 500; // 5%
    uint256 public constant MAX_ROYALTY = 2500; // 25%

    // ============ State ============
    IERC1155 public immutable stemNFT;
    address public protocolFeeRecipient;
    uint256 public protocolFeeBps;

    uint256 private _listingId;
    mapping(uint256 => Listing) public listings;

    // ============ Events ============
    event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, uint256 amount, uint256 price);
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);
    event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount);

    // ============ Errors ============
    error NotSeller();
    error InvalidListing();
    error Expired();
    error InsufficientPayment();
    error InsufficientAmount();
    error TransferFailed();
    error InvalidFee();

    // ============ Constructor ============

    constructor(
        address _stemNFT,
        address _feeRecipient,
        uint256 _feeBps
    ) Ownable(msg.sender) {
        stemNFT = IERC1155(_stemNFT);
        protocolFeeRecipient = _feeRecipient;
        if (_feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        protocolFeeBps = _feeBps;
    }

    // ============ Listing ============

    function list(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        address paymentToken,
        uint256 duration
    ) external returns (uint256 listingId) {
        // Verify ownership
        require(stemNFT.balanceOf(msg.sender, tokenId) >= amount, "Insufficient balance");
        
        listingId = ++_listingId;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            amount: amount,
            pricePerUnit: pricePerUnit,
            paymentToken: paymentToken,
            expiry: uint40(block.timestamp + duration)
        });

        emit Listed(listingId, msg.sender, tokenId, amount, pricePerUnit);
    }

    function cancel(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        delete listings[listingId];
        emit Cancelled(listingId);
    }

    // ============ Buying (Enforced Royalties) ============

    function buy(uint256 listingId, uint256 amount) external payable {
        Listing storage listing = listings[listingId];
        
        // Validate
        if (listing.seller == address(0)) revert InvalidListing();
        if (block.timestamp > listing.expiry) revert Expired();
        if (amount > listing.amount) revert InsufficientAmount();

        // Cache values before potential deletion
        address seller = listing.seller;
        uint256 tokenId = listing.tokenId;
        address paymentToken = listing.paymentToken;
        uint256 totalPrice = amount * listing.pricePerUnit;

        // Calculate fees
        (address royaltyRecipient, uint256 royaltyAmount) = _getRoyalty(tokenId, totalPrice);
        uint256 protocolFee = (totalPrice * protocolFeeBps) / BPS;
        uint256 sellerAmount = totalPrice - royaltyAmount - protocolFee;

        // Collect payment
        _collectPayment(paymentToken, totalPrice);

        // Distribute (royalties enforced!)
        if (royaltyAmount > 0) {
            _pay(paymentToken, royaltyRecipient, royaltyAmount);
            emit RoyaltyPaid(tokenId, royaltyRecipient, royaltyAmount);
        }
        if (protocolFee > 0) {
            _pay(paymentToken, protocolFeeRecipient, protocolFee);
        }
        _pay(paymentToken, seller, sellerAmount);

        // Update listing
        listing.amount -= amount;
        if (listing.amount == 0) {
            delete listings[listingId];
        }

        // Transfer NFT (using cached values)
        stemNFT.safeTransferFrom(seller, msg.sender, tokenId, amount, "");

        emit Sold(listingId, msg.sender, amount, totalPrice);
    }

    // ============ Admin ============

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        protocolFeeBps = feeBps;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        protocolFeeRecipient = recipient;
    }

    // ============ View ============

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function quoteBuy(uint256 listingId, uint256 amount) external view returns (
        uint256 totalPrice,
        uint256 royaltyAmount,
        uint256 protocolFee,
        uint256 sellerAmount
    ) {
        Listing storage listing = listings[listingId];
        totalPrice = amount * listing.pricePerUnit;
        (, royaltyAmount) = _getRoyalty(listing.tokenId, totalPrice);
        protocolFee = (totalPrice * protocolFeeBps) / BPS;
        sellerAmount = totalPrice - royaltyAmount - protocolFee;
    }

    // ============ Internal ============

    function _getRoyalty(uint256 tokenId, uint256 salePrice) internal view returns (address, uint256) {
        try IERC2981(address(stemNFT)).royaltyInfo(tokenId, salePrice) returns (address r, uint256 a) {
            // Cap royalty
            uint256 maxRoyalty = (salePrice * MAX_ROYALTY) / BPS;
            return (r, a > maxRoyalty ? maxRoyalty : a);
        } catch {
            return (address(0), 0);
        }
    }

    function _collectPayment(address token, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value < amount) revert InsufficientPayment();
            // Refund excess
            if (msg.value > amount) {
                (bool ok,) = payable(msg.sender).call{value: msg.value - amount}("");
                if (!ok) revert TransferFailed();
            }
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}
