// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {IStemMarketplaceV2} from "../../src/interfaces/IStemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {WrappedNativeMock} from "../../src/payments/WrappedNativeMock.sol";
import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockFeeOnTransferToken} from "../mocks/MockFeeOnTransferToken.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";
import {MockContentProtectionMarketplace} from "../mocks/MockContentProtectionMarketplace.sol";
import {StemMarketplaceProxyDeployer} from "../utils/StemMarketplaceProxyDeployer.sol";

/**
 * @notice Test-only stand-in for the smart account of a batched purchase (#1964).
 * @dev The DJ's passkey smart account sends ONE user operation that approves the
 *      payment token once and then calls `buy` for each approved line. This
 *      contract does the same in one external call, so the marketplace sees a
 *      contract buyer exactly as it does for the real account. It holds no
 *      logic of its own and is never deployed.
 */
contract BatchBuyer {
    /// @dev ERC-1155 receiver hook: the marketplace transfers each bought stem here.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61; // IERC1155Receiver.onERC1155Received.selector
    }

    /// @notice approve(`approveAmount`) then buy every line; any revert reverts all of it.
    function approveAndBuy(
        StemMarketplaceV2 market,
        MockUSDC token,
        uint256 approveAmount,
        uint256[] calldata listingIds,
        uint256[] calldata amounts
    ) external {
        token.approve(address(market), approveAmount);
        for (uint256 i = 0; i < listingIds.length; ++i) {
            market.buy(listingIds[i], amounts[i]);
        }
    }
}

/**
 * @title StemMarketplaceV2 Unit Tests
 * @notice Comprehensive unit tests for the marketplace contract
 */
contract StemMarketplaceTest is Test, IStemMarketplaceV2 {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    PaymentAssetRegistry public paymentAssetRegistry;
    ERC20Mock public paymentToken;
    MockUSDC public usdc;
    WrappedNativeMock public weth;
    MockContentProtectionMarketplace public contentProtection;
    uint256 public authorizerKey = 0xA11CE;

    address public admin = makeAddr("admin");
    address public upgradeAuthority = makeAddr("upgradeAuthority");
    address public feeRecipient = makeAddr("feeRecipient");
    address public royaltyReceiver = makeAddr("royaltyReceiver");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");
    address public recipient = makeAddr("recipient");
    address public authorizer;

    uint256 constant PROTOCOL_FEE_BPS = 250; // 2.5%
    uint96 constant ROYALTY_BPS = 500; // 5%
    uint256 constant LISTING_DURATION = 7 days;
    bytes32 constant LOCAL_ETH = keccak256("local:eth");
    bytes32 constant LOCAL_TEST = keccak256("local:test");
    bytes32 constant LOCAL_USDC = keccak256("local:usdc");
    bytes32 constant LOCAL_WETH = keccak256("local:weth");

    function setUp() public {
        authorizer = vm.addr(authorizerKey);
        vm.startPrank(admin);

        // Deploy contracts
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        contentProtection = new MockContentProtectionMarketplace();
        paymentAssetRegistry = new PaymentAssetRegistry(admin);
        paymentToken = new ERC20Mock("Test Token", "TEST");
        usdc = new MockUSDC();
        weth = new WrappedNativeMock();
        paymentAssetRegistry.configureAsset(LOCAL_ETH, address(0), "ETH", 18, true, false);
        paymentAssetRegistry.configureAsset(LOCAL_TEST, address(paymentToken), "TEST", 18, true, false);
        paymentAssetRegistry.configureAsset(LOCAL_USDC, address(usdc), "USDC", 6, true, true);
        paymentAssetRegistry.configureAsset(LOCAL_WETH, address(weth), "WETH", 18, true, false);
        marketplace = StemMarketplaceProxyDeployer.deploy(
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            feeRecipient,
            PROTOCOL_FEE_BPS,
            admin,
            upgradeAuthority
        );

        // Setup validator
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);

        // Grant minter role to seller so they can call mint()
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), seller);
        stemNFT.grantRole(stemNFT.MINT_AUTHORIZER_ROLE(), authorizer);
        stemNFT.setContentProtection(address(contentProtection));

        vm.stopPrank();

        // Mint NFTs for seller
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        stemNFT.mint(seller, 100, "ipfs://test", royaltyReceiver, ROYALTY_BPS, true, parentIds);

        // Approve marketplace
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);

        // Fund buyer
        vm.deal(buyer, 100 ether);
        paymentToken.mint(buyer, 1000 ether);
        usdc.mint(buyer, 1000_000000);
        vm.prank(buyer);
        weth.deposit{value: 50 ether}();
        vm.prank(buyer);
        paymentToken.approve(address(marketplace), type(uint256).max);
        vm.prank(buyer);
        usdc.approve(address(marketplace), type(uint256).max);
        vm.prank(buyer);
        weth.approve(address(marketplace), type(uint256).max);
    }

    // ============ Initialization Tests ============

    function test_Initialize_SetsConfiguration() public view {
        assertEq(address(marketplace.stemNFT()), address(stemNFT));
        assertEq(address(marketplace.contentProtection()), address(contentProtection));
        assertEq(address(marketplace.paymentAssetRegistry()), address(paymentAssetRegistry));
        assertEq(marketplace.protocolFeeRecipient(), feeRecipient);
        assertEq(marketplace.protocolFeeBps(), PROTOCOL_FEE_BPS);
    }

    /// @notice #1285 — buying with a fee-on-transfer payment token reverts instead of
    /// the marketplace receiving less than it distributes.
    function test_Buy_RevertFeeOnTransferToken() public {
        MockFeeOnTransferToken feeToken = new MockFeeOnTransferToken(100); // 1% fee
        vm.prank(admin);
        paymentAssetRegistry.configureAsset(keccak256("local:fee"), address(feeToken), "FEE", 18, true, false);

        // Seller lists tokenId 1 (minted in setUp) priced in the fee token.
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 10, 1 ether, address(feeToken), LISTING_DURATION);

        feeToken.mint(buyer, 100 ether);
        vm.prank(buyer);
        feeToken.approve(address(marketplace), type(uint256).max);

        uint256 totalPrice = 1 ether; // buy 1 unit
        uint256 received = totalPrice - (totalPrice * 100) / 10_000;
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(FeeOnTransferNotSupported.selector, totalPrice, received)
        );
        marketplace.buy(listingId, 1);
    }

    /// @notice #1287 — a reverting (creator-controlled) royalty receiver cannot brick
    /// an ETH sale; the royalty leg is escrowed and reclaimed via claimFailedPayment.
    function test_Buy_EscrowsRoyaltyOnRevertingReceiver() public {
        RevertingReceiver receiver = new RevertingReceiver();

        // Seller mints a stem whose royalty receiver rejects ETH.
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId = stemNFT.mint(seller, 100, "ipfs://r", address(receiver), ROYALTY_BPS, true, parentIds);
        vm.prank(seller);
        uint256 listingId = marketplace.list(tokenId, 10, 1 ether, address(0), LISTING_DURATION);

        uint256 royalty = (1 ether * ROYALTY_BPS) / 10000; // 5% of 1 ether
        vm.prank(buyer);
        marketplace.buy{value: 1 ether}(listingId, 1); // does NOT revert

        // Royalty leg escrowed; NFT delivered to the buyer.
        assertEq(marketplace.failedPayments(address(0), address(receiver)), royalty, "royalty escrowed");
        assertEq(stemNFT.balanceOf(buyer, tokenId), 1, "NFT delivered");

        // Royalty receiver reclaims once it can accept ETH.
        receiver.setReject(false);
        uint256 before = address(receiver).balance;
        vm.prank(address(receiver));
        marketplace.claimFailedPayment(address(0));
        assertEq(address(receiver).balance - before, royalty, "claimed");
    }

    function test_Initialize_RevertZeroContentProtection() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(ZeroAddress.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation,
            address(stemNFT),
            address(0),
            address(paymentAssetRegistry),
            feeRecipient,
            PROTOCOL_FEE_BPS,
            admin,
            upgradeAuthority
        );
    }

    function test_Initialize_RevertZeroPaymentAssetRegistry() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(ZeroAddress.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation,
            address(stemNFT),
            address(contentProtection),
            address(0),
            feeRecipient,
            PROTOCOL_FEE_BPS,
            admin,
            upgradeAuthority
        );
    }

    function test_Initialize_RevertInvalidFee() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(IStemMarketplaceV2.InvalidFee.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation,
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            feeRecipient,
            1501,
            admin,
            upgradeAuthority
        ); // > 15%
    }

    // V-003: Zero fee recipient with non-zero fee must revert
    function test_Initialize_RevertZeroFeeRecipientWithFee() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(IStemMarketplaceV2.InvalidRecipient.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation,
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            address(0),
            250,
            admin,
            upgradeAuthority
        );
    }

    // V-003: Zero fee recipient with zero fee is allowed (no fees charged)
    function test_Initialize_AllowsZeroRecipientWithZeroFee() public {
        StemMarketplaceV2 m = StemMarketplaceProxyDeployer.deploy(
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            address(0),
            0,
            admin,
            upgradeAuthority
        );
        assertEq(m.protocolFeeBps(), 0);
    }

    // V-003: setProtocolFee rejects non-zero fee when recipient is address(0)
    function test_SetProtocolFee_RevertWhenRecipientZero() public {
        StemMarketplaceV2 m = StemMarketplaceProxyDeployer.deploy(
            address(stemNFT),
            address(contentProtection),
            address(paymentAssetRegistry),
            address(0),
            0,
            admin,
            upgradeAuthority
        );
        vm.prank(admin);
        vm.expectRevert(IStemMarketplaceV2.InvalidRecipient.selector);
        m.setProtocolFee(250);
    }

    function test_PauseBlocksListingsAndPurchasesButKeepsRecoveryLive() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 10, 1 ether, address(0), LISTING_DURATION);

        vm.prank(admin);
        marketplace.setPaused(true);

        vm.prank(seller);
        vm.expectRevert(Paused.selector);
        marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        vm.prank(seller);
        vm.expectRevert(Paused.selector);
        marketplace.listLastMint(1, 1 ether, address(0), LISTING_DURATION, 0);

        vm.prank(buyer);
        vm.expectRevert(Paused.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);

        vm.prank(buyer);
        vm.expectRevert(Paused.selector);
        marketplace.buyFor{value: 1 ether}(listingId, 1, recipient);

        // Sellers can unwind and recipients can still reach the failed-payment
        // recovery path while the marketplace is stopped.
        vm.prank(seller);
        marketplace.cancel(listingId);
        vm.prank(royaltyReceiver);
        vm.expectRevert(NothingToClaim.selector);
        marketplace.claimFailedPayment(address(0));

        marketplace.getListing(listingId);
        marketplace.quoteBuy(listingId, 1);
        vm.startPrank(admin);
        marketplace.setProtocolFee(PROTOCOL_FEE_BPS);
        marketplace.setFeeRecipient(feeRecipient);
        marketplace.setPaymentAssetRegistry(address(paymentAssetRegistry));
        marketplace.setPaused(false);
        vm.stopPrank();
        assertFalse(marketplace.paused());
    }

    function test_SetPaymentAssetRegistryChangesListingAllowlist() public {
        PaymentAssetRegistry nextRegistry = new PaymentAssetRegistry(admin);
        vm.prank(admin);
        nextRegistry.configureAsset(keccak256("local:replacement"), address(paymentToken), "TEST", 18, true, false);

        vm.prank(admin);
        marketplace.setPaymentAssetRegistry(address(nextRegistry));

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.UnsupportedPaymentAsset.selector);
        marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 1, 1 ether, address(paymentToken), LISTING_DURATION);
        assertEq(marketplace.getListing(listingId).paymentToken, address(paymentToken));
    }

    // ============ Listing Tests ============

    function test_List_CreatesListing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
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

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.paymentToken, address(paymentToken));
    }

    function test_List_AllowsExpiryAtUint40Max() public {
        vm.warp(type(uint40).max - LISTING_DURATION);

        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.expiry, type(uint40).max);
    }

    function test_List_RevertExpiryOverflow() public {
        vm.warp(type(uint40).max - LISTING_DURATION + 1);

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.ListingExpiryOverflow.selector);
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    function test_List_RevertUnsupportedPaymentAsset() public {
        ERC20Mock unsupported = new ERC20Mock("Unsupported", "NOPE");

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.UnsupportedPaymentAsset.selector);
        marketplace.list(1, 50, 100e18, address(unsupported), LISTING_DURATION);
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
        stemNFT.mint(seller, 1, "ipfs://latest", royaltyReceiver, ROYALTY_BPS, true, parentIds);

        uint256 listingId = marketplace.listLastMint(1, 0.25 ether, address(0), LISTING_DURATION, releaseId);
        vm.stopPrank();

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.tokenId, 2);
        assertEq(listing.seller, seller);
        assertEq(listing.amount, 1);
        assertEq(listing.pricePerUnit, 0.25 ether);
        assertEq(contentProtection.stemToReleaseRoot(2), releaseId);
    }

    function test_ListLastMint_RevertWhenMintIsNotRecent() public {
        vm.roll(block.number + 1);

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.NoRecentMint.selector);
        marketplace.listLastMint(1, 1 ether, address(0), LISTING_DURATION, 1);
    }

    function test_List_RevertPriceExceedsStakeCap() public {
        contentProtection.setMaxListingPrice(1, 0.5 ether);
        contentProtection.registerStemProtectionRoot(1, 1);

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.PriceExceedsStakeCap.selector);
        marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);
    }

    function test_List_WithinCap() public {
        contentProtection.setMaxListingPrice(1, 1 ether);
        contentProtection.registerStemProtectionRoot(1, 1);

        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.pricePerUnit, 1 ether);
    }

    // ── CP-4 (#1271): stake-backed price cap re-enforced at purchase ────────

    function test_Buy_RevertWhenCapLoweredAfterListing() public {
        contentProtection.registerStemProtectionRoot(1, 1);
        contentProtection.setMaxListingPrice(1, 1 ether);

        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        // The cap moves below the listed price after listing (e.g. the owner lowers
        // maxPriceMultiplier). The listing-time check alone would let this transact.
        contentProtection.setMaxListingPrice(1, 0.5 ether);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.PriceExceedsStakeCap.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RelistWithinLoweredCapSucceeds() public {
        contentProtection.registerStemProtectionRoot(1, 1);
        contentProtection.setMaxListingPrice(1, 1 ether);

        vm.prank(seller);
        uint256 oldListingId = marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        contentProtection.setMaxListingPrice(1, 0.5 ether);

        // The seller can cancel and relist within the new cap; the purchase succeeds.
        vm.startPrank(seller);
        marketplace.cancel(oldListingId);
        uint256 listingId = marketplace.list(1, 1, 0.5 ether, address(0), LISTING_DURATION);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buy{value: 0.5 ether}(listingId, 1);
        assertEq(stemNFT.balanceOf(buyer, 1), 1);
    }

    function test_Buy_AllowedWhenStakeNoLongerActive() public {
        contentProtection.registerStemProtectionRoot(1, 1);
        contentProtection.setMaxListingPrice(1, 1 ether);

        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 1, 1 ether, address(0), LISTING_DURATION);

        // Stake refunded => getMaxListingPrice returns type(uint256).max (the mock
        // treats 0 as unset), so the existing listing stays purchasable by design.
        contentProtection.setMaxListingPrice(1, 0);

        vm.prank(buyer);
        marketplace.buy{value: 1 ether}(listingId, 1);
        assertEq(stemNFT.balanceOf(buyer, 1), 1);
    }

    function test_List_ProtectedMint_RevertPriceExceedsStakeCapWithoutManualRootRegistration() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 releaseId = 77;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stake-cap-auto-root");

        contentProtection.setAttested(releaseId, true);
        contentProtection.setMaxListingPrice(releaseId, 1 ether);

        bytes32 digest = stemNFT.hashMintAuthorization(
            seller,
            seller,
            1,
            "ipfs://protected-stem",
            releaseId,
            royaltyReceiver,
            ROYALTY_BPS,
            true,
            parentIds,
            deadline,
            nonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(authorizerKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(seller);
        uint256 tokenId = stemNFT.mintAuthorized(
            seller,
            1,
            "ipfs://protected-stem",
            releaseId,
            royaltyReceiver,
            ROYALTY_BPS,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );

        assertEq(contentProtection.stemToReleaseRoot(tokenId), releaseId);

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.PriceExceedsStakeCap.selector);
        marketplace.list(tokenId, 1, 2 ether, address(0), LISTING_DURATION);
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

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
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
        vm.expectRevert(IStemMarketplaceV2.NotSeller.selector);
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

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.amount, 40);
    }

    function test_Buy_DeletesListingWhenEmpty() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.deal(buyer, 100 ether); // Ensure buyer has enough ETH
        vm.prank(buyer);
        marketplace.buy{value: 50 ether}(listingId, 50);

        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, address(0));
    }

    function test_Buy_RevertExcessPayment() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: 15 ether}(listingId, 10); // Overpay by 5 ETH — should revert
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

    function test_BuyFor_WithERC20_TransfersStemToRecipient() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        uint256 buyerBefore = paymentToken.balanceOf(buyer);
        uint256 sellerBefore = paymentToken.balanceOf(seller);
        uint256 recipientBefore = stemNFT.balanceOf(recipient, 1);

        vm.prank(buyer);
        marketplace.buyFor(listingId, 10, recipient);

        assertEq(buyerBefore - paymentToken.balanceOf(buyer), 1000e18);
        assertTrue(paymentToken.balanceOf(seller) > sellerBefore);
        assertEq(stemNFT.balanceOf(recipient, 1) - recipientBefore, 10);
        assertEq(stemNFT.balanceOf(buyer, 1), 0);
    }

    function test_BuyFor_EmitsRecipientAsBuyer() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100_000000, address(usdc), LISTING_DURATION);

        vm.expectEmit(true, true, false, true);
        emit Sold(listingId, recipient, 1, 100_000000);

        vm.prank(buyer);
        marketplace.buyFor(listingId, 1, recipient);
    }

    function test_BuyFor_RevertZeroRecipient() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InvalidRecipient.selector);
        marketplace.buyFor(listingId, 1, address(0));
    }

    function test_BuyFor_RevertSellerRecipient() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.CannotBuyOwnListing.selector);
        marketplace.buyFor(listingId, 1, seller);
    }

    function test_Buy_WithUSDC() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100_000000, address(usdc), LISTING_DURATION);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        marketplace.buy(listingId, 10);

        assertEq(buyerBefore - usdc.balanceOf(buyer), 1000_000000);
        assertTrue(usdc.balanceOf(seller) > sellerBefore);
    }

    function test_Buy_WithWETH() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(weth), LISTING_DURATION);

        uint256 buyerBefore = weth.balanceOf(buyer);
        uint256 sellerBefore = weth.balanceOf(seller);

        vm.prank(buyer);
        marketplace.buy(listingId, 10);

        assertEq(buyerBefore - weth.balanceOf(buyer), 10 ether);
        assertTrue(weth.balanceOf(seller) > sellerBefore);
    }

    function test_Buy_RevertInvalidListing() public {
        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InvalidListing.selector);
        marketplace.buy{value: 1 ether}(999, 1);
    }

    function test_Buy_RevertExpired() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.warp(block.timestamp + LISTING_DURATION + 1);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.Expired.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RevertInsufficientAmount() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.deal(buyer, 100 ether);
        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientAmount.selector);
        marketplace.buy{value: 100 ether}(listingId, 100); // Only 50 available
    }

    // ── #1284: zero-amount buy is rejected ──────────────────────────────────

    function test_Buy_RevertZeroAmount() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 10, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientAmount.selector);
        marketplace.buy(listingId, 0);
    }

    // ── #1283: stale listings fail early on re-validation ───────────────────

    function test_Buy_RevertStaleListingSellerExited() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 10, 1 ether, address(0), LISTING_DURATION);

        // Seller transfers all units away after listing → stale listing.
        vm.prank(seller);
        stemNFT.safeTransferFrom(seller, recipient, 1, 100, "");

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientAmount.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RevertListingNotApproved() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 10, 1 ether, address(0), LISTING_DURATION);

        // Seller revokes marketplace approval after listing.
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), false);

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.MarketplaceNotApproved.selector);
        marketplace.buy{value: 1 ether}(listingId, 1);
    }

    function test_Buy_RevertInsufficientPayment() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        vm.prank(buyer);
        vm.expectRevert(IStemMarketplaceV2.InsufficientPayment.selector);
        marketplace.buy{value: 0.5 ether}(listingId, 1); // Need 1 ETH
    }

    // ============ Quote Tests ============

    function test_QuoteBuy() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);

        (uint256 totalPrice, uint256 royaltyAmount, uint256 protocolFee, uint256 sellerAmount) =
            marketplace.quoteBuy(listingId, 10);

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
        vm.expectRevert(IStemMarketplaceV2.InvalidFee.selector);
        marketplace.setProtocolFee(1501);
    }

    function test_SetProtocolFee_AcceptsDecidedRateAndCap() public {
        // ADR-BM-2: 1000 bps is the decided production rate; 1500 is the cap.
        vm.startPrank(admin);
        marketplace.setProtocolFee(1000);
        assertEq(marketplace.protocolFeeBps(), 1000);
        marketplace.setProtocolFee(1500);
        assertEq(marketplace.protocolFeeBps(), 1500);
        vm.stopPrank();
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
        (, uint256 royaltyAmount,,) = marketplace.quoteBuy(listingId, 10);
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

    // ============ Approval Check Tests ============

    function test_List_RevertNotApproved() public {
        // Revoke approval
        vm.prank(seller);
        stemNFT.setApprovalForAll(address(marketplace), false);

        vm.prank(seller);
        vm.expectRevert(IStemMarketplaceV2.MarketplaceNotApproved.selector);
        marketplace.list(1, 50, 1 ether, address(0), LISTING_DURATION);
    }

    // ============ Zero-Address Guard Tests ============

    function test_SetFeeRecipient_RevertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(IStemMarketplaceV2.InvalidRecipient.selector);
        marketplace.setFeeRecipient(address(0));
    }

    // ============ Trapped ETH Tests ============

    function test_WithdrawTrappedETH() public {
        // Send ETH directly to marketplace
        vm.deal(address(marketplace), 5 ether);

        address ethRecipient = makeAddr("ethRecipient");
        uint256 before = ethRecipient.balance;

        vm.prank(admin);
        marketplace.withdrawTrappedETH(ethRecipient);

        assertEq(ethRecipient.balance - before, 5 ether);
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
        vm.expectRevert(IStemMarketplaceV2.InvalidRecipient.selector);
        marketplace.withdrawTrappedETH(address(0));
    }

    // ============ V-001 Regression: ETH Rejection on ERC20 Buy ============

    /// @notice evmbench V-001: buy() must reject msg.value when listing uses ERC20 payment token
    function test_Buy_RevertETHWithERC20Listing() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        // Attempt to send ETH alongside an ERC20 purchase — must revert
        vm.prank(buyer);
        vm.expectRevert(UnexpectedETH.selector);
        marketplace.buy{value: 1 ether}(listingId, 10);

        // Verify no ETH was trapped
        assertEq(address(marketplace).balance, 0);
    }

    /// @notice Ensure normal ERC20 buy (no ETH) still works after the fix
    function test_Buy_ERC20WithoutETH_StillWorks() public {
        vm.prank(seller);
        uint256 listingId = marketplace.list(1, 50, 100e18, address(paymentToken), LISTING_DURATION);

        vm.prank(buyer);
        marketplace.buy(listingId, 10);

        assertEq(stemNFT.balanceOf(buyer, 1), 10);
        assertEq(address(marketplace).balance, 0);
    }

    // ============ Batched purchase (#1964) ============

    /// @dev Three USDC listings from two sellers (two tokens, two royalty receivers),
    ///      the shape of a crate quote; returns listing ids and the amounts to buy.
    function _listBatch(uint256 shortDuration)
        internal
        returns (uint256[] memory listingIds, uint256[] memory amounts, uint256 token2)
    {
        address seller2 = makeAddr("seller2");
        address royaltyReceiver2 = makeAddr("royaltyReceiver2");

        // Read the role first: `vm.prank` applies to the next call only.
        bytes32 minterRole = stemNFT.MINTER_ROLE();
        vm.prank(admin);
        stemNFT.grantRole(minterRole, seller2);
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller2);
        token2 = stemNFT.mint(seller2, 100, "ipfs://test2", royaltyReceiver2, 300, true, parentIds);
        vm.prank(seller2);
        stemNFT.setApprovalForAll(address(marketplace), true);

        listingIds = new uint256[](3);
        amounts = new uint256[](3);
        // Line 1: seller, token 1 (5% royalty to royaltyReceiver), 2 units at 10 USDC.
        vm.prank(seller);
        listingIds[0] = marketplace.list(1, 10, 10_000000, address(usdc), LISTING_DURATION);
        amounts[0] = 2;
        // Line 2: seller2, token 2 (3% royalty to royaltyReceiver2), 1 unit at 25 USDC.
        vm.prank(seller2);
        listingIds[1] = marketplace.list(token2, 5, 25_000000, address(usdc), LISTING_DURATION);
        amounts[1] = 1;
        // Line 3: seller2 again, 2 units at 7.5 USDC; the duration is the caller's choice.
        vm.prank(seller2);
        listingIds[2] = marketplace.list(token2, 3, 7_500000, address(usdc), shortDuration);
        amounts[2] = 2;
    }

    /// @dev USDC balances of every party a batched purchase touches.
    struct BatchBalances {
        uint256 buyer;
        uint256 seller1;
        uint256 seller2;
        uint256 royalty1;
        uint256 royalty2;
        uint256 fee;
    }

    function _batchBalances(address buyerAddress) internal returns (BatchBalances memory balances) {
        balances.buyer = usdc.balanceOf(buyerAddress);
        balances.seller1 = usdc.balanceOf(seller);
        balances.seller2 = usdc.balanceOf(makeAddr("seller2"));
        balances.royalty1 = usdc.balanceOf(royaltyReceiver);
        balances.royalty2 = usdc.balanceOf(makeAddr("royaltyReceiver2"));
        balances.fee = usdc.balanceOf(feeRecipient);
    }

    /// @dev The movements the contract's own `quoteBuy` promises for the batch.
    ///      `buyer` is the total the buyer pays; line 1 is seller / token 1, lines
    ///      2 and 3 are seller2 / token 2.
    function _quotedMovements(uint256[] memory listingIds, uint256[] memory amounts)
        internal
        view
        returns (BatchBalances memory moved)
    {
        for (uint256 i = 0; i < listingIds.length; ++i) {
            (uint256 total, uint256 royalty, uint256 fee, uint256 sellerAmount) =
                marketplace.quoteBuy(listingIds[i], amounts[i]);
            moved.buyer += total;
            moved.fee += fee;
            if (i == 0) {
                moved.royalty1 += royalty;
                moved.seller1 += sellerAmount;
            } else {
                moved.royalty2 += royalty;
                moved.seller2 += sellerAmount;
            }
        }
    }

    /// @notice One approval and N buys in one call move every balance by exactly the
    /// summed `quoteBuy` outputs, the buyer ends up holding each stem, and three
    /// `Sold` logs are emitted (what the backend matches a quote against).
    function test_BatchBuy_OneApproval_MatchesQuotes() public {
        (uint256[] memory listingIds, uint256[] memory amounts, uint256 token2) = _listBatch(LISTING_DURATION);
        BatchBuyer batcher = new BatchBuyer();
        usdc.mint(address(batcher), 500_000000);

        BatchBalances memory expected = _quotedMovements(listingIds, amounts);
        assertEq(expected.buyer, 20_000000 + 25_000000 + 15_000000);
        assertTrue(expected.royalty1 > 0 && expected.royalty2 > 0 && expected.fee > 0);
        BatchBalances memory before = _batchBalances(address(batcher));

        vm.recordLogs();
        batcher.approveAndBuy(marketplace, usdc, expected.buyer, listingIds, amounts);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        BatchBalances memory afterBuy = _batchBalances(address(batcher));
        assertEq(before.buyer - afterBuy.buyer, expected.buyer);
        assertEq(afterBuy.seller1 - before.seller1, expected.seller1);
        assertEq(afterBuy.seller2 - before.seller2, expected.seller2);
        assertEq(afterBuy.royalty1 - before.royalty1, expected.royalty1);
        assertEq(afterBuy.royalty2 - before.royalty2, expected.royalty2);
        assertEq(afterBuy.fee - before.fee, expected.fee);
        // Nothing is left behind: not in the marketplace, not as allowance.
        assertEq(usdc.balanceOf(address(marketplace)), 0);
        assertEq(usdc.allowance(address(batcher), address(marketplace)), 0);

        assertEq(stemNFT.balanceOf(address(batcher), 1), 2);
        assertEq(stemNFT.balanceOf(address(batcher), token2), 3);

        _assertSoldLogs(entries, address(batcher), listingIds, amounts);

        // Listings are decremented on chain.
        assertEq(marketplace.getListing(listingIds[0]).amount, 8);
        assertEq(marketplace.getListing(listingIds[1]).amount, 4);
        assertEq(marketplace.getListing(listingIds[2]).amount, 1);
    }

    /// @dev Exactly one Sold log per line, in line order, each to `buyerAddress`.
    function _assertSoldLogs(
        Vm.Log[] memory entries,
        address buyerAddress,
        uint256[] memory listingIds,
        uint256[] memory amounts
    ) internal {
        bytes32 soldTopic = keccak256("Sold(uint256,address,uint256,uint256)");
        uint256 soldLogs;
        for (uint256 i = 0; i < entries.length; ++i) {
            if (entries[i].emitter != address(marketplace) || entries[i].topics[0] != soldTopic) continue;
            assertEq(uint256(entries[i].topics[1]), listingIds[soldLogs]);
            assertEq(address(uint160(uint256(entries[i].topics[2]))), buyerAddress);
            (uint256 amount,) = abi.decode(entries[i].data, (uint256, uint256));
            assertEq(amount, amounts[soldLogs]);
            soldLogs++;
        }
        assertEq(soldLogs, listingIds.length);
    }

    /// @notice One expired line reverts the whole batched call and nobody is charged
    /// or paid: this is why the web must simulate the batch and drop such lines
    /// before the DJ signs.
    function test_BatchBuy_ExpiredLineRevertsWholeBatch() public {
        // The third listing lives one hour; the first two a week.
        (uint256[] memory listingIds, uint256[] memory amounts, uint256 token2) = _listBatch(1 hours);
        BatchBuyer batcher = new BatchBuyer();
        usdc.mint(address(batcher), 500_000000);
        uint256 totalPaid = 20_000000 + 25_000000 + 15_000000;

        vm.warp(block.timestamp + 2 hours);
        BatchBalances memory before = _batchBalances(address(batcher));

        vm.expectRevert(IStemMarketplaceV2.Expired.selector);
        batcher.approveAndBuy(marketplace, usdc, totalPaid, listingIds, amounts);

        BatchBalances memory afterRevert = _batchBalances(address(batcher));
        assertEq(afterRevert.buyer, before.buyer);
        assertEq(afterRevert.seller1, before.seller1);
        assertEq(afterRevert.seller2, before.seller2);
        assertEq(afterRevert.royalty1, before.royalty1);
        assertEq(afterRevert.royalty2, before.royalty2);
        assertEq(afterRevert.fee, before.fee);
        assertEq(usdc.allowance(address(batcher), address(marketplace)), 0);
        assertEq(stemNFT.balanceOf(address(batcher), 1), 0);
        assertEq(stemNFT.balanceOf(address(batcher), token2), 0);
        // The first two lines, which were fine, are untouched too.
        assertEq(marketplace.getListing(listingIds[0]).amount, 10);
        assertEq(marketplace.getListing(listingIds[1]).amount, 5);
    }
}
