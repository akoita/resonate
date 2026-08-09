// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical error for Resonate operations blocked by an emergency pause.
interface IPausableGuard {
    error Paused();
}
