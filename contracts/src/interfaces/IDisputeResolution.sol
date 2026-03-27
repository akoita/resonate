// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDisputeResolution
 * @notice Interface for the DisputeResolution contract.
 */
interface IDisputeResolution {
    enum DisputeStatus {
        Filed,
        Evidence,
        UnderReview,
        Escalated,
        JuryVoting,
        Resolved,
        Appealed
    }

    enum Outcome {
        Pending,
        Upheld,
        Rejected,
        Inconclusive
    }

    enum JuryVote {
        None,
        Reporter,
        Creator
    }

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

    function fileDispute(
        uint256 tokenId,
        address reporter,
        address creator,
        string calldata evidenceURI
    ) external payable returns (uint256 disputeId);

    function appeal(uint256 disputeId, address appealer) external;

    function getDispute(
        uint256 disputeId
    ) external view returns (Dispute memory);

    function getAssignedJurors(
        uint256 disputeId
    ) external view returns (address[] memory);

    function disputeCount() external view returns (uint256);
}
