// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDisputeResolutionEvents} from "./IDisputeResolutionEvents.sol";

/**
 * @title IDisputeResolution
 * @notice Consumer interface for the DisputeResolution contract — adds the Dispute
 * struct and function signatures. Extends IDisputeResolutionEvents, which owns the
 * enums, events, and errors. Reference those via IDisputeResolutionEvents (an
 * inherited enum is not reachable through the derived interface's name).
 */
interface IDisputeResolution is IDisputeResolutionEvents {
    struct Dispute {
        uint256 tokenId;
        address reporter;
        address creator;
        string evidenceURI;
        uint256 counterStake;
        DisputeStatus status;
        Outcome outcome;
        uint256 filedAt;
        uint256 resolvedAt;
        uint8 appealCount;
        uint256 escalatedAt;
        uint256 juryDeadlineAt;
        uint8 jurorCount;
        uint8 votesForReporter;
        uint8 votesForCreator;
    }

    function fileDispute(uint256 tokenId, address reporter, address creator, string calldata evidenceURI)
        external
        payable
        returns (uint256 disputeId);

    function appeal(uint256 disputeId, address appealer) external;

    function getDispute(uint256 disputeId) external view returns (Dispute memory);

    function getAssignedJurors(uint256 disputeId) external view returns (address[] memory);

    function disputeCount() external view returns (uint256);
}
