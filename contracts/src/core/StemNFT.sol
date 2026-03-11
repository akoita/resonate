// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {
    ERC1155Supply
} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITransferValidator} from "../interfaces/ITransferValidator.sol";
import {IContentProtection} from "../interfaces/IContentProtection.sol";

/**
 * @title StemNFT
 * @author Resonate Protocol
 * @notice Minimal ERC-1155 for audio stems with EIP-2981 royalties
 * @dev
 *   - Metadata stored off-chain (tokenURI → IPFS)
 *   - Only essential data on-chain (creator, royalty, license flags)
 *   - Optional TransferValidator module for royalty enforcement
 *   - Remixes are stems with parentIds (no separate contract needed)
 *
 * @custom:version 2.0.0
 */
contract StemNFT is ERC1155, ERC1155Supply, AccessControl, EIP712, IERC2981 {
    // ============ Roles ============
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant MINT_AUTHORIZER_ROLE =
        keccak256("MINT_AUTHORIZER_ROLE");

    // ============ Structs ============

    struct MintAuthorization {
        address minter;
        address to;
        uint256 amount;
        bytes32 tokenURIHash;
        uint256 protectionId;
        address royaltyReceiver;
        uint96 royaltyBps;
        bool remixable;
        bytes32 parentIdsHash;
        uint256 deadline;
        bytes32 nonce;
    }

    /// @notice On-chain stem data (minimal - metadata in tokenURI)
    struct StemData {
        address creator; // Original creator (receives royalties)
        address royaltyReceiver; // Can differ from creator (e.g., split contract)
        uint96 royaltyBps; // Royalty in basis points (max 10%)
        bool remixable; // Can be used in remixes?
        bool exists; // Token exists flag
    }

    /// @notice Remix relationship (optional, for on-chain lineage tracking)
    struct RemixInfo {
        uint256[] parentIds; // Parent stem IDs (empty = original)
        uint40 createdAt; // Timestamp
    }

    // ============ Constants ============
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%
    uint96 public constant DEFAULT_ROYALTY_BPS = 500; // 5%
    bytes32 private constant _MINT_AUTHORIZATION_TYPEHASH =
        keccak256(
            "MintAuthorization(address minter,address to,uint256 amount,bytes32 tokenURIHash,uint256 protectionId,address royaltyReceiver,uint96 royaltyBps,bool remixable,bytes32 parentIdsHash,uint256 deadline,bytes32 nonce)"
        );

    // ============ State ============
    uint256 private _tokenIdCounter;

    /// @notice Stem data by token ID
    mapping(uint256 => StemData) public stems;

    /// @notice Remix info by token ID (optional)
    mapping(uint256 => RemixInfo) public remixes;

    /// @notice Token URIs (IPFS CIDs or full URIs)
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Latest token minted to an owner in the current/most recent tx flow
    mapping(address => uint256) public lastMintedTokenIdByOwner;
    mapping(address => uint64) public lastMintedBlockByOwner;
    mapping(address => mapping(bytes32 => bool)) public usedMintAuthorizationNonces;

    /// @notice Optional transfer validator module
    ITransferValidator public transferValidator;

    /// @notice Optional content protection module for blacklist / future policy checks
    IContentProtection public contentProtection;

    // ============ Events ============
    event StemMinted(
        uint256 indexed tokenId,
        address indexed creator,
        uint256[] parentIds,
        string tokenURI
    );

    event TransferValidatorSet(address indexed validator);
    event ContentProtectionSet(address indexed protection);
    event RoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 bps);

    // ============ Errors ============
    error StemNotFound(uint256 tokenId);
    error NotStemCreator(uint256 tokenId);
    error InvalidRoyalty(uint96 bps);
    error TransferNotAllowed();
    error ParentNotRemixable(uint256 parentId);
    error NotAttested(uint256 tokenId);
    error MintAuthorizationExpired(uint256 deadline);
    error MintAuthorizationAlreadyUsed(address minter, bytes32 nonce);
    error InvalidMintAuthorization();
    // ============ Constructor ============
    constructor(string memory baseUri)
        ERC1155(baseUri)
        EIP712("Resonate StemNFT", "1")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(MINT_AUTHORIZER_ROLE, msg.sender);
    }

    // ============ Minting ============

    /**
     * @notice Mint a new stem (original or remix)
     * @param to Recipient address
     * @param amount Number of editions
     * @param tokenURI_ Metadata URI (IPFS CID or full URL)
     * @param royaltyReceiver Royalty recipient (address(0) = creator)
     * @param royaltyBps Royalty percentage (0 = default 5%)
     * @param remixable Can this stem be remixed?
     * @param parentIds Parent stem IDs (empty = original, non-empty = remix)
     */
    function mint(
        address to,
        uint256 amount,
        string calldata tokenURI_,
        address royaltyReceiver,
        uint96 royaltyBps,
        bool remixable,
        uint256[] calldata parentIds
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        return
            _mintStem(
                msg.sender,
                to,
                amount,
                tokenURI_,
                0,
                royaltyReceiver,
                royaltyBps,
                remixable,
                parentIds,
                false
            );
    }

    function mintAuthorized(
        address to,
        uint256 amount,
        string calldata tokenURI_,
        uint256 protectionId,
        address royaltyReceiver,
        uint96 royaltyBps,
        bool remixable,
        uint256[] calldata parentIds,
        uint256 deadline,
        bytes32 nonce,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        if (deadline < block.timestamp) {
            revert MintAuthorizationExpired(deadline);
        }
        if (usedMintAuthorizationNonces[msg.sender][nonce]) {
            revert MintAuthorizationAlreadyUsed(msg.sender, nonce);
        }

        MintAuthorization memory authorization = MintAuthorization({
            minter: msg.sender,
            to: to,
            amount: amount,
            tokenURIHash: keccak256(bytes(tokenURI_)),
            protectionId: protectionId,
            royaltyReceiver: royaltyReceiver,
            royaltyBps: royaltyBps,
            remixable: remixable,
            parentIdsHash: keccak256(abi.encode(parentIds)),
            deadline: deadline,
            nonce: nonce
        });

        bytes32 digest = _hashMintAuthorization(authorization);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (!hasRole(MINT_AUTHORIZER_ROLE, recoveredSigner)) {
            revert InvalidMintAuthorization();
        }

        usedMintAuthorizationNonces[msg.sender][nonce] = true;

        return
            _mintStem(
                msg.sender,
                to,
                amount,
                tokenURI_,
                protectionId,
                royaltyReceiver,
                royaltyBps,
                remixable,
                parentIds,
                true
            );
    }

    /**
     * @notice Mint additional editions of existing stem
     */
    function mintMore(address to, uint256 tokenId, uint256 amount) external {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);
        if (
            stems[tokenId].creator != msg.sender &&
            !hasRole(MINTER_ROLE, msg.sender)
        ) {
            revert NotStemCreator(tokenId);
        }
        _mint(to, tokenId, amount, "");
    }

    // ============ Royalty Management ============

    /**
     * @notice Update royalty receiver (e.g., to a 0xSplits contract)
     */
    function setRoyaltyReceiver(uint256 tokenId, address receiver) external {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);
        if (
            stems[tokenId].creator != msg.sender &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert NotStemCreator(tokenId);
        }
        if (receiver == address(0)) revert InvalidRoyalty(0);
        stems[tokenId].royaltyReceiver = receiver;
        emit RoyaltyUpdated(tokenId, receiver, stems[tokenId].royaltyBps);
    }

    /**
     * @notice Update royalty percentage
     */
    function setRoyaltyBps(uint256 tokenId, uint96 bps) external {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);
        if (
            stems[tokenId].creator != msg.sender &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert NotStemCreator(tokenId);
        }
        if (bps > MAX_ROYALTY_BPS) revert InvalidRoyalty(bps);
        stems[tokenId].royaltyBps = bps;
        emit RoyaltyUpdated(tokenId, stems[tokenId].royaltyReceiver, bps);
    }

    // ============ Module Management ============

    /**
     * @notice Set transfer validator module (for royalty enforcement)
     * @param validator Address of validator (address(0) to disable)
     */
    function setTransferValidator(
        address validator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferValidator = ITransferValidator(validator);
        emit TransferValidatorSet(validator);
    }

    /**
     * @notice Set content protection module for blacklist / future policy checks
     * @param protection Address of ContentProtection contract (address(0) to disable)
     */
    function setContentProtection(
        address protection
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        contentProtection = IContentProtection(protection);
        emit ContentProtectionSet(protection);
    }

    // ============ View Functions ============

    function uri(uint256 tokenId) public view override returns (string memory) {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);

        string memory tokenURI_ = _tokenURIs[tokenId];
        string memory base = super.uri(tokenId);

        // If tokenURI is set, use it; otherwise use base + tokenId
        if (bytes(tokenURI_).length > 0) {
            return tokenURI_;
        }
        return base;
    }

    function totalStems() external view returns (uint256) {
        return _tokenIdCounter;
    }

    function isRemix(uint256 tokenId) external view returns (bool) {
        return remixes[tokenId].parentIds.length > 0;
    }

    function getParentIds(
        uint256 tokenId
    ) external view returns (uint256[] memory) {
        return remixes[tokenId].parentIds;
    }

    function getCreator(uint256 tokenId) external view returns (address) {
        return stems[tokenId].creator;
    }

    function hashMintAuthorization(
        address minter,
        address to,
        uint256 amount,
        string calldata tokenURI_,
        uint256 protectionId,
        address royaltyReceiver,
        uint96 royaltyBps,
        bool remixable,
        uint256[] calldata parentIds,
        uint256 deadline,
        bytes32 nonce
    ) external view returns (bytes32) {
        return
            _hashMintAuthorization(
                MintAuthorization({
                    minter: minter,
                    to: to,
                    amount: amount,
                    tokenURIHash: keccak256(bytes(tokenURI_)),
                    protectionId: protectionId,
                    royaltyReceiver: royaltyReceiver,
                    royaltyBps: royaltyBps,
                    remixable: remixable,
                    parentIdsHash: keccak256(abi.encode(parentIds)),
                    deadline: deadline,
                    nonce: nonce
                })
            );
    }

    // ============ EIP-2981 ============

    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) external view override returns (address, uint256) {
        StemData storage stem = stems[tokenId];
        if (!stem.exists) return (address(0), 0);

        uint256 royaltyAmount = (salePrice * stem.royaltyBps) / 10000;
        return (stem.royaltyReceiver, royaltyAmount);
    }

    // ============ Transfer Hook (Validator Integration) ============

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        // Check transfer validator if set (skip for mints/burns)
        if (
            address(transferValidator) != address(0) &&
            from != address(0) &&
            to != address(0)
        ) {
            if (!transferValidator.validateTransfer(msg.sender, from, to)) {
                revert TransferNotAllowed();
            }
        }
        super._update(from, to, ids, values);
    }

    // ============ Interface Support ============

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl, IERC165) returns (bool) {
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _mintStem(
        address creator,
        address to,
        uint256 amount,
        string memory tokenURI_,
        uint256 protectionId,
        address royaltyReceiver,
        uint96 royaltyBps,
        bool remixable,
        uint256[] memory parentIds,
        bool enforceProtection
    ) internal returns (uint256 tokenId) {
        uint96 effectiveRoyalty = royaltyBps == 0
            ? DEFAULT_ROYALTY_BPS
            : royaltyBps;
        if (effectiveRoyalty > MAX_ROYALTY_BPS)
            revert InvalidRoyalty(royaltyBps);

        if (
            enforceProtection &&
            address(contentProtection) != address(0) &&
            !contentProtection.isReleaseVerified(protectionId)
        ) {
            revert NotAttested(protectionId);
        }

        for (uint256 i; i < parentIds.length; ++i) {
            if (!stems[parentIds[i]].exists) revert StemNotFound(parentIds[i]);
            if (!stems[parentIds[i]].remixable)
                revert ParentNotRemixable(parentIds[i]);
        }

        tokenId = ++_tokenIdCounter;

        stems[tokenId] = StemData({
            creator: creator,
            royaltyReceiver: royaltyReceiver == address(0)
                ? creator
                : royaltyReceiver,
            royaltyBps: effectiveRoyalty,
            remixable: remixable,
            exists: true
        });

        if (parentIds.length > 0) {
            remixes[tokenId] = RemixInfo({
                parentIds: parentIds,
                createdAt: uint40(block.timestamp)
            });
        }

        _tokenURIs[tokenId] = tokenURI_;

        _mint(to, tokenId, amount, "");
        lastMintedTokenIdByOwner[to] = tokenId;
        lastMintedBlockByOwner[to] = uint64(block.number);

        emit StemMinted(tokenId, creator, parentIds, tokenURI_);
    }

    function _hashMintAuthorization(
        MintAuthorization memory authorization
    ) internal view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        _MINT_AUTHORIZATION_TYPEHASH,
                        authorization.minter,
                        authorization.to,
                        authorization.amount,
                        authorization.tokenURIHash,
                        authorization.protectionId,
                        authorization.royaltyReceiver,
                        authorization.royaltyBps,
                        authorization.remixable,
                        authorization.parentIdsHash,
                        authorization.deadline,
                        authorization.nonce
                    )
                )
            );
    }
}
