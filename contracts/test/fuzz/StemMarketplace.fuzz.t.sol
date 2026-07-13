// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {IStemMarketplaceV2} from "../../src/interfaces/IStemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockContentProtectionMarketplace} from "../mocks/MockContentProtectionMarketplace.sol";

/**
 * @title StemMarketplaceV2 Fuzz Tests
 * @notice Property-based testing for marketplace
 */
contract StemMarketplaceFuzzTest is Test {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    PaymentAssetRegistry public paymentAssetRegistry;
    MockContentProtectionMarketplace public contentProtection;

    address public admin = makeAddr("admin");
    address public feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        vm.startPrank(admin);
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        contentProtection = new MockContentProtectionMarketplace();
        paymentAssetRegistry = new PaymentAssetRegistry(admin);
        paymentAssetRegistry.configureAsset(keccak256("local:eth"), address(0), "ETH", 18, true, false);
        marketplace = new StemMarketplaceV2(
            address(stemNFT), address(contentProtection), address(paymentAssetRegistry), feeRecipient, 250
        );

        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);

        // Grant minter role to test actors used in fuzz tests
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), makeAddr("seller"));
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), makeAddr("buyer"));
        vm.stopPrank();
    }

    // ============ Listing Fuzz Tests ============

    function testFuzz_List_ValidParams(uint256 amount, uint256 pricePerUnit, uint256 duration) public {
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

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
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

    function testFuzz_Buy_RevertExcessPayment(uint256 price, uint256 excessAmount) public {
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

        // Excess ETH should revert
        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: totalSent}(listingId, 1);
    }

    // ── CP-4 (#1271): stake cap enforced at purchase time ───────────────────

    /// @notice Property: whenever a stake-backed cap is active at purchase time, a
    /// successful buy implies the listed pricePerUnit is within that cap — even if the
    /// cap moved after the listing was created.
    function testFuzz_Buy_EnforcesStakeCapAtPurchase(uint256 pricePerUnit, uint256 capAtPurchase) public {
        pricePerUnit = bound(pricePerUnit, 0.001 ether, 100 ether);
        capAtPurchase = bound(capAtPurchase, 1, 200 ether);

        address seller = makeAddr("seller");
        address buyer = makeAddr("buyer");
        uint256 releaseId = 777;

        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 10, "ipfs://test", address(0), 500, true, parentIds);

        // Cap exactly covers the price at listing time, so listing always succeeds.
        contentProtection.registerStemProtectionRoot(releaseId, tokenId);
        contentProtection.setMaxListingPrice(releaseId, pricePerUnit);

        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, 10, pricePerUnit, address(0), 7 days);
        vm.stopPrank();

        // The cap moves after listing (up or down).
        contentProtection.setMaxListingPrice(releaseId, capAtPurchase);

        vm.deal(buyer, pricePerUnit);
        vm.prank(buyer);
        if (pricePerUnit > capAtPurchase) {
            vm.expectRevert(IStemMarketplaceV2.PriceExceedsStakeCap.selector);
            marketplace.buy{value: pricePerUnit}(listingId, 1);
        } else {
            marketplace.buy{value: pricePerUnit}(listingId, 1);
            // Successful buy implies the price respected the cap active at purchase.
            assertLe(pricePerUnit, capAtPurchase);
            assertEq(stemNFT.balanceOf(buyer, tokenId), 1);
        }
    }

    // ============ Quote Fuzz Tests ============

    function testFuzz_QuoteBuy_Consistency(uint256 amount, uint256 pricePerUnit, uint96 royaltyBps) public {
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

        // Quote at the ADR-BM-2 production rate (10%), not the setUp default,
        // so the decided fee math is what conservation is proven against.
        vm.prank(admin);
        marketplace.setProtocolFee(1000);
        (uint256 totalPrice, uint256 royaltyAmount, uint256 protocolFee, uint256 sellerAmount) =
            marketplace.quoteBuy(listingId, amount);

        // Verify consistency
        assertEq(totalPrice, amount * pricePerUnit);
        assertEq(totalPrice, royaltyAmount + protocolFee + sellerAmount);

        // Verify caps. MAX_ROYALTY (25%) + MAX_PROTOCOL_FEE (15%) = 40% < 100%,
        // so sellerAmount can never underflow even at both caps.
        assertLe(royaltyAmount, (totalPrice * 2500) / 10000); // Max 25%
        assertLe(protocolFee, (totalPrice * 1500) / 10000); // Max 15%
        assertEq(protocolFee, (totalPrice * 1000) / 10000); // decided rate exact
    }

    // ============ Protocol Fee Fuzz Tests ============

    function testFuzz_SetProtocolFee(uint256 feeBps) public {
        feeBps = bound(feeBps, 0, marketplace.MAX_PROTOCOL_FEE());

        vm.prank(admin);
        marketplace.setProtocolFee(feeBps);

        assertEq(marketplace.protocolFeeBps(), feeBps);
    }

    function testFuzz_SetProtocolFee_InvalidReverts(uint256 feeBps) public {
        vm.assume(feeBps > marketplace.MAX_PROTOCOL_FEE());

        vm.prank(admin);
        vm.expectRevert(IStemMarketplaceV2.InvalidFee.selector);
        marketplace.setProtocolFee(feeBps);
    }

    // ============ Partial Buy Fuzz Tests ============

    function testFuzz_Buy_PartialPurchases(uint256[3] memory buyAmounts) public {
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
            IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
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
