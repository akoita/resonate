// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IContentProtection} from "../interfaces/IContentProtection.sol";
import {IStemMarketplaceV2} from "../interfaces/IStemMarketplaceV2.sol";
import {PaymentAssetRegistry} from "../payments/PaymentAssetRegistry.sol";

interface IStemNFTWithMintTracking is IERC1155 {
    function lastMintedTokenIdByOwner(address owner) external view returns (uint256);

    function lastMintedBlockByOwner(address owner) external view returns (uint64);
}

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
contract StemMarketplaceV2 is IStemMarketplaceV2, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant BPS = 10000;
    // ADR-BM-2 (accepted 2026-07-04): platform take is 10% (1000 bps) on
    // marketplace sales; the cap leaves headroom to the 15% x402 micro tier.
    // MAX_ROYALTY (25%) + MAX_PROTOCOL_FEE (15%) = 40% < 100%, so
    // sellerAmount = totalPrice - royalty - fee can never underflow.
    uint256 public constant MAX_PROTOCOL_FEE = 1500; // 15%
    uint256 public constant MAX_ROYALTY = 2500; // 25%

    // ============ State ============
    IERC1155 public immutable stemNFT;
    IContentProtection public immutable contentProtection;
    PaymentAssetRegistry public immutable paymentAssetRegistry;
    address public protocolFeeRecipient;
    uint256 public protocolFeeBps;

    uint256 private _listingId;
    mapping(uint256 => Listing) public listings;

    /// @notice token (address(0) = native) => recipient => amount escrowed after a
    /// failed payout. A reverting royalty receiver / fee recipient / seller cannot
    /// brick a sale: the leg is escrowed here and reclaimed via `claimFailedPayment`.
    mapping(address => mapping(address => uint256)) public failedPayments;

    // ============ Constructor ============

    constructor(
        address _stemNFT,
        address _contentProtection,
        address _paymentAssetRegistry,
        address _feeRecipient,
        uint256 _feeBps
    ) Ownable(msg.sender) {
        if (_contentProtection == address(0)) revert ZeroAddress();
        if (_paymentAssetRegistry == address(0)) revert ZeroAddress();
        stemNFT = IERC1155(_stemNFT);
        contentProtection = IContentProtection(_contentProtection);
        paymentAssetRegistry = PaymentAssetRegistry(_paymentAssetRegistry);
        // V-003: Reject zero fee recipient when fees are enabled
        if (_feeBps > 0 && _feeRecipient == address(0)) {
            revert InvalidRecipient();
        }
        if (_feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        protocolFeeRecipient = _feeRecipient;
        protocolFeeBps = _feeBps;
    }

    // ============ Listing ============

    function list(uint256 tokenId, uint256 amount, uint256 pricePerUnit, address paymentToken, uint256 duration)
        external
        returns (uint256 listingId)
    {
        listingId = _createListing(msg.sender, tokenId, amount, pricePerUnit, paymentToken, duration);
    }

    function listLastMint(
        uint256 amount,
        uint256 pricePerUnit,
        address paymentToken,
        uint256 duration,
        uint256 releaseId
    ) external returns (uint256 listingId) {
        IStemNFTWithMintTracking trackedStemNFT = IStemNFTWithMintTracking(address(stemNFT));
        if (trackedStemNFT.lastMintedBlockByOwner(msg.sender) != block.number) {
            revert NoRecentMint();
        }

        uint256 tokenId = trackedStemNFT.lastMintedTokenIdByOwner(msg.sender);
        if (tokenId == 0) revert NoRecentMint();

        if (releaseId != 0) {
            contentProtection.registerStemProtectionRoot(releaseId, tokenId);
        }

        listingId = _createListing(msg.sender, tokenId, amount, pricePerUnit, paymentToken, duration);
    }

    function _createListing(
        address seller,
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        address paymentToken,
        uint256 duration
    ) internal returns (uint256 listingId) {
        // Verify ownership
        require(stemNFT.balanceOf(seller, tokenId) >= amount, "Insufficient balance");
        // Verify marketplace approval
        if (!stemNFT.isApprovedForAll(seller, address(this))) {
            revert MarketplaceNotApproved();
        }
        if (!paymentAssetRegistry.isTokenEnabled(paymentToken)) {
            revert UnsupportedPaymentAsset();
        }

        uint256 maxPrice = contentProtection.getMaxListingPrice(tokenId);
        if (pricePerUnit > maxPrice) revert PriceExceedsStakeCap();

        uint40 expiry = _checkedListingExpiry(duration);

        listingId = ++_listingId;
        listings[listingId] = Listing({
            seller: seller,
            tokenId: tokenId,
            amount: amount,
            pricePerUnit: pricePerUnit,
            paymentToken: paymentToken,
            expiry: expiry
        });

        emit Listed(listingId, seller, tokenId, amount, pricePerUnit);
    }

    function _checkedListingExpiry(uint256 duration) internal view returns (uint40) {
        uint256 expiry = block.timestamp + duration;
        if (expiry > type(uint40).max) revert ListingExpiryOverflow();
        return uint40(expiry);
    }

    function cancel(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        delete listings[listingId];
        emit Cancelled(listingId);
    }

    // ============ Buying (Enforced Royalties) ============

    function buy(uint256 listingId, uint256 amount) external payable nonReentrant {
        _buy(listingId, amount, msg.sender);
    }

    function buyFor(uint256 listingId, uint256 amount, address recipient) external payable nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        _buy(listingId, amount, recipient);
    }

    function _buy(uint256 listingId, uint256 amount, address recipient) internal {
        Listing storage listing = listings[listingId];

        // Validate (Checks)
        if (listing.seller == address(0)) revert InvalidListing();
        if (listing.seller == msg.sender) revert CannotBuyOwnListing();
        if (listing.seller == recipient) revert CannotBuyOwnListing();
        if (block.timestamp > listing.expiry) revert Expired();
        // #1284: reject zero-amount buys (no-op that would still emit Sold and poke
        // onERC1155Received). #1283: cap at the listed amount.
        if (amount == 0 || amount > listing.amount) revert InsufficientAmount();

        // Cache values before potential deletion
        address seller = listing.seller;
        uint256 tokenId = listing.tokenId;
        address paymentToken = listing.paymentToken;
        uint256 totalPrice = amount * listing.pricePerUnit;

        // #1283: re-validate the seller still holds and has approved the units. A stale
        // listing (the seller transferred the tokens away after listing) fails here with
        // a clear error before any payment work, instead of relying on the final NFT
        // transfer to revert. Note: listings persist across balance changes — a seller
        // who exits a position should cancel the listing.
        if (stemNFT.balanceOf(seller, tokenId) < amount) revert InsufficientAmount();
        if (!stemNFT.isApprovedForAll(seller, address(this))) revert MarketplaceNotApproved();

        // Calculate fees
        (address royaltyRecipient, uint256 royaltyAmount) = _getRoyalty(tokenId, totalPrice);
        uint256 protocolFee = (totalPrice * protocolFeeBps) / BPS;
        uint256 sellerAmount = totalPrice - royaltyAmount - protocolFee;

        // Update listing state BEFORE external calls (Effects)
        listing.amount -= amount;
        if (listing.amount == 0) {
            delete listings[listingId];
        }

        // Collect payment (Interactions)
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

        // Transfer NFT (using cached values)
        stemNFT.safeTransferFrom(seller, recipient, tokenId, amount, "");

        emit Sold(listingId, recipient, amount, totalPrice);
    }

    // ============ Admin ============

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        // V-003: Prevent setting non-zero fee when recipient is still address(0)
        if (feeBps > 0 && protocolFeeRecipient == address(0)) {
            revert InvalidRecipient();
        }
        protocolFeeBps = feeBps;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        protocolFeeRecipient = recipient;
    }

    // ============ View ============

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function quoteBuy(uint256 listingId, uint256 amount)
        external
        view
        returns (uint256 totalPrice, uint256 royaltyAmount, uint256 protocolFee, uint256 sellerAmount)
    {
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
            if (msg.value != amount) revert InsufficientPayment();
        } else {
            if (msg.value != 0) revert UnexpectedETH();
            // Reject fee-on-transfer / deflationary tokens: the buyer's payment is
            // distributed in full (royalty + fee + seller == amount), so the
            // marketplace must actually receive exactly `amount`.
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
            if (received != amount) revert FeeOnTransferNotSupported(amount, received);
        }
    }

    /// @dev Push-then-escrow: attempt the payout, but if the recipient reverts (a
    /// contract that rejects ETH — e.g. a creator-controlled royalty receiver — or a
    /// token that blocklists the address) escrow the leg for the recipient to reclaim
    /// instead of bricking the sale.
    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) _escrowFailedPayment(token, to, amount);
        } else {
            try this.safeTransferSelf(token, to, amount) {
            // delivered
            }
            catch {
                _escrowFailedPayment(token, to, amount);
            }
        }
    }

    function _escrowFailedPayment(address token, address to, uint256 amount) private {
        failedPayments[token][to] += amount;
        emit PaymentEscrowed(token, to, amount);
    }

    /// @dev External self-call wrapper so a reverting SafeERC20 transfer can be caught
    /// with try/catch. Restricted to self.
    function safeTransferSelf(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Reclaim funds escrowed for `msg.sender` after a failed payout leg.
    /// @param token The asset to claim (address(0) for native ETH).
    function claimFailedPayment(address token) external nonReentrant {
        uint256 amount = failedPayments[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        failedPayments[token][msg.sender] = 0;
        if (token == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit FailedPaymentClaimed(token, msg.sender, amount);
    }

    receive() external payable {}

    /// @notice Withdraw ETH accidentally sent directly to the contract
    function withdrawTrappedETH(address to) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        uint256 balance = address(this).balance;
        if (balance == 0) return;
        (bool ok,) = payable(to).call{value: balance}("");
        if (!ok) revert TransferFailed();
    }
}
