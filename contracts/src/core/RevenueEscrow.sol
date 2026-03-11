// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IContentProtection} from "../interfaces/IContentProtection.sol";

/**
 * @title RevenueEscrow
 * @notice Holds revenue from stem sales until the escrow period expires.
 *         Frozen earnings can be redirected to the rightful owner on confirmed theft.
 *
 * Design:
 *   - Each tokenId has an independent escrow slot
 *   - Deposits accumulate until release or redirect
 *   - Admin can freeze escrow during disputes
 *   - After escrow period, anyone can call release() to pay the beneficiary
 *   - ReentrancyGuard + CEI pattern on all payouts
 *
 * @custom:version 1.0.0
 */
contract RevenueEscrow is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct EscrowInfo {
        address beneficiary;
        uint256 balance;
        uint256 escrowEndTime;
        bool frozen;
    }

    // ============ State ============

    /// @notice Default escrow period (adjustable by owner)
    uint256 public defaultEscrowPeriod;

    /// @notice Token ID → Escrow info
    mapping(uint256 => EscrowInfo) public escrows;

    /// @notice Optional content protection module for dispute cascades
    IContentProtection public contentProtection;

    // ============ Events ============

    event RevenueDeposited(uint256 indexed tokenId, address indexed depositor, uint256 amount, uint256 newBalance);

    event EscrowFrozen(uint256 indexed tokenId);
    event EscrowUnfrozen(uint256 indexed tokenId);

    event EscrowReleased(uint256 indexed tokenId, address indexed beneficiary, uint256 amount);

    event EscrowRedirected(uint256 indexed tokenId, address indexed newRecipient, uint256 amount);

    event EscrowPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);

    // ============ Errors ============

    error NoEscrow();
    error EscrowIsFrozen();
    error EscrowNotFrozen();
    error EscrowNotExpired();
    error ZeroAmount();
    error ZeroAddress();
    error ContentProtectionNotSet();
    error TransferFailed();

    // ============ Constructor ============

    /**
     * @param _owner Contract owner (admin)
     * @param _defaultEscrowPeriod Default escrow duration in seconds
     */
    constructor(address _owner, uint256 _defaultEscrowPeriod) Ownable(_owner) {
        defaultEscrowPeriod = _defaultEscrowPeriod;
    }

    // ============ Deposit ============

    /**
     * @notice Deposit revenue for a token. Creates escrow if first deposit.
     * @param tokenId The token ID to deposit revenue for
     * @param beneficiary The address that will receive funds on release
     */
    function deposit(uint256 tokenId, address beneficiary) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (beneficiary == address(0)) revert ZeroAddress();

        EscrowInfo storage info = escrows[tokenId];

        if (info.beneficiary == address(0)) {
            // First deposit — create escrow
            info.beneficiary = beneficiary;
            info.escrowEndTime = block.timestamp + defaultEscrowPeriod;
        }

        info.balance += msg.value;

        emit RevenueDeposited(tokenId, msg.sender, msg.value, info.balance);
    }

    // ============ Freeze / Unfreeze ============

    /**
     * @notice Freeze escrow during a dispute. Only admin.
     * @param tokenId The token ID to freeze
     */
    function freeze(uint256 tokenId) external onlyOwner {
        EscrowInfo storage info = escrows[tokenId];
        if (info.beneficiary == address(0)) revert NoEscrow();
        info.frozen = true;
        emit EscrowFrozen(tokenId);
    }

    /**
     * @notice Unfreeze escrow after dispute resolution. Only admin.
     * @param tokenId The token ID to unfreeze
     */
    function unfreeze(uint256 tokenId) external onlyOwner {
        EscrowInfo storage info = escrows[tokenId];
        if (!info.frozen) revert EscrowNotFrozen();
        info.frozen = false;
        emit EscrowUnfrozen(tokenId);
    }

    // ============ Release ============

    /**
     * @notice Release escrowed funds to the beneficiary after the escrow period.
     *         Can be called by anyone (permissionless) once the period expires.
     * @param tokenId The token ID to release
     */
    function release(uint256 tokenId) external nonReentrant {
        EscrowInfo storage info = escrows[tokenId];

        // Checks
        if (info.beneficiary == address(0)) revert NoEscrow();
        if (info.frozen) revert EscrowIsFrozen();
        if (block.timestamp < info.escrowEndTime) revert EscrowNotExpired();
        if (info.balance == 0) revert ZeroAmount();

        // Effects
        uint256 amount = info.balance;
        address beneficiary = info.beneficiary;
        info.balance = 0;

        // Interactions
        (bool ok,) = payable(beneficiary).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowReleased(tokenId, beneficiary, amount);
    }

    // ============ Redirect (Dispute Resolution) ============

    /**
     * @notice Redirect frozen escrow funds to the rightful owner. Admin only.
     *         Used when a DMCA or dispute is upheld — sends earnings to the original creator.
     * @param tokenId The token ID whose escrow to redirect
     * @param recipient The rightful owner who should receive the funds
     */
    function redirect(uint256 tokenId, address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();

        EscrowInfo storage info = escrows[tokenId];
        if (info.beneficiary == address(0)) revert NoEscrow();
        if (!info.frozen) revert EscrowNotFrozen();
        if (info.balance == 0) revert ZeroAmount();

        // Effects
        uint256 amount = info.balance;
        info.balance = 0;
        info.frozen = false;
        info.beneficiary = recipient; // Update for future deposits

        // Interactions
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowRedirected(tokenId, recipient, amount);
    }

    // ============ Admin ============

    function setContentProtection(address cp) external onlyOwner {
        if (cp == address(0)) revert ZeroAddress();
        contentProtection = IContentProtection(cp);
    }

    function setDefaultEscrowPeriod(uint256 newPeriod) external onlyOwner {
        emit EscrowPeriodUpdated(defaultEscrowPeriod, newPeriod);
        defaultEscrowPeriod = newPeriod;
    }

    function freezeByTrack(uint256 trackId) external onlyOwner {
        if (address(contentProtection) == address(0)) {
            revert ContentProtectionNotSet();
        }

        _freezeEscrow(trackId);

        uint256[] memory stemIds = contentProtection.getTrackStems(trackId);
        for (uint256 i; i < stemIds.length; ++i) {
            _freezeEscrow(stemIds[i]);
        }
    }

    // ============ Views ============

    function getEscrow(uint256 tokenId)
        external
        view
        returns (address beneficiary, uint256 balance, uint256 escrowEndTime, bool frozen)
    {
        EscrowInfo storage info = escrows[tokenId];
        return (info.beneficiary, info.balance, info.escrowEndTime, info.frozen);
    }

    function isReleasable(uint256 tokenId) external view returns (bool) {
        EscrowInfo storage info = escrows[tokenId];
        return info.beneficiary != address(0) && !info.frozen && block.timestamp >= info.escrowEndTime
            && info.balance > 0;
    }

    function _freezeEscrow(uint256 tokenId) internal {
        EscrowInfo storage info = escrows[tokenId];
        if (info.beneficiary == address(0) || info.frozen) {
            return;
        }

        info.frozen = true;
        emit EscrowFrozen(tokenId);
    }
}
