// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical surface for UUPS implementations governed by a dedicated
/// upgrade authority.
interface IUpgradeAuthority {
    event UpgradeAuthorityUpdated(address indexed previousAuthority, address indexed newAuthority);

    error UnauthorizedUpgrade(address caller);
    error AuthorityMustDifferFromOwner();
}
