// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITransferValidator} from "../interfaces/ITransferValidator.sol";

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
contract StemNFT is ERC1155, ERC1155Supply, AccessControl, IERC2981 {
    // ============ Roles ============
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ============ Structs ============
    
    /// @notice On-chain stem data (minimal - metadata in tokenURI)
    struct StemData {
        address creator;        // Original creator (receives royalties)
        address royaltyReceiver;// Can differ from creator (e.g., split contract)
        uint96 royaltyBps;      // Royalty in basis points (max 10%)
        bool remixable;         // Can be used in remixes?
        bool exists;            // Token exists flag
    }

    /// @notice Remix relationship (optional, for on-chain lineage tracking)
    struct RemixInfo {
        uint256[] parentIds;    // Parent stem IDs (empty = original)
        uint40 createdAt;       // Timestamp
    }

    // ============ Constants ============
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%
    uint96 public constant DEFAULT_ROYALTY_BPS = 500; // 5%

    // ============ State ============
    uint256 private _tokenIdCounter;
    
    /// @notice Stem data by token ID
    mapping(uint256 => StemData) public stems;
    
    /// @notice Remix info by token ID (optional)
    mapping(uint256 => RemixInfo) public remixes;
    
    /// @notice Token URIs (IPFS CIDs or full URIs)
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Optional transfer validator module
    ITransferValidator public transferValidator;

    // ============ Events ============
    event StemMinted(
        uint256 indexed tokenId,
        address indexed creator,
        uint256[] parentIds,
        string tokenURI
    );
    
    event TransferValidatorSet(address indexed validator);
    event RoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 bps);

    // ============ Errors ============
    error StemNotFound(uint256 tokenId);
    error NotStemCreator(uint256 tokenId);
    error InvalidRoyalty(uint96 bps);
    error TransferNotAllowed();
    error ParentNotRemixable(uint256 parentId);

    // ============ Constructor ============
    constructor(string memory baseUri) ERC1155(baseUri) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
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
    ) external returns (uint256 tokenId) {
        // Validate royalty
        uint96 effectiveRoyalty = royaltyBps == 0 ? DEFAULT_ROYALTY_BPS : royaltyBps;
        if (effectiveRoyalty > MAX_ROYALTY_BPS) revert InvalidRoyalty(royaltyBps);

        // Validate parent stems (if remix)
        for (uint256 i; i < parentIds.length; ++i) {
            if (!stems[parentIds[i]].exists) revert StemNotFound(parentIds[i]);
            if (!stems[parentIds[i]].remixable) revert ParentNotRemixable(parentIds[i]);
        }

        tokenId = ++_tokenIdCounter;

        // Store minimal on-chain data
        stems[tokenId] = StemData({
            creator: msg.sender,
            royaltyReceiver: royaltyReceiver == address(0) ? msg.sender : royaltyReceiver,
            royaltyBps: effectiveRoyalty,
            remixable: remixable,
            exists: true
        });

        // Store remix info if this is a remix
        if (parentIds.length > 0) {
            remixes[tokenId] = RemixInfo({
                parentIds: parentIds,
                createdAt: uint40(block.timestamp)
            });
        }

        // Store token URI
        _tokenURIs[tokenId] = tokenURI_;

        // Mint
        _mint(to, tokenId, amount, "");

        emit StemMinted(tokenId, msg.sender, parentIds, tokenURI_);
    }

    /**
     * @notice Mint additional editions of existing stem
     */
    function mintMore(
        address to,
        uint256 tokenId,
        uint256 amount
    ) external {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);
        if (stems[tokenId].creator != msg.sender && !hasRole(MINTER_ROLE, msg.sender)) {
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
        if (stems[tokenId].creator != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotStemCreator(tokenId);
        }
        stems[tokenId].royaltyReceiver = receiver;
        emit RoyaltyUpdated(tokenId, receiver, stems[tokenId].royaltyBps);
    }

    /**
     * @notice Update royalty percentage
     */
    function setRoyaltyBps(uint256 tokenId, uint96 bps) external {
        if (!stems[tokenId].exists) revert StemNotFound(tokenId);
        if (stems[tokenId].creator != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
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
    function setTransferValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferValidator = ITransferValidator(validator);
        emit TransferValidatorSet(validator);
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

    function getParentIds(uint256 tokenId) external view returns (uint256[] memory) {
        return remixes[tokenId].parentIds;
    }

    function getCreator(uint256 tokenId) external view returns (address) {
        return stems[tokenId].creator;
    }

    // ============ EIP-2981 ============

    function royaltyInfo(uint256 tokenId, uint256 salePrice) 
        external view override returns (address, uint256) 
    {
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
        if (address(transferValidator) != address(0) && from != address(0) && to != address(0)) {
            if (!transferValidator.validateTransfer(msg.sender, from, to)) {
                revert TransferNotAllowed();
            }
        }
        super._update(from, to, ids, values);
    }

    // ============ Interface Support ============

    function supportsInterface(bytes4 interfaceId) 
        public view override(ERC1155, AccessControl, IERC165) returns (bool) 
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}
