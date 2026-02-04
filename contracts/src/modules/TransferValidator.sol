// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITransferValidator} from "../interfaces/ITransferValidator.sol";

/**
 * @title TransferValidator
 * @author Resonate Protocol
 * @notice Optional module to enforce transfers through royalty-compliant channels
 * @dev 
 *   - Plug into any NFT contract that supports transfer hooks
 *   - Whitelist marketplaces that honor royalties
 *   - Simple: ~100 lines vs ~250
 * 
 * @custom:version 2.0.0
 */
contract TransferValidator is Ownable, ITransferValidator {
    // ============ State ============
    
    /// @notice Whitelisted callers (marketplaces, operators)
    mapping(address => bool) public whitelist;
    
    /// @notice Allow direct transfers (owner to owner without operator)
    bool public allowDirectTransfers;

    // ============ Events ============
    event WhitelistUpdated(address indexed account, bool allowed);
    event DirectTransfersUpdated(bool allowed);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        allowDirectTransfers = true; // Default: allow OTC transfers
    }

    // ============ ITransferValidator ============

    /**
     * @notice Validate if a transfer is allowed
     * @param caller The operator/msg.sender initiating transfer
     * @param from The sender
     */
    function validateTransfer(
        address caller,
        address from,
        address /* to - unused but required by interface */
    ) external view override returns (bool) {
        // Whitelisted caller (marketplace, approved operator)
        if (whitelist[caller]) return true;
        
        // Direct transfer (caller is the owner)
        if (allowDirectTransfers && caller == from) return true;
        
        return false;
    }

    function isWhitelistedOperator(address operator) external view override returns (bool) {
        return whitelist[operator];
    }

    function isWhitelistedMarketplace(address marketplace) external view override returns (bool) {
        return whitelist[marketplace];
    }

    // ============ Admin ============

    function setWhitelist(address account, bool allowed) external onlyOwner {
        whitelist[account] = allowed;
        emit WhitelistUpdated(account, allowed);
    }

    function setWhitelistBatch(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            whitelist[accounts[i]] = allowed;
            emit WhitelistUpdated(accounts[i], allowed);
        }
    }

    function setAllowDirectTransfers(bool allowed) external onlyOwner {
        allowDirectTransfers = allowed;
        emit DirectTransfersUpdated(allowed);
    }
}
