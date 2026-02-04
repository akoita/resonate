// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";

/**
 * @title StemMarketplaceV2 Unit Tests
 * @notice Comprehensive unit tests for the marketplace contract
 */
contract StemMarketplaceTest is Test {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    ERC20Mock public paymentToken;

    address public admin = makeAddr("admin");
    address public feeRecipient = makeAddr("feeRecipient");
    address public royaltyReceiver = makeAddr("royaltyReceiver");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");

    uint256 constant PROTOCOL_FEE_BPS = 250; // 2.5%
    uint256 constant ROYALTY_BPS = 500; // 5%
    uint256 constant LISTING_DURATION = 7 days;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, uint256 amount, uint256 price);
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid);
    event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount);

    function setUp() public {
        vm.startPrank(admin);
        
        // Deploy contracts
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        marketplace = new StemMarketplaceV2(
            address(stemNFT),
            feeRecipient,
            PROTOCOL_FEE_BPS
        );
        paymentToken = new ERC20Mock("Test Token", "TEST");

        // Setup validator
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);
        
        vm.stopPrank();

        // Mint NFTs for seller
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        stemNFT.mint(seller, 100, "ipfs://test", royaltyReceiver, uint96(ROYALTY_BPS), true, parentIds);

        // Approve marketplace
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);

        // Fund buyer
        vm.deal(buyer, 100 ether);
        paymentToken.mint(buyer, 1000 ether);
        vm.prank(buyer);
        paymentToken.approve(address(marketplace), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_Constructor_SetsImmutables() public view {
        assertEq(address(marketplace.stemNFT()), address(stemNFT));
        assertEq(marketplace.protocolFeeRecipient(), feeRecipient);
        assertEq(marketplace.protocolFeeBps(), PROTOCOL_FEE_BPS);
    }

    function test_Constructor_RevertInvalidFee() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidFee.selector);
        new StemMarketplaceV2(address(stemNFT), feeRecipient, 501); // > 5%
    }

    // ============ Listing Tests ============

    function test_List_CreatesListing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, seller);
        assertEq(listing.tokenId, 1);
        assertEq(listing.amount, 50);
        assertEq(listing.pricePerUnit, 1 ether);
        assertEq(listing.paymentToken, address(0));
        assertEq(listing.expiry, block.timestamp + LISTING_DURATION);
    }

    function test_List_WithERC20() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.paymentToken, address(paymentToken));
    }

    function test_List_EmitsEvent() public {
        vm.prank(seller);
        vm.expectEmit(true, true, false, true);
        emit Listed(1, seller, 1, 50, 1 ether);
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    function test_List_RevertInsufficientBalance() public {
        address noTokens = makeAddr("noTokens");
        vm.prank(noTokens);
        vm.expectRevert("Insufficient balance");
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    // ============ Cancel Tests ============

    function test_Cancel_RemovesListing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(seller);
        marketplace.cancel(listingId);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, address(0));
    }

    function test_Cancel_EmitsEvent() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(seller);
        vm.expectEmit(true, false, false, false);
        emit Cancelled(listingId);
        marketplace.cancel(listingId);
    }

    function test_Cancel_RevertNotSeller() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.NotSeller.selector);
        marketplace.cancel(listingId);
    }

    // ============ Buy Tests ============

    function test_Buy_TransfersNFT() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        assertEq(stemNFT.balanceOf(buyer, 1), 10);
        assertEq(stemNFT.balanceOf(seller, 1), 90);
    }

    function test_Buy_DistributesPayments() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        uint256 totalPrice = 10 ether;
        uint256 expectedRoyalty = (totalPrice * ROYALTY_BPS) / 10000; // 0.5 ether
        uint256 expectedFee = (totalPrice * PROTOCOL_FEE_BPS) / 10000; // 0.25 ether
        uint256 expectedSeller = totalPrice - expectedRoyalty - expectedFee; // 9.25 ether

        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiver.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        assertEq(seller.balance - sellerBefore, expectedSeller);
        assertEq(royaltyReceiver.balance - royaltyBefore, expectedRoyalty);
        assertEq(feeRecipient.balance - feeBefore, expectedFee);
    }

    function test_Buy_EmitsEvents() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        uint256 totalPrice = 10 ether;
        uint256 expectedRoyalty = (totalPrice * ROYALTY_BPS) / 10000;

        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit RoyaltyPaid(1, royaltyReceiver, expectedRoyalty);
        vm.expectEmit(true, true, false, true);
        emit Sold(listingId, buyer, 10, totalPrice);
        marketplace.buy{value: 10 ether}(listingId, 10);
    }

    function test_Buy_UpdatesListingAmount() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.amount, 40);
    }

    function test_Buy_DeletesListingWhenEmpty() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.deal(buyer, 100 ether); // Ensure buyer has enough ETH
        vm.prank(buyer);
        marketplace.buy{value: 50 ether}(listingId, 50);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, address(0));
    }

    function test_Buy_RefundsExcess() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        uint256 buyerBefore = buyer.balance;
        
        vm.prank(buyer);
        marketplace.buy{value: 15 ether}(listingId, 10); // Overpay by 5 ETH

        // Buyer should get 5 ETH back
        assertEq(buyerBefore - buyer.balance, 10 ether);
    }

    function test_Buy_WithERC20() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        uint256 buyerBefore = paymentToken.balanceOf(buyer);
        uint256 sellerBefore = paymentToken.balanceOf(seller);

        vm.prank(buyer);
        marketplace.buy(listingId, 10);

        assertEq(buyerBefore - paymentToken.balanceOf(buyer), 1000e18);
        assertTrue(paymentToken.balanceOf(seller) > sellerBefore);
    }

    function test_Buy_RevertInvalidListing() public {
        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InvalidListing.selector);
        marketplace.buy{value: 1 ether}(999, 1);
    }

    function test_Buy_RevertExpired() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.warp(block.timestamp + LISTING_DURATION + 1);

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.Expired.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RevertInsufficientAmount() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientAmount.selector);
        marketplace.buy{value: 100 ether}(listingId, 100); // Only 50 available
    }

    function test_Buy_RevertInsufficientPayment() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: 0.5 ether}(listingId, 1); // Need 1 ETH
    }

    // ============ Quote Tests ============

    function test_QuoteBuy() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        (
            uint256 totalPrice,
            uint256 royaltyAmount,
            uint256 protocolFee,
            uint256 sellerAmount
        ) = marketplace.quoteBuy(listingId, 10);

        assertEq(totalPrice, 10 ether);
        assertEq(royaltyAmount, 0.5 ether); // 5%
        assertEq(protocolFee, 0.25 ether); // 2.5%
        assertEq(sellerAmount, 9.25 ether);
    }

    // ============ Admin Tests ============

    function test_SetProtocolFee() public {
        vm.prank(admin);
        marketplace.setProtocolFee(300);

        assertEq(marketplace.protocolFeeBps(), 300);
    }

    function test_SetProtocolFee_RevertInvalidFee() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidFee.selector);
        marketplace.setProtocolFee(501);
    }

    function test_SetProtocolFee_RevertNotOwner() public {
        vm.prank(seller);
        vm.expectRevert();
        marketplace.setProtocolFee(300);
    }

    function test_SetFeeRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        
        vm.prank(admin);
        marketplace.setFeeRecipient(newRecipient);

        assertEq(marketplace.protocolFeeRecipient(), newRecipient);
    }

    // ============ Royalty Enforcement Tests ============

    function test_Buy_EnforcesRoyaltyCap() public {
        // Create listing for token with max royalty
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "ipfs://test2", royaltyReceiver, 1000, true, parentIds);

        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 50, 1 ether, address(0), LISTING_DURATION);

        // Royalty is capped at 25% by marketplace (but token only has 10%)
        (,uint256 royaltyAmount,,) = marketplace.quoteBuy(listingId, 10);
        assertEq(royaltyAmount, 1 ether); // 10% of 10 ETH
    }

    // ============ Edge Case Tests ============

    function test_Buy_ZeroRoyalty() public {
        // Create listing for token with zero royalty
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "ipfs://test2", royaltyReceiver, 1, true, parentIds);

        vm.prank(seller);
        stemNFT.setRoyaltyBps(tokenId, 0);

        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 50, 1 ether, address(0), LISTING_DURATION);

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        // All goes to seller minus protocol fee (no royalty)
        assertEq(seller.balance - sellerBefore, 10 ether - 0.25 ether);
        assertEq(feeRecipient.balance - feeBefore, 0.25 ether);
    }

    function test_Receive_AcceptsETH() public {
        (bool success,) = address(marketplace).call{value: 1 ether}("");
        assertTrue(success);
    }
}
