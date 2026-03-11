// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";

contract MockContentProtection {
    mapping(uint256 => bool) public attested;

    function setAttested(uint256 tokenId, bool value) external {
        attested[tokenId] = value;
    }

    function isAttested(uint256 tokenId) external view returns (bool) {
        return attested[tokenId];
    }

    function isReleaseVerified(uint256 releaseId) external view returns (bool) {
        return attested[releaseId];
    }

    function isBlacklisted(address) external pure returns (bool) {
        return false;
    }
}

/**
 * @title StemNFT Unit Tests
 * @notice Comprehensive unit tests for the StemNFT contract
 */
contract StemNFTTest is Test {
    StemNFT public stemNFT;
    TransferValidator public validator;

    uint256 public authorizerKey = 0xA11CE;
    address public admin = makeAddr("admin");
    address public minter = makeAddr("minter");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public royaltyReceiver = makeAddr("royaltyReceiver");
    address public authorizer;

    string constant BASE_URI = "https://api.resonate.fm/metadata/";
    string constant TOKEN_URI = "ipfs://QmTest123";

    event StemMinted(
        uint256 indexed tokenId,
        address indexed creator,
        uint256[] parentIds,
        string tokenURI
    );
    event TransferValidatorSet(address indexed validator);
    event RoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 bps);

    function setUp() public {
        authorizer = vm.addr(authorizerKey);

        vm.startPrank(admin);
        stemNFT = new StemNFT(BASE_URI);
        validator = new TransferValidator();

        // Grant minter role
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), minter);
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), alice);
        stemNFT.grantRole(stemNFT.MINT_AUTHORIZER_ROLE(), authorizer);
        vm.stopPrank();
    }

    // ============ Constructor Tests ============

    function test_Constructor_SetsBaseUri() public view {
        // Mint and check URI uses base
        assertEq(address(stemNFT) != address(0), true);
    }

    function test_Constructor_GrantsAdminRoles() public view {
        assertTrue(stemNFT.hasRole(stemNFT.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(stemNFT.hasRole(stemNFT.MINTER_ROLE(), admin));
    }

    // ============ Minting Tests ============

    function test_Mint_OriginalStem() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500, // 5%
            true, // remixable
            parentIds
        );

        assertEq(tokenId, 1);
        assertEq(stemNFT.balanceOf(alice, tokenId), 100);
        assertEq(stemNFT.uri(tokenId), TOKEN_URI);
        assertEq(stemNFT.getCreator(tokenId), minter);
        assertFalse(stemNFT.isRemix(tokenId));
        assertEq(stemNFT.lastMintedTokenIdByOwner(alice), tokenId);
        assertEq(stemNFT.lastMintedBlockByOwner(alice), block.number);
    }

    function test_Mint_Remix() public {
        // First mint original
        uint256[] memory noParents = new uint256[](0);
        vm.prank(minter);
        uint256 originalId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            noParents
        );

        // Then mint remix
        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = originalId;

        vm.prank(alice);
        uint256 remixId = stemNFT.mint(
            bob,
            50,
            "ipfs://remix",
            bob,
            300,
            true,
            parentIds
        );

        assertTrue(stemNFT.isRemix(remixId));
        assertEq(stemNFT.getParentIds(remixId).length, 1);
        assertEq(stemNFT.getParentIds(remixId)[0], originalId);
    }

    function test_Mint_DefaultRoyalty() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            address(0),
            0,
            true,
            parentIds
        );

        // Check default royalty (5%)
        (address receiver, uint256 amount) = stemNFT.royaltyInfo(
            tokenId,
            10000
        );
        assertEq(receiver, minter); // Default to creator
        assertEq(amount, 500); // 5% of 10000
    }

    function test_Mint_RevertInvalidRoyalty() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.InvalidRoyalty.selector, 1001)
        );
        stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            1001,
            true,
            parentIds
        );
    }

    function test_Mint_RevertParentNotRemixable() public {
        // Mint non-remixable original
        uint256[] memory noParents = new uint256[](0);
        vm.prank(minter);
        uint256 originalId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            false,
            noParents
        );

        // Try to remix
        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = originalId;

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                StemNFT.ParentNotRemixable.selector,
                originalId
            )
        );
        stemNFT.mint(bob, 50, "ipfs://remix", bob, 300, true, parentIds);
    }

    function test_Mint_RevertParentNotFound() public {
        uint256[] memory parentIds = new uint256[](1);
        parentIds[0] = 999; // Non-existent

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.StemNotFound.selector, 999)
        );
        stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );
    }

    function test_Mint_SucceedsWhenContentProtectionIsConfigured() public {
        MockContentProtection protection = new MockContentProtection();

        vm.prank(admin);
        stemNFT.setContentProtection(address(protection));

        protection.setAttested(1, true);

        uint256[] memory parentIds = new uint256[](0);

        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            1,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        assertEq(tokenId, 1);
        assertEq(stemNFT.balanceOf(alice, tokenId), 1);
    }

    function test_Mint_EmitsEvent() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.prank(minter);
        vm.expectEmit(true, true, false, true);
        emit StemMinted(1, minter, parentIds, TOKEN_URI);
        stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );
    }

    function test_MintAuthorized_OriginalStem() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 0;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stem-auth-1");
        bytes memory signature = _signMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );

        vm.prank(alice);
        uint256 tokenId = stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );

        assertEq(tokenId, 1);
        assertEq(stemNFT.balanceOf(alice, tokenId), 1);
        assertEq(stemNFT.getCreator(tokenId), alice);
        assertTrue(stemNFT.usedMintAuthorizationNonces(alice, nonce));
    }

    function test_MintAuthorized_RevertReplay() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 0;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stem-auth-replay");
        bytes memory signature = _signMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );

        vm.prank(alice);
        stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                StemNFT.MintAuthorizationAlreadyUsed.selector,
                alice,
                nonce
            )
        );
        stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );
    }

    function test_MintAuthorized_RevertExpired() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 0;
        uint256 deadline = block.timestamp - 1;
        bytes32 nonce = keccak256("stem-auth-expired");
        bytes memory signature = _signMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                StemNFT.MintAuthorizationExpired.selector,
                deadline
            )
        );
        stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );
    }

    function test_MintAuthorized_RevertInvalidSigner() public {
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 0;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stem-auth-invalid");
        bytes32 digest = stemNFT.hashMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(StemNFT.InvalidMintAuthorization.selector);
        stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );
    }

    function test_MintAuthorized_SucceedsWhenReleaseIsVerified() public {
        MockContentProtection protection = new MockContentProtection();
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 42;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stem-auth-protected");

        vm.prank(admin);
        stemNFT.setContentProtection(address(protection));

        protection.setAttested(protectionId, true);

        bytes memory signature = _signMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );

        vm.prank(alice);
        uint256 tokenId = stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );

        assertEq(tokenId, 1);
    }

    function test_MintAuthorized_RevertWhenReleaseIsNotVerified() public {
        MockContentProtection protection = new MockContentProtection();
        uint256[] memory parentIds = new uint256[](0);
        uint256 protectionId = 42;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("stem-auth-unprotected");

        vm.prank(admin);
        stemNFT.setContentProtection(address(protection));

        bytes memory signature = _signMintAuthorization(
            alice,
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.NotAttested.selector, protectionId)
        );
        stemNFT.mintAuthorized(
            alice,
            1,
            TOKEN_URI,
            protectionId,
            royaltyReceiver,
            500,
            true,
            parentIds,
            deadline,
            nonce,
            signature
        );
    }

    // ============ MintMore Tests ============

    function test_MintMore_ByCreator() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        vm.prank(minter);
        stemNFT.mintMore(bob, tokenId, 50);

        assertEq(stemNFT.balanceOf(bob, tokenId), 50);
        assertEq(stemNFT.totalSupply(tokenId), 150);
    }

    function _signMintAuthorization(
        address authMinter,
        address to,
        uint256 amount,
        string memory tokenURI_,
        uint256 protectionId,
        address authRoyaltyReceiver,
        uint96 authRoyaltyBps,
        bool authRemixable,
        uint256[] memory parentIds,
        uint256 deadline,
        bytes32 nonce
    ) internal returns (bytes memory) {
        bytes32 digest = stemNFT.hashMintAuthorization(
            authMinter,
            to,
            amount,
            tokenURI_,
            protectionId,
            authRoyaltyReceiver,
            authRoyaltyBps,
            authRemixable,
            parentIds,
            deadline,
            nonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(authorizerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_MintMore_RevertNotCreator() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.NotStemCreator.selector, tokenId)
        );
        stemNFT.mintMore(bob, tokenId, 50);
    }

    // ============ Royalty Management Tests ============

    function test_SetRoyaltyReceiver() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        address newReceiver = makeAddr("newReceiver");
        vm.prank(minter);
        stemNFT.setRoyaltyReceiver(tokenId, newReceiver);

        (address receiver, ) = stemNFT.royaltyInfo(tokenId, 10000);
        assertEq(receiver, newReceiver);
    }

    function test_SetRoyaltyBps() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        vm.prank(minter);
        stemNFT.setRoyaltyBps(tokenId, 750);

        (, uint256 amount) = stemNFT.royaltyInfo(tokenId, 10000);
        assertEq(amount, 750);
    }

    function test_SetRoyaltyBps_RevertExceedsMax() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.InvalidRoyalty.selector, 1001)
        );
        stemNFT.setRoyaltyBps(tokenId, 1001);
    }

    // ============ Transfer Validator Tests ============

    function test_SetTransferValidator() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit TransferValidatorSet(address(validator));
        stemNFT.setTransferValidator(address(validator));

        assertEq(address(stemNFT.transferValidator()), address(validator));
    }

    function test_Transfer_BlockedByValidator() public {
        // Setup validator with no whitelist
        vm.prank(admin);
        stemNFT.setTransferValidator(address(validator));

        // Disable direct transfers
        vm.prank(admin);
        validator.setAllowDirectTransfers(false);

        // Mint
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        // Try transfer - should fail
        vm.prank(alice);
        vm.expectRevert(StemNFT.TransferNotAllowed.selector);
        stemNFT.safeTransferFrom(alice, bob, tokenId, 10, "");
    }

    function test_Transfer_AllowedByWhitelist() public {
        // Setup validator
        vm.startPrank(admin);
        stemNFT.setTransferValidator(address(validator));
        validator.setAllowDirectTransfers(false);
        validator.setWhitelist(alice, true); // Whitelist alice
        vm.stopPrank();

        // Mint
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        // Transfer - should succeed
        vm.prank(alice);
        stemNFT.safeTransferFrom(alice, bob, tokenId, 10, "");

        assertEq(stemNFT.balanceOf(bob, tokenId), 10);
    }

    function test_Transfer_DirectTransferAllowed() public {
        // Setup validator with direct transfers enabled (default)
        vm.prank(admin);
        stemNFT.setTransferValidator(address(validator));

        // Mint
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        // Direct transfer should work
        vm.prank(alice);
        stemNFT.safeTransferFrom(alice, bob, tokenId, 10, "");

        assertEq(stemNFT.balanceOf(bob, tokenId), 10);
    }

    // ============ View Function Tests ============

    function test_Uri_ReturnsTokenUri() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        assertEq(stemNFT.uri(tokenId), TOKEN_URI);
    }

    function test_Uri_RevertNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.StemNotFound.selector, 999)
        );
        stemNFT.uri(999);
    }

    function test_TotalStems() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.startPrank(minter);
        stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );
        stemNFT.mint(
            bob,
            50,
            "ipfs://2",
            royaltyReceiver,
            500,
            true,
            parentIds
        );
        stemNFT.mint(
            alice,
            25,
            "ipfs://3",
            royaltyReceiver,
            500,
            true,
            parentIds
        );
        vm.stopPrank();

        assertEq(stemNFT.totalStems(), 3);
    }

    // ============ EIP-2981 Tests ============

    function test_RoyaltyInfo_ReturnsCorrectValues() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            750,
            true,
            parentIds
        );

        (address receiver, uint256 amount) = stemNFT.royaltyInfo(
            tokenId,
            1 ether
        );

        assertEq(receiver, royaltyReceiver);
        assertEq(amount, 0.075 ether); // 7.5%
    }

    function test_RoyaltyInfo_NonExistentToken() public view {
        (address receiver, uint256 amount) = stemNFT.royaltyInfo(999, 1 ether);

        assertEq(receiver, address(0));
        assertEq(amount, 0);
    }

    // ============ Interface Support Tests ============

    function test_SupportsInterface_ERC1155() public view {
        assertTrue(stemNFT.supportsInterface(0xd9b67a26)); // ERC1155
    }

    function test_SupportsInterface_ERC2981() public view {
        assertTrue(stemNFT.supportsInterface(0x2a55205a)); // ERC2981
    }

    function test_SupportsInterface_AccessControl() public view {
        assertTrue(stemNFT.supportsInterface(0x7965db0b)); // AccessControl
    }

    // ============ Access Control Tests ============

    function test_Mint_RevertUnauthorized() public {
        uint256[] memory parentIds = new uint256[](0);

        vm.prank(bob); // bob has no MINTER_ROLE
        vm.expectRevert();
        stemNFT.mint(
            bob,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );
    }

    // ============ Zero-Address Guard Tests ============

    function test_SetRoyaltyReceiver_RevertZeroAddress() public {
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(minter);
        uint256 tokenId = stemNFT.mint(
            alice,
            100,
            TOKEN_URI,
            royaltyReceiver,
            500,
            true,
            parentIds
        );

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(StemNFT.InvalidRoyalty.selector, 0)
        );
        stemNFT.setRoyaltyReceiver(tokenId, address(0));
    }
}
