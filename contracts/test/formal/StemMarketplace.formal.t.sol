// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title StemMarketplaceV2 Formal Verification Tests
 * @notice Proves marketplace properties using symbolic execution
 * @dev Run with: halmos --contract StemMarketplaceFormalTest
 */
contract StemMarketplaceFormalTest is Test, SymTest {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    
    address public feeRecipient;
    uint256 public constant PROTOCOL_FEE_BPS = 250;

    function setUp() public {
        feeRecipient = address(0xFEE);
        
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        marketplace = new StemMarketplaceV2(address(stemNFT), feeRecipient, PROTOCOL_FEE_BPS);
        
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);
    }

    // ============ Payment Distribution Properties ============

    /// @notice Proves total payments equal total price
    function check_buy_paymentsAddUp(
        uint256 amount,
        uint256 pricePerUnit,
        uint96 royaltyBps
    ) public {
        vm.assume(amount > 0 && amount <= 100);
        vm.assume(pricePerUnit > 0 && pricePerUnit <= 100 ether);
        vm.assume(royaltyBps <= 1000);

        address seller = address(0x1);
        address buyer = address(0x2);
        address royaltyReceiver = address(0x3);

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 1000, "test", royaltyReceiver, royaltyBps, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 1000, pricePerUnit, address(0), 7 days);

        // Get quote
        (
            uint256 totalPrice,
            uint256 royaltyAmount,
            uint256 protocolFee,
            uint256 sellerAmount
        ) = marketplace.quoteBuy(listingId, amount);

        // Prove: payments sum to total
        assert(royaltyAmount + protocolFee + sellerAmount == totalPrice);
    }

    /// @notice Proves royalty cap is enforced
    function check_buy_royaltyCapped(
        uint256 salePrice,
        uint96 royaltyBps
    ) public {
        vm.assume(salePrice > 0 && salePrice <= 1000 ether);
        vm.assume(royaltyBps <= 1000);

        address seller = address(0x1);
        
        // Setup with royalty
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "test", address(0x3), royaltyBps, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 100, salePrice, address(0), 7 days);

        // Get quote
        (, uint256 royaltyAmount,,) = marketplace.quoteBuy(listingId, 1);

        // Prove: royalty capped at 25%
        uint256 maxRoyalty = (salePrice * 2500) / 10000;
        assert(royaltyAmount <= maxRoyalty);
    }

    /// @notice Proves protocol fee cap is enforced
    function check_protocolFee_capped(uint256 feeBps) public {
        if (feeBps > marketplace.MAX_PROTOCOL_FEE()) {
            vm.expectRevert();
        }
        
        StemMarketplaceV2 newMarketplace = new StemMarketplaceV2(
            address(stemNFT),
            feeRecipient,
            feeBps
        );
        
        if (feeBps <= marketplace.MAX_PROTOCOL_FEE()) {
            assert(newMarketplace.protocolFeeBps() == feeBps);
        }
    }

    // ============ Listing Properties ============

    /// @notice Proves listing preserves seller's NFT until sale
    function check_list_preservesOwnership(
        uint256 amount,
        uint256 price
    ) public {
        vm.assume(amount > 0 && amount <= 100);
        vm.assume(price > 0 && price <= 100 ether);

        address seller = address(0x1);

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, amount, "test", address(0), 500, true, parentIds);

        uint256 balanceBefore = stemNFT.balanceOf(seller, tokenId);

        // List
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        marketplace.list(tokenId, amount, price, address(0), 7 days);

        uint256 balanceAfter = stemNFT.balanceOf(seller, tokenId);

        // Prove: listing doesn't transfer NFT
        assert(balanceAfter == balanceBefore);
    }

    /// @notice Proves only seller can cancel
    function check_cancel_onlySeller(address caller) public {
        address seller = address(0x1);
        
        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "test", address(0), 500, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 100, 1 ether, address(0), 7 days);

        // Try cancel
        vm.prank(caller);
        
        if (caller != seller) {
            vm.expectRevert();
        }
        
        marketplace.cancel(listingId);
    }

    // ============ Buy Properties ============

    /// @notice Proves buy transfers exact NFT amount
    function check_buy_transfersExactAmount(
        uint256 mintAmount,
        uint256 buyAmount
    ) public {
        vm.assume(mintAmount > 0 && mintAmount <= 1000);
        vm.assume(buyAmount > 0 && buyAmount <= mintAmount);

        address seller = address(0x1);
        address buyer = address(0x2);

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, mintAmount, "test", address(0), 500, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, mintAmount, 1 ether, address(0), 7 days);

        uint256 sellerBefore = stemNFT.balanceOf(seller, tokenId);
        uint256 buyerBefore = stemNFT.balanceOf(buyer, tokenId);

        // Buy
        vm.deal(buyer, buyAmount * 1 ether);
        vm.prank(buyer);
        marketplace.buy{value: buyAmount * 1 ether}(listingId, buyAmount);

        // Prove: exact amount transferred
        assert(stemNFT.balanceOf(seller, tokenId) == sellerBefore - buyAmount);
        assert(stemNFT.balanceOf(buyer, tokenId) == buyerBefore + buyAmount);
    }

    /// @notice Proves expired listings cannot be purchased
    function check_buy_rejectsExpired(uint256 timeAfterExpiry) public {
        vm.assume(timeAfterExpiry > 0 && timeAfterExpiry <= 365 days);

        address seller = address(0x1);
        address buyer = address(0x2);

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "test", address(0), 500, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 100, 1 ether, address(0), 7 days);

        // Warp past expiry
        vm.warp(block.timestamp + 7 days + timeAfterExpiry);

        // Buy should revert
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.Expired.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    /// @notice Proves insufficient payment is rejected
    function check_buy_rejectsInsufficientPayment(
        uint256 price,
        uint256 payment
    ) public {
        vm.assume(price > 0 && price <= 100 ether);
        vm.assume(payment < price);

        address seller = address(0x1);
        address buyer = address(0x2);

        // Setup
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "test", address(0), 500, true, parentIds);

        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 100, price, address(0), 7 days);

        // Buy with insufficient payment should revert
        vm.deal(buyer, payment);
        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: payment}(listingId, 1);
    }

    // ============ Admin Properties ============

    /// @notice Proves fee update respects cap
    function check_setFee_respectsCap(uint256 newFee) public {
        if (newFee > marketplace.MAX_PROTOCOL_FEE()) {
            vm.expectRevert();
        }
        
        marketplace.setProtocolFee(newFee);
        
        if (newFee <= marketplace.MAX_PROTOCOL_FEE()) {
            assert(marketplace.protocolFeeBps() == newFee);
        }
    }
}
