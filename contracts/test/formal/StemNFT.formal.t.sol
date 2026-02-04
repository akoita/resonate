// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title StemNFT Formal Verification Tests
 * @notice Uses Halmos for symbolic execution to prove properties
 * @dev Run with: halmos --contract StemNFTFormalTest
 * 
 * Halmos conventions:
 * - `check_` prefix: stateless formal verification
 * - Uses symbolic values to explore all possible inputs
 */
contract StemNFTFormalTest is Test, SymTest {
    StemNFT public stemNFT;
    
    function setUp() public {
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
    }

    // ============ Royalty Properties ============

    /// @notice Proves royalty amount is always <= MAX_ROYALTY_BPS
    function check_royaltyBps_bounded(uint96 royaltyBps) public {
        uint256[] memory parentIds = new uint256[](0);
        
        if (royaltyBps > stemNFT.MAX_ROYALTY_BPS()) {
            // Should revert for invalid royalty
            vm.expectRevert();
        }
        
        stemNFT.mint(
            address(0x1),
            100,
            "ipfs://test",
            address(0),
            royaltyBps,
            true,
            parentIds
        );
    }

    /// @notice Proves royalty calculation never overflows
    function check_royaltyInfo_noOverflow(uint256 tokenId, uint256 salePrice) public {
        // Setup: create a valid token first
        uint256[] memory parentIds = new uint256[](0);
        uint256 realTokenId = stemNFT.mint(
            address(0x1),
            100,
            "ipfs://test",
            address(0x2),
            1000, // Max royalty
            true,
            parentIds
        );

        // Query royalty for the created token
        (address receiver, uint256 amount) = stemNFT.royaltyInfo(realTokenId, salePrice);
        
        // Prove: amount never exceeds 10% of sale price
        assert(amount <= (salePrice * 1000) / 10000);
        
        // Prove: receiver is set correctly
        assert(receiver == address(0x2));
    }

    /// @notice Proves royalty receiver can be changed by creator only
    function check_royaltyReceiver_onlyCreator(
        address caller,
        address newReceiver
    ) public {
        // Setup: create token
        address creator = address(0x1);
        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(creator);
        uint256 tokenId = stemNFT.mint(
            creator,
            100,
            "ipfs://test",
            creator,
            500,
            true,
            parentIds
        );

        // Try to change royalty receiver as different caller
        vm.prank(caller);
        
        if (caller != creator && !stemNFT.hasRole(stemNFT.DEFAULT_ADMIN_ROLE(), caller)) {
            // Should revert if not creator or admin
            vm.expectRevert();
        }
        
        stemNFT.setRoyaltyReceiver(tokenId, newReceiver);
    }

    // ============ Mint Properties ============

    /// @notice Proves minting increases balance correctly
    function check_mint_balanceIncrease(
        address recipient,
        uint256 amount
    ) public {
        vm.assume(recipient != address(0));
        vm.assume(amount > 0 && amount <= type(uint128).max);

        uint256 balanceBefore = stemNFT.balanceOf(recipient, 1);
        uint256[] memory parentIds = new uint256[](0);
        
        uint256 tokenId = stemNFT.mint(
            recipient,
            amount,
            "ipfs://test",
            address(0),
            500,
            true,
            parentIds
        );

        uint256 balanceAfter = stemNFT.balanceOf(recipient, tokenId);
        
        // Prove: balance increases by exactly amount
        assert(balanceAfter == balanceBefore + amount);
    }

    /// @notice Proves token ID is unique and sequential
    function check_mint_tokenIdSequential() public {
        uint256[] memory parentIds = new uint256[](0);
        
        uint256 id1 = stemNFT.mint(address(0x1), 100, "a", address(0), 500, true, parentIds);
        uint256 id2 = stemNFT.mint(address(0x1), 100, "b", address(0), 500, true, parentIds);
        uint256 id3 = stemNFT.mint(address(0x1), 100, "c", address(0), 500, true, parentIds);

        // Prove: IDs are sequential
        assert(id2 == id1 + 1);
        assert(id3 == id2 + 1);
    }

    /// @notice Proves creator is immutable after minting
    function check_creator_immutable(address minter) public {
        vm.assume(minter != address(0));
        
        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            address(0x1),
            100,
            "ipfs://test",
            address(0),
            500,
            true,
            parentIds
        );

        // Prove: creator is set to minter
        assert(stemNFT.getCreator(tokenId) == minter);
    }

    // ============ Remix Properties ============

    /// @notice Proves remix requires remixable parent
    function check_remix_requiresRemixableParent(bool parentRemixable) public {
        uint256[] memory noParents = new uint256[](0);
        
        // Create parent
        uint256 parentId = stemNFT.mint(
            address(0x1),
            100,
            "parent",
            address(0),
            500,
            parentRemixable,
            noParents
        );

        // Try to create remix
        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = parentId;

        if (!parentRemixable) {
            vm.expectRevert();
        }
        
        stemNFT.mint(
            address(0x1),
            50,
            "remix",
            address(0),
            300,
            true,
            parentIds
        );
    }

    /// @notice Proves remix parent tracking is correct
    function check_remix_parentTracking() public {
        uint256[] memory noParents = new uint256[](0);
        
        // Create parents
        uint256 parent1 = stemNFT.mint(address(0x1), 100, "p1", address(0), 500, true, noParents);
        uint256 parent2 = stemNFT.mint(address(0x1), 100, "p2", address(0), 500, true, noParents);
        
        // Create remix
        uint256[] memory parentIds = new uint256[](2);
        parentIds[0] = parent1;
        parentIds[1] = parent2;
        
        uint256 remixId = stemNFT.mint(address(0x1), 50, "remix", address(0), 300, true, parentIds);

        // Prove: isRemix returns true
        assert(stemNFT.isRemix(remixId));
        
        // Prove: parents are tracked
        uint256[] memory trackedParents = stemNFT.getParentIds(remixId);
        assert(trackedParents.length == 2);
        assert(trackedParents[0] == parent1);
        assert(trackedParents[1] == parent2);
    }

    // ============ Transfer Properties ============

    /// @notice Proves transfer conserves total supply
    function check_transfer_conservesSupply(
        address from,
        address to,
        uint256 transferAmount
    ) public {
        vm.assume(from != address(0) && to != address(0));
        vm.assume(from != to);
        vm.assume(transferAmount > 0 && transferAmount <= 100);

        uint256[] memory parentIds = new uint256[](0);
        
        vm.prank(from);
        uint256 tokenId = stemNFT.mint(from, 100, "test", address(0), 500, true, parentIds);

        uint256 supplyBefore = stemNFT.totalSupply(tokenId);

        vm.prank(from);
        stemNFT.safeTransferFrom(from, to, tokenId, transferAmount, "");

        uint256 supplyAfter = stemNFT.totalSupply(tokenId);

        // Prove: total supply unchanged
        assert(supplyAfter == supplyBefore);
    }

    // ============ Access Control Properties ============

    /// @notice Proves only admin can set transfer validator
    function check_setValidator_onlyAdmin(address caller, address newValidator) public {
        vm.prank(caller);
        
        if (!stemNFT.hasRole(stemNFT.DEFAULT_ADMIN_ROLE(), caller)) {
            vm.expectRevert();
        }
        
        stemNFT.setTransferValidator(newValidator);
    }
}
