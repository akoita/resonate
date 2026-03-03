// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibClone} from "solady/utils/LibClone.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title KernelFactory
 * @author Resonate Protocol
 * @notice Factory for deploying ERC-4337 Kernel smart accounts
 * @dev Uses ERC-1967 proxy pattern with deterministic deployment
 * @custom:security V-005 (evmbench): createAccount() performs account.call(data) with
 *      attacker-controlled initialization data. ReentrancyGuard prevents the init call
 *      from reentering the factory or contracts calling through it.
 * @custom:version 1.1.0
 */
contract KernelFactory is ReentrancyGuard, Ownable {
    // ============ Errors ============

    error InitializeError();
    error ImplementationNotDeployed();
    error AccountAlreadyDeployed();
    error InvalidRecipient();

    // ============ Immutables ============

    /// @notice The Kernel implementation address
    address public immutable implementation;

    // ============ Events ============

    event AccountCreated(address indexed account, bytes32 indexed salt);

    // ============ Constructor ============

    constructor(address _impl) Ownable(msg.sender) {
        implementation = _impl;
        if (_impl.code.length == 0) revert ImplementationNotDeployed();
    }

    // ============ External Functions ============

    /**
     * @notice Create a new Kernel smart account
     * @param data Initialization calldata
     * @param salt Salt for deterministic deployment
     * @return account The deployed account address
     * @dev msg.value is intentionally forwarded to createDeterministicERC1967
     *      for implementations that require ETH during proxy deployment.
     *      The initialization call does not forward value separately.
     */
    function createAccount(
        bytes calldata data,
        bytes32 salt
    ) public payable nonReentrant returns (address account) {
        bytes32 actualSalt = keccak256(abi.encodePacked(data, salt));

        (bool alreadyDeployed, address deployed) = LibClone
            .createDeterministicERC1967(msg.value, implementation, actualSalt);

        account = deployed;

        if (alreadyDeployed) {
            // V-006: Reject ETH when account already exists to prevent trapping
            if (msg.value > 0) revert AccountAlreadyDeployed();
        } else {
            (bool success, ) = account.call(data);
            if (!success) {
                revert InitializeError();
            }
            emit AccountCreated(account, salt);
        }
    }

    /// @notice Rescue accidentally trapped ETH (owner only)
    /// @param recipient Address to send trapped ETH to
    function withdrawTrappedETH(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        (bool success, ) = recipient.call{value: address(this).balance}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice Get the deterministic address for an account
     * @param data Initialization calldata
     * @param salt Salt for deterministic deployment
     * @return The predicted account address
     */
    function getAddress(
        bytes calldata data,
        bytes32 salt
    ) public view returns (address) {
        bytes32 actualSalt = keccak256(abi.encodePacked(data, salt));
        return
            LibClone.predictDeterministicAddressERC1967(
                implementation,
                actualSalt,
                address(this)
            );
    }
}
