// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical errors for shared stake-presence and stake-asset checks.
interface IStakeGuards {
    error NotStaked();
    error UnsupportedStakeAsset();
}
