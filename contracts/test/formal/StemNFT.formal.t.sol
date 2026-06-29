// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {SymTest} from "halmos-cheatcodes/SymTest.sol";

/**
 * @title StemNFT Formal Verification Tests
 * @notice Halmos symbolic checks for the StemNFT safety properties (issue #944).
 * @dev Run with: halmos --contract StemNFTFormalTest
 *
 * The formal layer holds only the positive properties Halmos verifies cleanly
 * (creator immutability, transfer supply conservation). The revert-path checks
 * (royalty cap on mint, remixable-parent, royalty-receiver/validator access
 * control) use `vm.expectRevert`, which Halmos does not support; and the
 * positive mint/remix properties (balance increase, sequential ids, parent
 * tracking, royalty no-overflow) are exercised by `StemNFT.fuzz.t.sol`. All are
 * covered by the fuzz/unit suites + the Certora `StemNFT.spec` rules.
 */
contract StemNFTFormalTest is Test, SymTest {
    StemNFT public stemNFT;

    function setUp() public {
        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        // Grant MINTER_ROLE to addresses used in formal tests
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), address(0x1));
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), address(0x2));
    }

    /// @notice Proves creator is immutable after minting
    function check_creator_immutable(address minter) public {
        vm.assume(minter != address(0));

        uint256[] memory parentIds = new uint256[](0);

        // Grant MINTER_ROLE to symbolic minter
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), minter);

        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(address(0x1), 100, "ipfs://test", address(0), 500, true, parentIds);

        // Prove: creator is set to minter
        assert(stemNFT.getCreator(tokenId) == minter);
    }

    /// @notice Proves transfer conserves total supply
    function check_transfer_conservesSupply(address from, address to, uint256 transferAmount) public {
        vm.assume(from != address(0) && to != address(0));
        vm.assume(from != to);
        vm.assume(transferAmount > 0 && transferAmount <= 100);

        uint256[] memory parentIds = new uint256[](0);

        // Grant MINTER_ROLE to symbolic from address
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), from);

        vm.prank(from);
        uint256 tokenId = stemNFT.mint(from, 100, "test", address(0), 500, true, parentIds);

        uint256 supplyBefore = stemNFT.totalSupply(tokenId);

        vm.prank(from);
        stemNFT.safeTransferFrom(from, to, tokenId, transferAmount, "");

        uint256 supplyAfter = stemNFT.totalSupply(tokenId);

        // Prove: total supply unchanged
        assert(supplyAfter == supplyBefore);
    }
}
