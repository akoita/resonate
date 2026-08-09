// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical errors for shared dispute-party and resolution checks.
interface IDisputeGuards {
    error NotDisputeParty();
    error DisputeNotResolved();
}
