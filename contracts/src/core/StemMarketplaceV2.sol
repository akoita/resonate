// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
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
 * @custom:version 2.1.0
 */
contract StemMarketplaceV2 is
    IStemMarketplaceV2,
    Initializable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:resonate.storage.StemMarketplaceV2
    struct StemMarketplaceStorage {
        IERC1155 stemNFT;
        IContentProtection contentProtection;
        PaymentAssetRegistry paymentAssetRegistry;
        address protocolFeeRecipient;
        uint256 protocolFeeBps;
        uint256 listingId;
        mapping(uint256 => Listing) listings;
        mapping(address => mapping(address => uint256)) failedPayments;
        address upgradeAuthority;
        bool paused;
    }

    // ============ Constants ============
    uint256 public constant BPS = 10000;
    // ADR-BM-2 (accepted 2026-07-04): platform take is 10% (1000 bps) on
    // marketplace sales; the cap leaves headroom to the 15% x402 micro tier.
    // MAX_ROYALTY (25%) + MAX_PROTOCOL_FEE (15%) = 40% < 100%, so
    // sellerAmount = totalPrice - royalty - fee can never underflow.
    uint256 public constant MAX_PROTOCOL_FEE = 1500; // 15%
    uint256 public constant MAX_ROYALTY = 2500; // 25%

    // keccak256(abi.encode(uint256(keccak256("resonate.storage.StemMarketplaceV2")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant StemMarketplaceStorageLocation =
        0xf3c94fb6abe0389909903f3f4216f8fe092cd4b74654cae83abd3da828d90500;

    function _getStemMarketplaceStorage() private pure returns (StemMarketplaceStorage storage $) {
        assembly {
            $.slot := StemMarketplaceStorageLocation
        }
    }

    // ============ Initialization ============

    modifier whenNotPaused() {
        if (_getStemMarketplaceStorage().paused) revert Paused();
        _;
    }

    modifier onlyUpgradeAuthority() {
        if (msg.sender != _getStemMarketplaceStorage().upgradeAuthority) revert UnauthorizedUpgrade(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _stemNFT,
        address _contentProtection,
        address _paymentAssetRegistry,
        address _feeRecipient,
        uint256 _feeBps,
        address _owner,
        address _upgradeAuthority
    ) external initializer {
        if (
            _stemNFT == address(0) || _contentProtection == address(0) || _paymentAssetRegistry == address(0)
                || _owner == address(0) || _upgradeAuthority == address(0)
        ) revert ZeroAddress();
        if (_owner == _upgradeAuthority) revert AuthorityMustDifferFromOwner();
        if (_feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        if (_feeBps > 0 && _feeRecipient == address(0)) revert InvalidRecipient();

        __Ownable_init(_owner);
        __Ownable2Step_init();
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        $.stemNFT = IERC1155(_stemNFT);
        $.contentProtection = IContentProtection(_contentProtection);
        $.paymentAssetRegistry = PaymentAssetRegistry(_paymentAssetRegistry);
        $.protocolFeeRecipient = _feeRecipient;
        $.protocolFeeBps = _feeBps;
        $.upgradeAuthority = _upgradeAuthority;
        emit UpgradeAuthorityUpdated(address(0), _upgradeAuthority);
    }

    // ============ Listing ============

    function list(uint256 tokenId, uint256 amount, uint256 pricePerUnit, address paymentToken, uint256 duration)
        external
        whenNotPaused
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
    ) external whenNotPaused returns (uint256 listingId) {
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        IStemNFTWithMintTracking trackedStemNFT = IStemNFTWithMintTracking(address($.stemNFT));
        if (trackedStemNFT.lastMintedBlockByOwner(msg.sender) != block.number) {
            revert NoRecentMint();
        }

        uint256 tokenId = trackedStemNFT.lastMintedTokenIdByOwner(msg.sender);
        if (tokenId == 0) revert NoRecentMint();

        if (releaseId != 0) {
            $.contentProtection.registerStemProtectionRoot(releaseId, tokenId);
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
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        // Verify ownership
        require($.stemNFT.balanceOf(seller, tokenId) >= amount, "Insufficient balance");
        // Verify marketplace approval
        if (!$.stemNFT.isApprovedForAll(seller, address(this))) {
            revert MarketplaceNotApproved();
        }
        if (!$.paymentAssetRegistry.isTokenEnabled(paymentToken)) {
            revert UnsupportedPaymentAsset();
        }

        uint256 maxPrice = $.contentProtection.getMaxListingPrice(tokenId);
        if (pricePerUnit > maxPrice) revert PriceExceedsStakeCap();

        uint40 expiry = _checkedListingExpiry(duration);

        listingId = ++$.listingId;
        $.listings[listingId] = Listing({
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
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        Listing storage listing = $.listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        delete $.listings[listingId];
        emit Cancelled(listingId);
    }

    // ============ Buying (Enforced Royalties) ============

    function buy(uint256 listingId, uint256 amount) external payable nonReentrant whenNotPaused {
        _buy(listingId, amount, msg.sender);
    }

    function buyFor(uint256 listingId, uint256 amount, address recipient) external payable nonReentrant whenNotPaused {
        if (recipient == address(0)) revert InvalidRecipient();
        _buy(listingId, amount, recipient);
    }

    function _buy(uint256 listingId, uint256 amount, address recipient) internal {
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        Listing storage listing = $.listings[listingId];

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
        if ($.stemNFT.balanceOf(seller, tokenId) < amount) revert InsufficientAmount();
        if (!$.stemNFT.isApprovedForAll(seller, address(this))) revert MarketplaceNotApproved();

        // CP-4 (#1271): re-enforce the stake-backed price cap at purchase time, not only
        // at listing time. The cap can move down after a listing is created (e.g. the
        // owner lowers maxPriceMultiplier), so a listing priced under the old cap could
        // otherwise still transact above the new one. An inactive stake yields
        // type(uint256).max here, so unstaked/refunded/slashed roots are uncapped by
        // design (blacklist + TransferValidator gate slashed actors elsewhere).
        uint256 maxPrice = $.contentProtection.getMaxListingPrice(tokenId);
        if (listing.pricePerUnit > maxPrice) revert PriceExceedsStakeCap();

        // Calculate fees
        (address royaltyRecipient, uint256 royaltyAmount) = _getRoyalty(tokenId, totalPrice);
        uint256 protocolFee = (totalPrice * $.protocolFeeBps) / BPS;
        uint256 sellerAmount = totalPrice - royaltyAmount - protocolFee;

        // Update listing state BEFORE external calls (Effects)
        listing.amount -= amount;
        if (listing.amount == 0) {
            delete $.listings[listingId];
        }

        // Collect payment (Interactions)
        _collectPayment(paymentToken, totalPrice);

        // Distribute (royalties enforced!)
        if (royaltyAmount > 0) {
            _pay(paymentToken, royaltyRecipient, royaltyAmount);
            emit RoyaltyPaid(tokenId, royaltyRecipient, royaltyAmount);
        }
        if (protocolFee > 0) {
            _pay(paymentToken, $.protocolFeeRecipient, protocolFee);
        }
        _pay(paymentToken, seller, sellerAmount);

        // Transfer NFT (using cached values)
        $.stemNFT.safeTransferFrom(seller, recipient, tokenId, amount, "");

        emit Sold(listingId, recipient, amount, totalPrice);
    }

    // ============ Admin ============

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_PROTOCOL_FEE) revert InvalidFee();
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        // V-003: Prevent setting non-zero fee when recipient is still address(0)
        if (feeBps > 0 && $.protocolFeeRecipient == address(0)) {
            revert InvalidRecipient();
        }
        $.protocolFeeBps = feeBps;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        _getStemMarketplaceStorage().protocolFeeRecipient = recipient;
    }

    function setPaymentAssetRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert ZeroAddress();
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        address previous = address($.paymentAssetRegistry);
        $.paymentAssetRegistry = PaymentAssetRegistry(newRegistry);
        emit PaymentAssetRegistryUpdated(previous, newRegistry);
    }

    function setPaused(bool isPaused) external onlyOwner {
        _getStemMarketplaceStorage().paused = isPaused;
        emit MarketplacePaused(isPaused);
    }

    function setUpgradeAuthority(address newAuthority) external onlyUpgradeAuthority {
        if (newAuthority == address(0)) revert ZeroAddress();
        if (newAuthority == owner()) revert AuthorityMustDifferFromOwner();
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        address previous = $.upgradeAuthority;
        $.upgradeAuthority = newAuthority;
        emit UpgradeAuthorityUpdated(previous, newAuthority);
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == _getStemMarketplaceStorage().upgradeAuthority) revert AuthorityMustDifferFromOwner();
        super.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override {
        if (newOwner != address(0) && newOwner == _getStemMarketplaceStorage().upgradeAuthority) {
            revert AuthorityMustDifferFromOwner();
        }
        super._transferOwnership(newOwner);
    }

    function _authorizeUpgrade(address) internal view override onlyUpgradeAuthority {}

    // ============ View ============

    function stemNFT() external view returns (IERC1155) {
        return _getStemMarketplaceStorage().stemNFT;
    }

    function contentProtection() external view returns (IContentProtection) {
        return _getStemMarketplaceStorage().contentProtection;
    }

    function paymentAssetRegistry() external view returns (PaymentAssetRegistry) {
        return _getStemMarketplaceStorage().paymentAssetRegistry;
    }

    function protocolFeeRecipient() external view returns (address) {
        return _getStemMarketplaceStorage().protocolFeeRecipient;
    }

    function protocolFeeBps() external view returns (uint256) {
        return _getStemMarketplaceStorage().protocolFeeBps;
    }

    function listings(uint256)
        external
        view
        returns (
            address seller,
            uint256 tokenId,
            uint256 amount,
            uint256 pricePerUnit,
            address paymentToken,
            uint40 expiry
        )
    {
        uint256 listingId = abi.decode(msg.data[4:], (uint256));
        Listing storage listing = _getStemMarketplaceStorage().listings[listingId];
        return
            (
                listing.seller,
                listing.tokenId,
                listing.amount,
                listing.pricePerUnit,
                listing.paymentToken,
                listing.expiry
            );
    }

    function failedPayments(address, address) external view returns (uint256) {
        (address token, address recipient) = abi.decode(msg.data[4:], (address, address));
        return _getStemMarketplaceStorage().failedPayments[token][recipient];
    }

    function upgradeAuthority() external view returns (address) {
        return _getStemMarketplaceStorage().upgradeAuthority;
    }

    function paused() external view returns (bool) {
        return _getStemMarketplaceStorage().paused;
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _getStemMarketplaceStorage().listings[listingId];
    }

    function quoteBuy(uint256 listingId, uint256 amount)
        external
        view
        returns (uint256 totalPrice, uint256 royaltyAmount, uint256 protocolFee, uint256 sellerAmount)
    {
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        Listing storage listing = $.listings[listingId];
        totalPrice = amount * listing.pricePerUnit;
        (, royaltyAmount) = _getRoyalty(listing.tokenId, totalPrice);
        protocolFee = (totalPrice * $.protocolFeeBps) / BPS;
        sellerAmount = totalPrice - royaltyAmount - protocolFee;
    }

    // ============ Internal ============

    function _getRoyalty(uint256 tokenId, uint256 salePrice) internal view returns (address, uint256) {
        try IERC2981(address(_getStemMarketplaceStorage().stemNFT)).royaltyInfo(tokenId, salePrice) returns (
            address r, uint256 a
        ) {
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
        _getStemMarketplaceStorage().failedPayments[token][to] += amount;
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
        StemMarketplaceStorage storage $ = _getStemMarketplaceStorage();
        uint256 amount = $.failedPayments[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        $.failedPayments[token][msg.sender] = 0;
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
