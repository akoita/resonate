// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title UniversalSigValidator
 * @author Resonate Protocol (based on EIP-6492 reference)
 * @notice ERC-6492 Universal Signature Validator
 * @dev Allows verification of signatures from smart contract accounts that may not be deployed yet.
 *      This is based on the reference implementation from EIP-6492.
 *      https://eips.ethereum.org/EIPS/eip-6492
 * @custom:version 1.0.0
 */
contract UniversalSigValidator {
    // ============ Constants ============

    /// @notice ERC-6492 detection suffix
    bytes32 private constant ERC6492_DETECTION_SUFFIX =
        0x6492649264926492649264926492649264926492649264926492649264926492;
    
    /// @notice ERC-1271 magic value for valid signature
    bytes4 private constant ERC1271_SUCCESS = 0x1626ba7e;

    // ============ Errors ============

    error DeploymentFailed();
    error ContractNotDeployed();
    error InvalidSignatureLength(uint256 length);

    // ============ External Functions ============

    /**
     * @notice Validates a signature, supporting EOAs, deployed smart accounts (ERC-1271),
     *         and counterfactual smart accounts (ERC-6492)
     * @param _signer The expected signer address
     * @param _hash The hash that was signed
     * @param _signature The signature to validate
     * @return isValid True if the signature is valid
     */
    function isValidSig(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) public returns (bool isValid) {
        // Check if this is an ERC-6492 signature (contains deployment data)
        if (
            _signature.length >= 32 &&
            bytes32(_signature[_signature.length - 32:]) == ERC6492_DETECTION_SUFFIX
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

            // Check if contract is already deployed
            if (_signer.code.length == 0) {
                // Deploy the contract
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
     * @notice View function version that may have side effects (deployment)
     * @dev Named differently to indicate potential state changes
     */
    function isValidSigWithSideEffects(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) external returns (bool) {
        return isValidSig(_signer, _hash, _signature);
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
        return
            success &&
            result.length >= 32 &&
            abi.decode(result, (bytes4)) == ERC1271_SUCCESS;
    }

    function _isValidEOASig(
        address _signer,
        bytes32 _hash,
        bytes memory _signature
    ) internal pure returns (bool) {
        require(_signature.length == 65, InvalidSignatureLength(_signature.length));

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly ("memory-safe") {
            r := mload(add(_signature, 0x20))
            s := mload(add(_signature, 0x40))
            v := byte(0, mload(add(_signature, 0x60)))
        }

        if (v < 27) v += 27;

        address recovered = ecrecover(_hash, v, r, s);
        return recovered == _signer && recovered != address(0);
    }
}
