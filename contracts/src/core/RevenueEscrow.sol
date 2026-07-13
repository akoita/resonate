// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IContentProtection} from "../interfaces/IContentProtection.sol";
import {IRevenueEscrow} from "../interfaces/IRevenueEscrow.sol";

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
contract RevenueEscrow is IRevenueEscrow, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice Max distinct assets tracked per tokenId, bounding the whole-token
    /// freeze/unfreeze loop so it cannot exceed the block gas limit.
    uint256 public constant MAX_ESCROW_ASSETS = 64;

    /// @notice Default escrow period (adjustable by owner)
    uint256 public defaultEscrowPeriod;

    /// @notice Token ID → native ETH escrow info
    mapping(uint256 => EscrowInfo) public escrows;

    /// @notice Token ID → ERC20 token → Escrow info
    mapping(uint256 => mapping(address => EscrowInfo)) private _assetEscrows;

    /// @notice Token ID → assets that have ever had escrow state
    mapping(uint256 => address[]) private _escrowAssets;

    /// @notice Token ID → asset → asset has been tracked
    mapping(uint256 => mapping(address => bool)) private _escrowAssetTracked;

    /// @notice Optional content protection module for dispute cascades
    IContentProtection public contentProtection;

    /// @notice Addresses allowed to route revenue into escrow. Deposits create the
    /// escrow and bind its beneficiary, so only trusted revenue routers (e.g. the
    /// backend settlement signer) may deposit — this prevents an attacker from
    /// front-running the first deposit to capture a token's beneficiary.
    mapping(address => bool) public authorizedDepositors;

    /// @notice token (address(0) = native) => recipient => amount escrowed after a
    /// failed payout. A reverting recipient cannot brick release/redirect: the funds
    /// are escrowed here and the recipient reclaims them via `claimFailedPayment`.
    mapping(address => mapping(address => uint256)) public failedPayments;

    // ============ Constructor ============

    /**
     * @param _owner Contract owner (admin)
     * @param _defaultEscrowPeriod Default escrow duration in seconds
     */
    constructor(address _owner, uint256 _defaultEscrowPeriod) Ownable(_owner) {
        defaultEscrowPeriod = _defaultEscrowPeriod;
    }

    /// @dev Only the owner or an allowlisted revenue router may deposit. Deposits
    /// create the escrow and bind its beneficiary, so leaving them open would let an
    /// attacker front-run the first deposit and capture a token's beneficiary.
    modifier onlyDepositor() {
        if (msg.sender != owner() && !authorizedDepositors[msg.sender]) {
            revert UnauthorizedDepositor(msg.sender);
        }
        _;
    }

    // ============ Deposit ============

    /**
     * @notice Deposit revenue for a token. Creates escrow if first deposit.
     * @param tokenId The token ID to deposit revenue for
     * @param beneficiary The address that will receive funds on release
     */
    function deposit(uint256 tokenId, address beneficiary) external payable nonReentrant onlyDepositor {
        if (msg.value == 0) revert ZeroAmount();
        _deposit(tokenId, beneficiary, address(0), msg.value);
    }

    function depositWithAsset(uint256 tokenId, address beneficiary, address token, uint256 amount)
        external
        nonReentrant
        onlyDepositor
    {
        if (token == address(0)) revert UnsupportedAsset();
        if (amount == 0) revert ZeroAmount();

        _deposit(tokenId, beneficiary, token, amount);

        // Reject fee-on-transfer / deflationary tokens: _deposit credited the full
        // `amount`, so the escrow must actually receive exactly `amount`.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert FeeOnTransferNotSupported(amount, received);
    }

    function _deposit(uint256 tokenId, address beneficiary, address token, uint256 amount) internal {
        if (beneficiary == address(0)) revert ZeroAddress();

        EscrowInfo storage info = _escrowInfo(tokenId, token);
        _trackEscrowAsset(tokenId, token);

        if (info.beneficiary == address(0)) {
            // First deposit — create escrow and bind the beneficiary.
            info.beneficiary = beneficiary;
            info.escrowEndTime = block.timestamp + defaultEscrowPeriod;
        } else if (info.beneficiary != beneficiary) {
            // The beneficiary is fixed once set (and after an admin redirect).
            // Reject a mismatched value rather than silently crediting a different
            // beneficiary than the caller passed.
            revert BeneficiaryMismatch(tokenId, info.beneficiary, beneficiary);
        }

        info.balance += amount;

        emit RevenueDeposited(tokenId, msg.sender, amount, info.balance);
        emit RevenueDepositedWithAsset(tokenId, msg.sender, token, amount, info.balance);
    }

    // ============ Freeze / Unfreeze ============

    /**
     * @notice Freeze escrow during a dispute. Only admin.
     * @param tokenId The token ID to freeze
     */
    function freeze(uint256 tokenId) external onlyOwner {
        _freezeAllEscrows(tokenId, true);
    }

    function freezeAsset(uint256 tokenId, address token) external onlyOwner {
        _freezeEscrow(tokenId, token, true);
    }

    /**
     * @notice Unfreeze escrow after dispute resolution. Only admin.
     * @param tokenId The token ID to unfreeze
     */
    function unfreeze(uint256 tokenId) external onlyOwner {
        _freezeAllEscrows(tokenId, false);
    }

    function unfreezeAsset(uint256 tokenId, address token) external onlyOwner {
        _freezeEscrow(tokenId, token, false);
    }

    // ============ Release ============

    /**
     * @notice Release escrowed funds to the beneficiary after the escrow period.
     *         Can be called by anyone (permissionless) once the period expires.
     * @param tokenId The token ID to release
     */
    function release(uint256 tokenId) external nonReentrant {
        _release(tokenId, address(0));
    }

    function releaseAsset(uint256 tokenId, address token) external nonReentrant {
        _release(tokenId, token);
    }

    // ============ Redirect (Dispute Resolution) ============

    /**
     * @notice Redirect frozen escrow funds to the rightful owner. Admin only.
     *         Used when a DMCA or dispute is upheld — sends earnings to the original creator.
     * @param tokenId The token ID whose escrow to redirect
     * @param recipient The rightful owner who should receive the funds
     */
    function redirect(uint256 tokenId, address recipient) external onlyOwner nonReentrant {
        _redirect(tokenId, address(0), recipient);
    }

    function redirectAsset(uint256 tokenId, address token, address recipient) external onlyOwner nonReentrant {
        _redirect(tokenId, token, recipient);
    }

    function _redirect(uint256 tokenId, address token, address recipient) internal {
        if (recipient == address(0)) revert ZeroAddress();

        EscrowInfo storage info = _escrowInfo(tokenId, token);
        if (info.beneficiary == address(0)) revert NoEscrow();
        if (!info.frozen) revert EscrowNotFrozen();
        if (info.balance == 0) revert ZeroAmount();

        // Effects
        uint256 amount = info.balance;
        info.balance = 0;
        info.frozen = false;
        info.beneficiary = recipient; // Update for future deposits

        // Interactions
        _pay(token, recipient, amount);

        emit EscrowRedirected(tokenId, recipient, amount);
        emit EscrowRedirectedWithAsset(tokenId, recipient, token, amount);
    }

    // ============ Admin ============

    function setContentProtection(address cp) external onlyOwner {
        if (cp == address(0)) revert ZeroAddress();
        contentProtection = IContentProtection(cp);
    }

    /// @notice Allow or revoke an address as a revenue-routing depositor. Only the
    /// owner and allowlisted depositors may create escrows / route revenue.
    function setDepositor(address depositor, bool allowed) external onlyOwner {
        if (depositor == address(0)) revert ZeroAddress();
        authorizedDepositors[depositor] = allowed;
        emit DepositorUpdated(depositor, allowed);
    }

    function setDefaultEscrowPeriod(uint256 newPeriod) external onlyOwner {
        emit EscrowPeriodUpdated(defaultEscrowPeriod, newPeriod);
        defaultEscrowPeriod = newPeriod;
    }

    function freezeByTrack(uint256 trackId) external onlyOwner {
        if (address(contentProtection) == address(0)) {
            revert ContentProtectionNotSet();
        }

        _freezeKnownEscrows(trackId);

        uint256[] memory stemIds = contentProtection.getTrackStems(trackId);
        for (uint256 i; i < stemIds.length; ++i) {
            _freezeKnownEscrows(stemIds[i]);
        }
    }

    /// @notice Paginated emergency freeze for a track with many stems (RE-1, #1271).
    /// `freezeByTrack` copies and iterates the entire stem array in one call, which can
    /// exceed the block gas limit for very large tracks. This variant freezes only the
    /// stem slice `[startIndex, startIndex + maxStems)` and returns how many stems it
    /// processed, so an operator can loop (advancing `startIndex` by the returned count)
    /// until it returns 0. The root track's own escrows are frozen only on the first
    /// page (`startIndex == 0`) so a multi-page sweep does not re-emit the root freeze.
    /// @param trackId The track whose escrows (and stem escrows) to freeze.
    /// @param startIndex Index into the track's stem array to start from.
    /// @param maxStems Maximum number of stems to process this call; must be non-zero.
    /// @return processed Number of stems processed this call. `0` means `startIndex` is
    /// at or beyond the stem count — the sweep is complete.
    function freezeByTrackRange(uint256 trackId, uint256 startIndex, uint256 maxStems)
        external
        onlyOwner
        returns (uint256 processed)
    {
        if (address(contentProtection) == address(0)) {
            revert ContentProtectionNotSet();
        }
        if (maxStems == 0) revert ZeroMaxStems();

        // Freeze the root track's own escrows only once, on the first page.
        if (startIndex == 0) {
            _freezeKnownEscrows(trackId);
        }

        uint256[] memory stemIds = contentProtection.getTrackStemsSlice(trackId, startIndex, maxStems);
        for (uint256 i; i < stemIds.length; ++i) {
            _freezeKnownEscrows(stemIds[i]);
        }

        return stemIds.length;
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

    function getEscrowAsset(uint256 tokenId, address token)
        external
        view
        returns (address beneficiary, uint256 balance, uint256 escrowEndTime, bool frozen)
    {
        EscrowInfo storage info = _escrowInfo(tokenId, token);
        return (info.beneficiary, info.balance, info.escrowEndTime, info.frozen);
    }

    function getEscrowAssets(uint256 tokenId) external view returns (address[] memory) {
        return _escrowAssets[tokenId];
    }

    function isReleasable(uint256 tokenId) external view returns (bool) {
        return _isReleasable(tokenId, address(0));
    }

    function isReleasableAsset(uint256 tokenId, address token) external view returns (bool) {
        return _isReleasable(tokenId, token);
    }

    function _release(uint256 tokenId, address token) internal {
        EscrowInfo storage info = _escrowInfo(tokenId, token);

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
        _pay(token, beneficiary, amount);

        emit EscrowReleased(tokenId, beneficiary, amount);
        emit EscrowReleasedWithAsset(tokenId, beneficiary, token, amount);
    }

    function _isReleasable(uint256 tokenId, address token) internal view returns (bool) {
        EscrowInfo storage info = _escrowInfo(tokenId, token);
        return
            info.beneficiary != address(0) && !info.frozen && block.timestamp >= info.escrowEndTime && info.balance > 0;
    }

    function _freezeKnownEscrows(uint256 tokenId) internal {
        address[] storage assets = _escrowAssets[tokenId];
        for (uint256 i; i < assets.length; ++i) {
            EscrowInfo storage info = _escrowInfo(tokenId, assets[i]);
            if (info.beneficiary == address(0) || info.frozen) {
                continue;
            }

            info.frozen = true;
            emit EscrowFrozen(tokenId);
            emit EscrowFrozenWithAsset(tokenId, assets[i]);
        }
    }

    function _freezeAllEscrows(uint256 tokenId, bool frozen) internal {
        address[] storage assets = _escrowAssets[tokenId];
        if (assets.length == 0) revert NoEscrow();

        bool changed;
        for (uint256 i; i < assets.length; ++i) {
            EscrowInfo storage info = _escrowInfo(tokenId, assets[i]);
            if (info.beneficiary == address(0)) {
                continue;
            }
            if (frozen && !info.frozen) {
                info.frozen = true;
                emit EscrowFrozen(tokenId);
                emit EscrowFrozenWithAsset(tokenId, assets[i]);
                changed = true;
            } else if (!frozen && info.frozen) {
                info.frozen = false;
                emit EscrowUnfrozen(tokenId);
                emit EscrowUnfrozenWithAsset(tokenId, assets[i]);
                changed = true;
            }
        }

        if (!changed && !frozen) {
            revert EscrowNotFrozen();
        }
    }

    function _freezeEscrow(uint256 tokenId, address token, bool frozen) internal {
        EscrowInfo storage info = _escrowInfo(tokenId, token);
        if (info.beneficiary == address(0)) revert NoEscrow();

        if (frozen) {
            if (info.frozen) return;
            info.frozen = true;
            emit EscrowFrozen(tokenId);
            emit EscrowFrozenWithAsset(tokenId, token);
            return;
        }

        if (!info.frozen) revert EscrowNotFrozen();
        info.frozen = false;
        emit EscrowUnfrozen(tokenId);
        emit EscrowUnfrozenWithAsset(tokenId, token);
    }

    function _escrowInfo(uint256 tokenId, address token) internal view returns (EscrowInfo storage) {
        if (token == address(0)) return escrows[tokenId];
        return _assetEscrows[tokenId][token];
    }

    function _trackEscrowAsset(uint256 tokenId, address token) internal {
        if (_escrowAssetTracked[tokenId][token]) return;
        if (_escrowAssets[tokenId].length >= MAX_ESCROW_ASSETS) revert TooManyEscrowAssets(tokenId);
        _escrowAssetTracked[tokenId][token] = true;
        _escrowAssets[tokenId].push(token);
    }

    /// @dev Push-then-escrow: attempt the payout, but if the recipient reverts (a
    /// contract that rejects ETH, or a token that blocklists the address) escrow the
    /// funds for the recipient to reclaim later instead of bricking the operation.
    function _pay(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) _escrowFailedPayment(token, to, amount);
        } else {
            try this.safeTransferSelf(token, to, amount) {
            // delivered
            }
            catch {
                _escrowFailedPayment(token, to, amount);
            }
        }
    }

    function _escrowFailedPayment(address token, address to, uint256 amount) private {
        failedPayments[token][to] += amount;
        emit PaymentEscrowed(token, to, amount);
    }

    /// @dev External self-call wrapper so a reverting SafeERC20 transfer can be caught
    /// with try/catch (try/catch requires an external call). Restricted to self.
    function safeTransferSelf(address token, address to, uint256 amount) external {
        if (msg.sender != address(this)) revert OnlySelf();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Reclaim funds escrowed for `msg.sender` after a failed payout.
    /// @param token The asset to claim (address(0) for native ETH).
    function claimFailedPayment(address token) external nonReentrant {
        uint256 amount = failedPayments[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        failedPayments[token][msg.sender] = 0;
        if (token == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit FailedPaymentClaimed(token, msg.sender, amount);
    }
}
