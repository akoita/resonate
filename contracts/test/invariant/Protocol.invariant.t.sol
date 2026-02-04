// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";

/**
 * @title Protocol Invariant Tests
 * @notice Tests that verify protocol-wide properties hold under all conditions
 * 
 * Key Invariants:
 * 1. NFT supply never decreases (no burning)
 * 2. Royalty BPS never exceeds MAX_ROYALTY_BPS
 * 3. Protocol fee never exceeds MAX_PROTOCOL_FEE
 * 4. Total payments always equal total price
 * 5. Creator address never changes
 */
contract ProtocolInvariantTest is Test {
    StemNFT public stemNFT;
    StemMarketplaceV2 public marketplace;
    TransferValidator public validator;
    Handler public handler;

    function setUp() public {
        // Deploy protocol
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        marketplace = new StemMarketplaceV2(address(stemNFT), address(this), 250);
        
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);

        // Deploy handler
        handler = new Handler(stemNFT, marketplace);

        // Target the handler
        targetContract(address(handler));

        // Exclude certain functions
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = Handler.mintStem.selector;
        selectors[1] = Handler.listStem.selector;
        selectors[2] = Handler.buyStem.selector;
        
        targetSelector(FuzzSelector({
            addr: address(handler),
            selectors: selectors
        }));
    }

    // ============ NFT Invariants ============

    /// @notice Total stems counter only increases
    function invariant_stemCounterMonotonic() public view {
        assertGe(stemNFT.totalStems(), handler.minStemCount());
    }

    /// @notice Royalty BPS never exceeds maximum
    function invariant_royaltyBpsWithinBounds() public view {
        uint256[] memory tokenIds = handler.getTokenIds();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            (,, uint96 royaltyBps,, bool exists) = stemNFT.stems(tokenIds[i]);
            if (exists) {
                assertLe(royaltyBps, stemNFT.MAX_ROYALTY_BPS());
            }
        }
    }

    /// @notice Creator address is immutable after minting
    function invariant_creatorImmutable() public view {
        uint256[] memory tokenIds = handler.getTokenIds();
        address[] memory expectedCreators = handler.getCreators();
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            assertEq(stemNFT.getCreator(tokenIds[i]), expectedCreators[i]);
        }
    }

    // ============ Marketplace Invariants ============

    /// @notice Protocol fee never exceeds maximum
    function invariant_protocolFeeWithinBounds() public view {
        assertLe(marketplace.protocolFeeBps(), marketplace.MAX_PROTOCOL_FEE());
    }

    /// @notice All payments sum to total price
    function invariant_paymentsAddUp() public view {
        // Check handler's recorded payments
        uint256 totalPaid = handler.totalPaid();
        uint256 totalReceived = handler.sellerReceived() + 
                                handler.royaltyReceived() + 
                                handler.feeReceived();
        assertEq(totalPaid, totalReceived);
    }

    /// @notice NFT balances are conserved
    function invariant_balanceConservation() public view {
        uint256[] memory tokenIds = handler.getTokenIds();
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 totalMinted = handler.getTotalMinted(tokenId);
            
            // Sum all balances
            uint256 totalBalances;
            address[] memory holders = handler.getHolders(tokenId);
            for (uint256 j = 0; j < holders.length; j++) {
                totalBalances += stemNFT.balanceOf(holders[j], tokenId);
            }
            
            assertEq(totalBalances, totalMinted);
        }
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("Call summary:");
        console.log("  Mints:", handler.mintCount());
        console.log("  Listings:", handler.listCount());
        console.log("  Buys:", handler.buyCount());
        console.log("  Total ETH paid:", handler.totalPaid());
    }
}

/**
 * @title Handler
 * @notice Fuzzer handler that wraps protocol functions
 */
contract Handler is Test {
    StemNFT public immutable stemNFT;
    StemMarketplaceV2 public immutable marketplace;

    // Tracking state
    uint256[] public tokenIds;
    address[] public creators;
    mapping(uint256 => uint256) public totalMinted;
    mapping(uint256 => address[]) public holders;
    
    uint256 public minStemCount;
    uint256 public mintCount;
    uint256 public listCount;
    uint256 public buyCount;

    uint256 public totalPaid;
    uint256 public sellerReceived;
    uint256 public royaltyReceived;
    uint256 public feeReceived;

    // Active listings
    uint256[] public activeListings;

    // Actors
    address[] public actors;
    address public currentActor;

    constructor(StemNFT _stemNFT, StemMarketplaceV2 _marketplace) {
        stemNFT = _stemNFT;
        marketplace = _marketplace;

        // Create actors
        for (uint256 i = 0; i < 10; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(actor);
            vm.deal(actor, 1000 ether);
        }
    }

    modifier useActor(uint256 actorSeed) {
        currentActor = actors[actorSeed % actors.length];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    function mintStem(
        uint256 actorSeed,
        uint256 amount,
        uint96 royaltyBps,
        bool remixable
    ) external useActor(actorSeed) {
        amount = bound(amount, 1, 1000);
        royaltyBps = uint96(bound(royaltyBps, 1, 1000));

        uint256[] memory parentIds = new uint256[](0);
        
        uint256 tokenId = stemNFT.mint(
            currentActor,
            amount,
            "ipfs://test",
            currentActor,
            royaltyBps,
            remixable,
            parentIds
        );

        // Track state
        tokenIds.push(tokenId);
        creators.push(currentActor);
        totalMinted[tokenId] = amount;
        holders[tokenId].push(currentActor);
        
        minStemCount++;
        mintCount++;
    }

    function listStem(
        uint256 actorSeed,
        uint256 tokenIdSeed,
        uint256 amount,
        uint256 price
    ) external useActor(actorSeed) {
        if (tokenIds.length == 0) return;
        
        uint256 tokenId = tokenIds[tokenIdSeed % tokenIds.length];
        uint256 balance = stemNFT.balanceOf(currentActor, tokenId);
        if (balance == 0) return;

        amount = bound(amount, 1, balance);
        price = bound(price, 0.01 ether, 10 ether);

        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, amount, price, address(0), 7 days);
        
        activeListings.push(listingId);
        listCount++;
    }

    function buyStem(
        uint256 actorSeed,
        uint256 listingSeed,
        uint256 amount
    ) external useActor(actorSeed) {
        if (activeListings.length == 0) return;
        
        uint256 listingId = activeListings[listingSeed % activeListings.length];
        StemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        
        if (listing.seller == address(0) || listing.amount == 0) return;
        if (block.timestamp > listing.expiry) return;

        amount = bound(amount, 1, listing.amount);
        uint256 totalPrice = amount * listing.pricePerUnit;

        // Get quote
        (,uint256 royalty, uint256 fee, uint256 sellerAmt) = marketplace.quoteBuy(listingId, amount);

        // Record balances before
        uint256 sellerBefore = listing.seller.balance;
        
        // Buy
        marketplace.buy{value: totalPrice}(listingId, amount);

        // Track payments
        totalPaid += totalPrice;
        sellerReceived += sellerAmt;
        royaltyReceived += royalty;
        feeReceived += fee;

        // Track holder
        bool isNewHolder = true;
        address[] storage tokenHolders = holders[listing.tokenId];
        for (uint256 i = 0; i < tokenHolders.length; i++) {
            if (tokenHolders[i] == currentActor) {
                isNewHolder = false;
                break;
            }
        }
        if (isNewHolder) {
            tokenHolders.push(currentActor);
        }

        buyCount++;
    }

    // ============ View Functions ============

    function getTokenIds() external view returns (uint256[] memory) {
        return tokenIds;
    }

    function getCreators() external view returns (address[] memory) {
        return creators;
    }

    function getTotalMinted(uint256 tokenId) external view returns (uint256) {
        return totalMinted[tokenId];
    }

    function getHolders(uint256 tokenId) external view returns (address[] memory) {
        return holders[tokenId];
    }
}
