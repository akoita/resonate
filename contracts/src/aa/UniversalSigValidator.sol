// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title UniversalSigValidator
 * @author Resonate Protocol (based on EIP-6492 reference)
 * @notice ERC-6492 Universal Signature Validator with factory whitelist
 * @dev Allows verification of signatures from smart contract accounts that may not be deployed yet.
 *      This is based on the reference implementation from EIP-6492.
 *      https://eips.ethereum.org/EIPS/eip-6492
 *
 * @custom:security V-002 (evmbench): The original ERC-6492 reference implementation performs
 *      attacker-controlled factory.call(factoryCalldata) decoded from untrusted signature bytes.
 *      This creates a reentrancy/arbitrary-call surface for integrators that call isValidSig()
 *      during sensitive state transitions.
 *
 *      Mitigations applied:
 *      1. Factory whitelist — only owner-approved factories may be called during ERC-6492 validation
 *      2. ReentrancyGuard — prevents reentrant calls through the factory callback
 *      3. Clear NatSpec — documents that isValidSig() has side effects (contract deployment)
 *
 * @custom:version 2.0.0
 */
contract UniversalSigValidator is Ownable, ReentrancyGuard {
    // ============ Constants ============

    /// @notice ERC-6492 detection suffix
    bytes32 private constant ERC6492_DETECTION_SUFFIX =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    /// @notice ERC-1271 magic value for valid signature
    bytes4 private constant ERC1271_SUCCESS = 0x1626ba7e;

    // ============ State ============

    /// @notice Whitelisted factories allowed for ERC-6492 counterfactual deployment
    mapping(address => bool) public allowedFactories;

    /// @notice Whitelisted (factory, selector) pairs for ERC-6492 factory calls
    /// @dev V-004: Restricts which functions can be called on whitelisted factories
    mapping(address => mapping(bytes4 => bool)) public allowedSelectors;

    // ============ Events ============

    event FactoryAllowed(address indexed factory, bool allowed);
    event SelectorAllowed(
        address indexed factory,
        bytes4 indexed selector,
        bool allowed
    );

    // ============ Errors ============

    error DeploymentFailed();
    error ContractNotDeployed();
    error InvalidSignatureLength(uint256 length);
    error InvalidSValue();
    error FactoryNotAllowed(address factory);
    error SelectorNotAllowed(address factory, bytes4 selector);
    error CalldataTooShort();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin ============

    /// @notice Whitelist or revoke a factory for ERC-6492 counterfactual deployment
    /// @param factory The factory contract address (e.g., KernelFactory)
    /// @param allowed Whether the factory is allowed
    function setAllowedFactory(
        address factory,
        bool allowed
    ) external onlyOwner {
        allowedFactories[factory] = allowed;
        emit FactoryAllowed(factory, allowed);
    }

    /// @notice Whitelist or revoke a specific function selector on a factory
    /// @dev V-004: Only approved selectors can be called during ERC-6492 validation
    /// @param factory The factory contract address
    /// @param selector The 4-byte function selector (e.g., KernelFactory.createAccount.selector)
    /// @param allowed Whether the selector is allowed
    function setAllowedSelector(
        address factory,
        bytes4 selector,
        bool allowed
    ) external onlyOwner {
        allowedSelectors[factory][selector] = allowed;
        emit SelectorAllowed(factory, selector, allowed);
    }

    // ============ External Functions ============

    /**
     * @notice Validates a signature, supporting EOAs, deployed smart accounts (ERC-1271),
     *         and counterfactual smart accounts (ERC-6492)
     * @dev WARNING: This function has SIDE EFFECTS. For ERC-6492 signatures, it may deploy
     *      a contract via a whitelisted factory. Integrators MUST:
     *      1. Update critical state (nonces, flags) BEFORE calling this function
     *      2. Apply reentrancy guards on the calling contract
     *      3. Never assume this is a pure/view function
     * @param _signer The expected signer address
     * @param _hash The hash that was signed
     * @param _signature The signature to validate
     * @return isValid True if the signature is valid
     */
    function isValidSig(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) public nonReentrant returns (bool isValid) {
        // Check if this is an ERC-6492 signature (contains deployment data)
        if (
            _signature.length >= 32 &&
            bytes32(_signature[_signature.length - 32:]) ==
            ERC6492_DETECTION_SUFFIX
        ) {
            // ERC-6492 signature - decode deployment data
            (
                address factory,
                bytes memory factoryCalldata,
                bytes memory innerSig
            ) = abi.decode(
                    _signature[0:_signature.length - 32],
                    (address, bytes, bytes)
                );

            // V-002 fix: Only allow whitelisted factories
            if (!allowedFactories[factory]) {
                revert FactoryNotAllowed(factory);
            }

            // V-004 fix: Only allow whitelisted selectors on the factory
            if (factoryCalldata.length < 4) revert CalldataTooShort();
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(factoryCalldata, 32))
            }
            if (!allowedSelectors[factory][selector]) {
                revert SelectorNotAllowed(factory, selector);
            }

            // Check if contract is already deployed
            if (_signer.code.length == 0) {
                // Deploy the contract via whitelisted factory
                (bool success, ) = factory.call(factoryCalldata);
                require(success, DeploymentFailed());
                require(_signer.code.length > 0, ContractNotDeployed());
            }

            // Validate with ERC-1271
            return _isValidERC1271Sig(_signer, _hash, innerSig);
        }

        // Check if signer is a contract (ERC-1271)
        if (_signer.code.length > 0) {
            return _isValidERC1271Sig(_signer, _hash, _signature);
        }

        // EOA signature validation
        return _isValidEOASig(_signer, _hash, _signature);
    }

    /**
     * @notice Alias for isValidSig — both have side effects
     * @dev Both functions may deploy contracts for ERC-6492 signatures.
     *      This function exists for interface compatibility.
     */
    function isValidSigWithSideEffects(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) external returns (bool) {
        return isValidSig(_signer, _hash, _signature);
    }

    /**
     * @notice Explicitly deploy a counterfactual signer without performing validation
     * @dev V-005: Use this to separate deployment from validation in sensitive flows.
     *      Recommended pattern for integrators handling assets:
     *
     *      1. Call deploySigner(signer, erc6492Sig) — deploys the account
     *      2. Call isValidSigNoSideEffects(signer, hash, innerSig) — pure verification
     *
     *      This ensures no external calls occur during the authorization check.
     * @param _signer The expected signer address (must match the deployed account)
     * @param _signature The full ERC-6492 signature containing deployment data
     */
    function deploySigner(
        address _signer,
        bytes calldata _signature
    ) external nonReentrant {
        require(
            _signature.length >= 32 &&
                bytes32(_signature[_signature.length - 32:]) ==
                ERC6492_DETECTION_SUFFIX,
            "Not an ERC-6492 signature"
        );

        (address factory, bytes memory factoryCalldata, ) = abi.decode( // innerSig not used — deployment only
                _signature[0:_signature.length - 32],
                (address, bytes, bytes)
            );

        if (!allowedFactories[factory]) revert FactoryNotAllowed(factory);

        if (factoryCalldata.length < 4) revert CalldataTooShort();
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(factoryCalldata, 32))
        }
        if (!allowedSelectors[factory][selector]) {
            revert SelectorNotAllowed(factory, selector);
        }

        if (_signer.code.length == 0) {
            (bool success, ) = factory.call(factoryCalldata);
            require(success, DeploymentFailed());
            require(_signer.code.length > 0, ContractNotDeployed());
        }
    }

    // ============ View Functions ============

    /**
     * @notice Pure signature validation for already-deployed signers (no side effects)
     * @dev Use this when you know the signer is already deployed (EOA or ERC-1271 contract).
     *      This function will revert for ERC-6492 signatures.
     * @param _signer The expected signer address
     * @param _hash The hash that was signed
     * @param _signature The signature to validate
     * @return isValid True if the signature is valid
     */
    function isValidSigNoSideEffects(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) external view returns (bool isValid) {
        // Reject ERC-6492 signatures — they require deployment
        require(
            _signature.length < 32 ||
                bytes32(_signature[_signature.length - 32:]) !=
                ERC6492_DETECTION_SUFFIX,
            "ERC-6492 signatures require isValidSig()"
        );

        if (_signer.code.length > 0) {
            return _isValidERC1271Sig(_signer, _hash, _signature);
        }

        return _isValidEOASig(_signer, _hash, _signature);
    }

    // ============ Internal Functions ============

    function _isValidERC1271Sig(
        address _signer,
        bytes32 _hash,
        bytes memory _signature
    ) internal view returns (bool) {
        (bool success, bytes memory result) = _signer.staticcall(
            abi.encodeWithSelector(ERC1271_SUCCESS, _hash, _signature)
        );
        if (!success || result.length < 4) return false;

        // V-007: Accept both 4-byte (assembly return) and 32-byte (ABI-encoded) payloads
        bytes4 magicValue;
        if (result.length >= 32) {
            magicValue = abi.decode(result, (bytes4));
        } else {
            // Some ERC-1271 implementations return only 4 bytes via assembly
            assembly ("memory-safe") {
                magicValue := mload(add(result, 32))
            }
        }
        return magicValue == ERC1271_SUCCESS;
    }

    function _isValidEOASig(
        address _signer,
        bytes32 _hash,
        bytes memory _signature
    ) internal pure returns (bool) {
        require(
            _signature.length == 65,
            InvalidSignatureLength(_signature.length)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly ("memory-safe") {
            r := mload(add(_signature, 0x20))
            s := mload(add(_signature, 0x40))
            v := byte(0, mload(add(_signature, 0x60)))
        }

        if (v < 27) v += 27;

        // Enforce lower-s to prevent signature malleability
        require(
            uint256(s) <=
                0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            InvalidSValue()
        );

        address recovered = ecrecover(_hash, v, r, s);
        return recovered == _signer && recovered != address(0);
    }
}
