// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @dev Minimal ERC-5267 view surface so the helper can rebuild the exact EIP-712
/// domain the deployed ContentProtection proxy uses (name/version/chainId/address).
interface IEIP712Domain {
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

/**
 * @title AttestationVoucher
 * @notice Shared test helper for building registrar-signed EIP-712 attestation
 *         authorization vouchers consumed by ContentProtection.attest / attestRelease
 *         (CP-1, #1271).
 * @dev Rebuilds the EIP-712 domain from the contract's own ERC-5267 `eip712Domain()`
 *      getter so a voucher always matches the deployed domain, and mirrors the
 *      production typehash. `library` with `internal` functions so signing runs in the
 *      caller's context (like {EscrowProxyDeployer}).
 */
library AttestationVoucher {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant ATTESTATION_AUTHORIZATION_TYPEHASH =
        keccak256("AttestationAuthorization(address attester,uint256 tokenId,uint256 deadline)");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice Produce a registrar-signed voucher authorizing `attester` to attest
    ///         `tokenId` up to `deadline`.
    /// @param cpProxy      The ContentProtection proxy that will verify the voucher.
    /// @param registrarPk  Private key whose address must be a registered registrar.
    /// @return The 65-byte `(r, s, v)` signature to pass to attest / attestRelease.
    function sign(address cpProxy, uint256 registrarPk, address attester, uint256 tokenId, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            IEIP712Domain(cpProxy).eip712Domain();

        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract
            )
        );
        bytes32 structHash = keccak256(abi.encode(ATTESTATION_AUTHORIZATION_TYPEHASH, attester, tokenId, deadline));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(registrarPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
