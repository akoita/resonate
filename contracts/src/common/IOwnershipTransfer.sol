// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Canonical ownership-transfer event shared by Resonate-owned contracts.
interface IOwnershipTransfer {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
