// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibClone} from "solady/utils/LibClone.sol";

/**
 * @title KernelFactory
 * @author Resonate Protocol
 * @notice Factory for deploying ERC-4337 Kernel smart accounts
 * @dev Uses ERC-1967 proxy pattern with deterministic deployment
 * @custom:version 1.0.0
 */
contract KernelFactory {
    // ============ Errors ============
    
    error InitializeError();
    error ImplementationNotDeployed();

    // ============ Immutables ============

    /// @notice The Kernel implementation address
    address public immutable implementation;

    // ============ Events ============

    event AccountCreated(address indexed account, bytes32 indexed salt);

    // ============ Constructor ============

    constructor(address _impl) {
        implementation = _impl;
        if (_impl.code.length == 0) revert ImplementationNotDeployed();
    }

    // ============ External Functions ============

    /**
     * @notice Create a new Kernel smart account
     * @param data Initialization calldata
     * @param salt Salt for deterministic deployment
     * @return account The deployed account address
     */
    function createAccount(
        bytes calldata data,
        bytes32 salt
    ) public payable returns (address account) {
        bytes32 actualSalt = keccak256(abi.encodePacked(data, salt));
        
        (bool alreadyDeployed, address deployed) = LibClone
            .createDeterministicERC1967(msg.value, implementation, actualSalt);
        
        account = deployed;
        
        if (!alreadyDeployed) {
            (bool success, ) = account.call(data);
            if (!success) {
                revert InitializeError();
            }
            emit AccountCreated(account, salt);
        }
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
        return LibClone.predictDeterministicAddressERC1967(
            implementation,
            actualSalt,
            address(this)
        );
    }
}
