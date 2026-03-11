// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockContentProtectionMarketplace} from "../mocks/MockContentProtectionMarketplace.sol";

/**
 * @title StemMarketplaceV2 Unit Tests
 * @notice Comprehensive unit tests for the marketplace contract
 */
contract StemMarketplaceTest is Test {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    ERC20Mock public paymentToken;
    MockContentProtectionMarketplace public contentProtection;

    address public admin = makeAddr("admin");
    address public feeRecipient = makeAddr("feeRecipient");
    address public royaltyReceiver = makeAddr("royaltyReceiver");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");

    uint256 constant PROTOCOL_FEE_BPS = 250; // 2.5%
    uint256 constant ROYALTY_BPS = 500; // 5%
    uint256 constant LISTING_DURATION = 7 days;

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 tokenId,
        uint256 amount,
        uint256 price
    );
    event Cancelled(uint256 indexed listingId);
    event Sold(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 amount,
        uint256 totalPaid
    );
    event RoyaltyPaid(
        uint256 indexed tokenId,
        address indexed recipient,
        uint256 amount
    );

    function setUp() public {
        vm.startPrank(admin);

        // Deploy contracts
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        contentProtection = new MockContentProtectionMarketplace();
        marketplace = new StemMarketplaceV2(
            address(stemNFT),
            address(contentProtection),
            feeRecipient,
            PROTOCOL_FEE_BPS
        );
        paymentToken = new ERC20Mock("Test Token", "TEST");

        // Setup validator
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);

        // Grant minter role to seller so they can call mint()
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), seller);

        vm.stopPrank();

        // Mint NFTs for seller
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        stemNFT.mint(
            seller,
            100,
            "ipfs://test",
            royaltyReceiver,
            uint96(ROYALTY_BPS),
            true,
            parentIds
        );

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
        assertEq(
            address(marketplace.contentProtection()),
            address(contentProtection)
        );
        assertEq(marketplace.protocolFeeRecipient(), feeRecipient);
        assertEq(marketplace.protocolFeeBps(), PROTOCOL_FEE_BPS);
    }

    function test_Constructor_RevertZeroContentProtection() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.ZeroAddress.selector);
        new StemMarketplaceV2(
            address(stemNFT),
            address(0),
            feeRecipient,
            PROTOCOL_FEE_BPS
        );
    }

    function test_Constructor_RevertInvalidFee() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidFee.selector);
        new StemMarketplaceV2(
            address(stemNFT),
            address(contentProtection),
            feeRecipient,
            501
        ); // > 5%
    }

    // V-003: Zero fee recipient with non-zero fee must revert
    function test_Constructor_RevertZeroFeeRecipientWithFee() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidRecipient.selector);
        new StemMarketplaceV2(
            address(stemNFT),
            address(contentProtection),
            address(0),
            250
        );
    }

    // V-003: Zero fee recipient with zero fee is allowed (no fees charged)
    function test_Constructor_AllowsZeroRecipientWithZeroFee() public {
        vm.prank(admin);
        StemMarketplaceV2 m = new StemMarketplaceV2(
            address(stemNFT),
            address(contentProtection),
            address(0),
            0
        );
        assertEq(m.protocolFeeBps(), 0);
    }

    // V-003: setProtocolFee rejects non-zero fee when recipient is address(0)
    function test_SetProtocolFee_RevertWhenRecipientZero() public {
        vm.prank(admin);
        StemMarketplaceV2 m = new StemMarketplaceV2(
            address(stemNFT),
            address(contentProtection),
            address(0),
            0
        );
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidRecipient.selector);
        m.setProtocolFee(250);
    }

    // ============ Listing Tests ============

    function test_List_CreatesListing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.seller, seller);
        assertEq(listing.tokenId, 1);
        assertEq(listing.amount, 50);
        assertEq(listing.pricePerUnit, 1 ether);
        assertEq(listing.paymentToken, address(0));
        assertEq(listing.expiry, block.timestamp + LISTING_DURATION);
    }

    function test_List_WithERC20() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            100e18,
            address(paymentToken),
            LISTING_DURATION
        );

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.paymentToken, address(paymentToken));
    }

    function test_List_EmitsEvent() public {
        vm.prank(seller);
        vm.expectEmit(true, true, false, true);
        emit Listed(1, seller, 1, 50, 1 ether);
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    function test_ListLastMint_CreatesListingForLatestMint() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 releaseId = 99;
        contentProtection.setMaxListingPrice(releaseId, 1 ether);

        vm.startPrank(seller);
        stemNFT.mint(
            seller,
            1,
            "ipfs://latest",
            royaltyReceiver,
            uint96(ROYALTY_BPS),
            true,
            parentIds
        );

        uint256 listingId = marketplace.listLastMint(
            1,
            0.25 ether,
            address(0),
            LISTING_DURATION,
            releaseId
        );
        vm.stopPrank();

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.tokenId, 2);
        assertEq(listing.seller, seller);
        assertEq(listing.amount, 1);
        assertEq(listing.pricePerUnit, 0.25 ether);
        assertEq(contentProtection.stemToReleaseRoot(2), releaseId);
    }

    function test_ListLastMint_RevertWhenMintIsNotRecent() public {
        vm.roll(block.number + 1);

        vm.prank(seller);
        vm.expectRevert(StemMarketplaceV2.NoRecentMint.selector);
        marketplace.listLastMint(1, 1 ether, address(0), LISTING_DURATION, 1);
    }

    function test_List_RevertPriceExceedsStakeCap() public {
        contentProtection.setMaxListingPrice(1, 0.5 ether);
        contentProtection.registerStemProtectionRoot(1, 1);

        vm.prank(seller);
        vm.expectRevert(StemMarketplaceV2.PriceExceedsStakeCap.selector);
        marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);
    }

    function test_List_WithinCap() public {
        contentProtection.setMaxListingPrice(1, 1 ether);
        contentProtection.registerStemProtectionRoot(1, 1);

        vm.prank(seller);
        uint256 listingId =
            marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.pricePerUnit, 1 ether);
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
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(seller);
        marketplace.cancel(listingId);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.seller, address(0));
    }

    function test_Cancel_EmitsEvent() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(seller);
        vm.expectEmit(true, false, false, false);
        emit Cancelled(listingId);
        marketplace.cancel(listingId);
    }

    function test_Cancel_RevertNotSeller() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.NotSeller.selector);
        marketplace.cancel(listingId);
    }

    // ============ Buy Tests ============

    function test_Buy_TransfersNFT() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        assertEq(stemNFT.balanceOf(buyer, 1), 10);
        assertEq(stemNFT.balanceOf(seller, 1), 90);
    }

    function test_Buy_DistributesPayments() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

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
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

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
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.amount, 40);
    }

    function test_Buy_DeletesListingWhenEmpty() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.deal(buyer, 100 ether); // Ensure buyer has enough ETH
        vm.prank(buyer);
        marketplace.buy{value: 50 ether}(listingId, 50);

        StemMarketplaceV2.Listing memory listing = marketplace.getListing(
            listingId
        );
        assertEq(listing.seller, address(0));
    }

    function test_Buy_RevertExcessPayment() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: 15 ether}(listingId, 10); // Overpay by 5 ETH — should revert
    }

    function test_Buy_WithERC20() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            100e18,
            address(paymentToken),
            LISTING_DURATION
        );

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
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.warp(block.timestamp + LISTING_DURATION + 1);

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.Expired.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RevertInsufficientAmount() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientAmount.selector);
        marketplace.buy{value: 100 ether}(listingId, 100); // Only 50 available
    }

    function test_Buy_RevertInsufficientPayment() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: 0.5 ether}(listingId, 1); // Need 1 ETH
    }

    // ============ Quote Tests ============

    function test_QuoteBuy() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

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
        uint256 tokenId = stemNFT.mint(
            seller,
            100,
            "ipfs://test2",
            royaltyReceiver,
            1000,
            true,
            parentIds
        );

        vm.prank(seller);
        uint256 listingId = marketplace.list(
            tokenId,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        // Royalty is capped at 25% by marketplace (but token only has 10%)
        (, uint256 royaltyAmount, , ) = marketplace.quoteBuy(listingId, 10);
        assertEq(royaltyAmount, 1 ether); // 10% of 10 ETH
    }

    // ============ Edge Case Tests ============

    function test_Buy_ZeroRoyalty() public {
        // Create listing for token with zero royalty
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(
            seller,
            100,
            "ipfs://test2",
            royaltyReceiver,
            1,
            true,
            parentIds
        );

        vm.prank(seller);
        stemNFT.setRoyaltyBps(tokenId, 0);

        vm.prank(seller);
        uint256 listingId = marketplace.list(
            tokenId,
            50,
            1 ether,
            address(0),
            LISTING_DURATION
        );

        uint256 sellerBefore = seller.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(buyer);
        marketplace.buy{value: 10 ether}(listingId, 10);

        // All goes to seller minus protocol fee (no royalty)
        assertEq(seller.balance - sellerBefore, 10 ether - 0.25 ether);
        assertEq(feeRecipient.balance - feeBefore, 0.25 ether);
    }

    function test_Receive_AcceptsETH() public {
        (bool success, ) = address(marketplace).call{value: 1 ether}("");
        assertTrue(success);
    }

    // ============ Approval Check Tests ============

    function test_List_RevertNotApproved() public {
        // Revoke approval
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), false);

        vm.prank(seller);
        vm.expectRevert(StemMarketplaceV2.MarketplaceNotApproved.selector);
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    // ============ Zero-Address Guard Tests ============

    function test_SetFeeRecipient_RevertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidRecipient.selector);
        marketplace.setFeeRecipient(address(0));
    }

    // ============ Trapped ETH Tests ============

    function test_WithdrawTrappedETH() public {
        // Send ETH directly to marketplace
        vm.deal(address(marketplace), 5 ether);

        address recipient = makeAddr("ethRecipient");
        uint256 before = recipient.balance;

        vm.prank(admin);
        marketplace.withdrawTrappedETH(recipient);

        assertEq(recipient.balance - before, 5 ether);
        assertEq(address(marketplace).balance, 0);
    }

    function test_WithdrawTrappedETH_RevertNotOwner() public {
        vm.deal(address(marketplace), 5 ether);

        vm.prank(seller);
        vm.expectRevert();
        marketplace.withdrawTrappedETH(seller);
    }

    function test_WithdrawTrappedETH_RevertZeroAddress() public {
        vm.deal(address(marketplace), 5 ether);

        vm.prank(admin);
        vm.expectRevert(StemMarketplaceV2.InvalidRecipient.selector);
        marketplace.withdrawTrappedETH(address(0));
    }

    // ============ V-001 Regression: ETH Rejection on ERC20 Buy ============

    /// @notice evmbench V-001: buy() must reject msg.value when listing uses ERC20 payment token
    function test_Buy_RevertETHWithERC20Listing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            100e18,
            address(paymentToken),
            LISTING_DURATION
        );

        // Attempt to send ETH alongside an ERC20 purchase — must revert
        vm.prank(buyer);
        vm.expectRevert(StemMarketplaceV2.UnexpectedETH.selector);
        marketplace.buy{value: 1 ether}(listingId, 10);

        // Verify no ETH was trapped
        assertEq(address(marketplace).balance, 0);
    }

    /// @notice Ensure normal ERC20 buy (no ETH) still works after the fix
    function test_Buy_ERC20WithoutETH_StillWorks() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(
            1,
            50,
            100e18,
            address(paymentToken),
            LISTING_DURATION
        );

        vm.prank(buyer);
        marketplace.buy(listingId, 10);

        assertEq(stemNFT.balanceOf(buyer, 1), 10);
        assertEq(address(marketplace).balance, 0);
    }
}
