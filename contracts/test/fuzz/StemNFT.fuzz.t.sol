// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";

/**
 * @title StemNFT Fuzz Tests
 * @notice Property-based testing with random inputs
 */
contract StemNFTFuzzTest is Test {
    StemNFT public stemNFT;
    
    address public admin = makeAddr("admin");

    function setUp() public {
        vm.prank(admin);
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
    }

    // ============ Minting Fuzz Tests ============

    function testFuzz_Mint_ValidRoyalty(
        uint256 recipientSeed,
        uint256 amount,
        uint96 royaltyBps
    ) public {
        // Use makeAddr to generate deterministic EOA (avoids contract receiver issues)
        address recipient = makeAddr(string(abi.encodePacked("recipient", recipientSeed)));
        amount = bound(amount, 1, 1000000);
        royaltyBps = uint96(bound(royaltyBps, 1, 1000)); // 0.01% to 10%

        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(admin);
        uint256 tokenId = stemNFT.mint(
            recipient,
            amount,
            "ipfs://test",
            address(0),
            royaltyBps,
            true,
            parentIds
        );

        assertEq(stemNFT.balanceOf(recipient, tokenId), amount);
        
        (address receiver, uint256 royaltyAmount) = stemNFT.royaltyInfo(tokenId, 10000);
        assertEq(receiver, admin);
        assertEq(royaltyAmount, royaltyBps);
    }

    function testFuzz_Mint_InvalidRoyalty_Reverts(uint96 royaltyBps) public {
        vm.assume(royaltyBps > 1000); // > 10%

        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(StemNFT.InvalidRoyalty.selector, royaltyBps));
        stemNFT.mint(
            makeAddr("recipient"),
            100,
            "ipfs://test",
            address(0),
            royaltyBps,
            true,
            parentIds
        );
    }

    function testFuzz_Mint_MultipleEditions(
        uint256 amount1,
        uint256 amount2,
        uint256 amount3
    ) public {
        amount1 = bound(amount1, 1, 10000);
        amount2 = bound(amount2, 1, 10000);
        amount3 = bound(amount3, 1, 10000);

        uint256[] memory parentIds = new uint256[](0);
        address recipient = makeAddr("recipient");

        vm.startPrank(admin);
        uint256 tokenId1 = stemNFT.mint(recipient, amount1, "ipfs://1", address(0), 500, true, parentIds);
        uint256 tokenId2 = stemNFT.mint(recipient, amount2, "ipfs://2", address(0), 500, true, parentIds);
        uint256 tokenId3 = stemNFT.mint(recipient, amount3, "ipfs://3", address(0), 500, true, parentIds);
        vm.stopPrank();

        assertEq(stemNFT.totalSupply(tokenId1), amount1);
        assertEq(stemNFT.totalSupply(tokenId2), amount2);
        assertEq(stemNFT.totalSupply(tokenId3), amount3);
        assertEq(stemNFT.totalStems(), 3);
    }

    // ============ Royalty Fuzz Tests ============

    function testFuzz_RoyaltyInfo_CalculatesCorrectly(
        uint96 royaltyBps,
        uint256 salePrice
    ) public {
        royaltyBps = uint96(bound(royaltyBps, 1, 1000));
        salePrice = bound(salePrice, 1, 1000 ether);

        uint256[] memory parentIds = new uint256[](0);
        address royaltyReceiver = makeAddr("royaltyReceiver");

        vm.prank(admin);
        uint256 tokenId = stemNFT.mint(
            makeAddr("recipient"),
            100,
            "ipfs://test",
            royaltyReceiver,
            royaltyBps,
            true,
            parentIds
        );

        (address receiver, uint256 amount) = stemNFT.royaltyInfo(tokenId, salePrice);

        assertEq(receiver, royaltyReceiver);
        assertEq(amount, (salePrice * royaltyBps) / 10000);
    }

    // ============ Remix Fuzz Tests ============

    function testFuzz_Remix_ValidParents(uint8 numParents) public {
        numParents = uint8(bound(numParents, 1, 5));

        uint256[] memory noParents = new uint256[](0);
        
        // Create original stems
        vm.startPrank(admin);
        uint256[] memory parentIds = new uint256[](numParents);
        for (uint8 i = 0; i < numParents; i++) {
            parentIds[i] = stemNFT.mint(
                admin,
                100,
                string(abi.encodePacked("ipfs://", i)),
                address(0),
                500,
                true,
                noParents
            );
        }

        // Create remix
        uint256 remixId = stemNFT.mint(
            admin,
            50,
            "ipfs://remix",
            address(0),
            300,
            true,
            parentIds
        );
        vm.stopPrank();

        assertTrue(stemNFT.isRemix(remixId));
        assertEq(stemNFT.getParentIds(remixId).length, numParents);
    }

    // ============ Transfer Fuzz Tests ============

    function testFuzz_Transfer_Amounts(
        uint256 fromSeed,
        uint256 toSeed,
        uint256 mintAmount,
        uint256 transferAmount
    ) public {
        // Use makeAddr to generate deterministic EOA addresses (avoids contract receiver issues)
        address from = makeAddr(string(abi.encodePacked("from", fromSeed)));
        address to = makeAddr(string(abi.encodePacked("to", toSeed)));
        vm.assume(from != to);
        mintAmount = bound(mintAmount, 1, 10000);
        transferAmount = bound(transferAmount, 1, mintAmount);

        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(admin);
        uint256 tokenId = stemNFT.mint(from, mintAmount, "ipfs://test", address(0), 500, true, parentIds);

        vm.prank(from);
        stemNFT.safeTransferFrom(from, to, tokenId, transferAmount, "");

        assertEq(stemNFT.balanceOf(from, tokenId), mintAmount - transferAmount);
        assertEq(stemNFT.balanceOf(to, tokenId), transferAmount);
    }

    // ============ MintMore Fuzz Tests ============

    function testFuzz_MintMore(
        uint256 initialAmount,
        uint256 additionalAmount
    ) public {
        initialAmount = bound(initialAmount, 1, 10000);
        additionalAmount = bound(additionalAmount, 1, 10000);

        uint256[] memory parentIds = new uint256[](0);
        address recipient = makeAddr("recipient");

        vm.startPrank(admin);
        uint256 tokenId = stemNFT.mint(recipient, initialAmount, "ipfs://test", address(0), 500, true, parentIds);
        stemNFT.mintMore(recipient, tokenId, additionalAmount);
        vm.stopPrank();

        assertEq(stemNFT.totalSupply(tokenId), initialAmount + additionalAmount);
        assertEq(stemNFT.balanceOf(recipient, tokenId), initialAmount + additionalAmount);
    }

    // ============ Royalty Update Fuzz Tests ============

    function testFuzz_SetRoyaltyBps(uint96 newBps) public {
        newBps = uint96(bound(newBps, 0, 1000));

        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(admin);
        uint256 tokenId = stemNFT.mint(admin, 100, "ipfs://test", address(0), 500, true, parentIds);

        vm.prank(admin);
        stemNFT.setRoyaltyBps(tokenId, newBps);

        (, uint256 amount) = stemNFT.royaltyInfo(tokenId, 10000);
        assertEq(amount, newBps);
    }
}
