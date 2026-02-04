// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";

/**
 * @title StemMarketplaceV2 Fuzz Tests
 * @notice Property-based testing for marketplace
 */
contract StemMarketplaceFuzzTest is Test {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;

    address public admin = makeAddr("admin");
    address public feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        vm.startPrank(admin);
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        marketplace = new StemMarketplaceV2(address(stemNFT), feeRecipient, 250);
        
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);
        vm.stopPrank();
    }

    // ============ Listing Fuzz Tests ============

    function testFuzz_List_ValidParams(
        uint256 amount,
        uint256 pricePerUnit,
        uint256 duration
    ) public {
        amount = bound(amount, 1, 1000);
        pricePerUnit = bound(pricePerUnit, 0.001 ether, 1000 ether);
        duration = bound(duration, 1 hours, 365 days);

        address seller = makeAddr("seller");
        
        // Mint NFT
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, amount, "ipfs://test", address(0), 500, true, parentIds);

        // Approve and list
        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, amount, pricePerUnit, address(0), duration);
        vm.stopPrank();

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, seller);
        assertEq(listing.tokenId, tokenId);
        assertEq(listing.amount, amount);
        assertEq(listing.pricePerUnit, pricePerUnit);
        assertEq(listing.expiry, block.timestamp + duration);
    }

    // ============ Buy Fuzz Tests ============

    function testFuzz_Buy_PaymentDistribution(
        uint256 mintAmount,
        uint256 buyAmount,
        uint256 pricePerUnit,
        uint96 royaltyBps
    ) public {
        mintAmount = bound(mintAmount, 1, 100);
        buyAmount = bound(buyAmount, 1, mintAmount);
        pricePerUnit = bound(pricePerUnit, 0.001 ether, 10 ether);
        // Use 1-1000 range (StemNFT uses default 500 if 0 is passed)
        royaltyBps = uint96(bound(royaltyBps, 1, 1000));

        address seller = makeAddr("seller");
        address buyer = makeAddr("buyer");
        address royaltyReceiver = makeAddr("royaltyReceiver");

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, mintAmount, "ipfs://test", royaltyReceiver, royaltyBps, true, parentIds);

        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, mintAmount, pricePerUnit, address(0), 7 days);
        vm.stopPrank();

        uint256 totalPrice = buyAmount * pricePerUnit;
        vm.deal(buyer, totalPrice);

        // Record balances
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyReceiver.balance;
        uint256 feeBefore = feeRecipient.balance;

        // Buy
        vm.prank(buyer);
        marketplace.buy{value: totalPrice}(listingId, buyAmount);

        // Verify NFT transfer
        assertEq(stemNFT.balanceOf(buyer, tokenId), buyAmount);

        // Verify payment distribution
        uint256 expectedRoyalty = (totalPrice * royaltyBps) / 10000;
        uint256 expectedFee = (totalPrice * 250) / 10000;
        uint256 expectedSeller = totalPrice - expectedRoyalty - expectedFee;

        assertEq(royaltyReceiver.balance - royaltyBefore, expectedRoyalty);
        assertEq(feeRecipient.balance - feeBefore, expectedFee);
        assertEq(seller.balance - sellerBefore, expectedSeller);
    }

    function testFuzz_Buy_RefundsExcess(
        uint256 price,
        uint256 excessAmount
    ) public {
        price = bound(price, 0.01 ether, 10 ether);
        excessAmount = bound(excessAmount, 0.001 ether, 10 ether);

        address seller = makeAddr("seller");
        address buyer = makeAddr("buyer");

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "ipfs://test", address(0), 500, true, parentIds);

        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, 100, price, address(0), 7 days);
        vm.stopPrank();

        uint256 totalSent = price + excessAmount;
        vm.deal(buyer, totalSent);

        uint256 buyerBefore = buyer.balance;
        
        vm.prank(buyer);
        marketplace.buy{value: totalSent}(listingId, 1);

        // Buyer should only spend exact price
        assertEq(buyerBefore - buyer.balance, price);
    }

    // ============ Quote Fuzz Tests ============

    function testFuzz_QuoteBuy_Consistency(
        uint256 amount,
        uint256 pricePerUnit,
        uint96 royaltyBps
    ) public {
        amount = bound(amount, 1, 100);
        pricePerUnit = bound(pricePerUnit, 0.01 ether, 100 ether);
        royaltyBps = uint96(bound(royaltyBps, 0, 1000));

        address seller = makeAddr("seller");
        address royaltyReceiver = makeAddr("royaltyReceiver");

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 1000, "ipfs://test", royaltyReceiver, royaltyBps, true, parentIds);

        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, 1000, pricePerUnit, address(0), 7 days);
        vm.stopPrank();

        // Quote
        (
            uint256 totalPrice,
            uint256 royaltyAmount,
            uint256 protocolFee,
            uint256 sellerAmount
        ) = marketplace.quoteBuy(listingId, amount);

        // Verify consistency
        assertEq(totalPrice, amount * pricePerUnit);
        assertEq(totalPrice, royaltyAmount + protocolFee + sellerAmount);
        
        // Verify caps
        assertLe(royaltyAmount, (totalPrice * 2500) / 10000); // Max 25%
        assertLe(protocolFee, (totalPrice * 500) / 10000); // Max 5%
    }

    // ============ Protocol Fee Fuzz Tests ============

    function testFuzz_SetProtocolFee(uint256 feeBps) public {
        feeBps = bound(feeBps, 0, 500);

        vm.prank(admin);
        marketplace.setProtocolFee(feeBps);

        assertEq(marketplace.protocolFeeBps(), feeBps);
    }

    function testFuzz_SetProtocolFee_InvalidReverts(uint256 feeBps) public {
        vm.assume(feeBps > 500);

        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidFee.selector);
        marketplace.setProtocolFee(feeBps);
    }

    // ============ Partial Buy Fuzz Tests ============

    function testFuzz_Buy_PartialPurchases(
        uint256[3] memory buyAmounts
    ) public {
        uint256 totalListed = 1000;
        
        address seller = makeAddr("seller");
        address buyer = makeAddr("buyer");
        uint256 price = 1 ether;

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, totalListed, "ipfs://test", address(0), 500, true, parentIds);

        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, totalListed, price, address(0), 7 days);
        vm.stopPrank();

        // Bound and sum purchases
        uint256 totalBought;
        for (uint256 i = 0; i < 3; i++) {
            buyAmounts[i] = bound(buyAmounts[i], 1, 300);
        }
        
        vm.deal(buyer, 1000 ether);

        // Make partial purchases
        for (uint256 i = 0; i < 3; i++) {
            StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
            if (listing.amount == 0) break;
            
            uint256 buyAmount = buyAmounts[i] > listing.amount ? listing.amount : buyAmounts[i];
            
            vm.prank(buyer);
            marketplace.buy{value: buyAmount * price}(listingId, buyAmount);
            
            totalBought += buyAmount;
        }

        // Verify
        assertEq(stemNFT.balanceOf(buyer, tokenId), totalBought);
        assertEq(stemNFT.balanceOf(seller, tokenId), totalListed - totalBought);
    }
}
