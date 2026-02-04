// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ISplitMain
 * @notice Interface for 0xSplits SplitMain contract (V1)
 * @dev https://docs.splits.org/core
 *      Use production 0xSplits contracts in mainnet/testnet deployments
 */
interface ISplitMain {
    /// @notice Create a new split
    /// @param accounts Ordered, unique list of addresses with ownership in the split
    /// @param percentAllocations Percent allocations associated with each address (must sum to 1e6)
    /// @param distributorFee Keeper fee for calling distribute (0-1e5 = 0-10%)
    /// @param controller Address with control of the split (0x0 = immutable)
    /// @return split Address of the created split
    function createSplit(
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address controller
    ) external returns (address split);

    /// @notice Predict the address of a split
    function predictImmutableSplitAddress(
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee
    ) external view returns (address split);

    /// @notice Distribute ETH for a split
    /// @param split Address of the split
    /// @param accounts Ordered list of accounts in the split
    /// @param percentAllocations Percent allocations for each account
    /// @param distributorFee Fee for the distributor
    /// @param distributorAddress Address to receive distributor fee
    function distributeETH(
        address split,
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address distributorAddress
    ) external;

    /// @notice Distribute ERC20 for a split
    function distributeERC20(
        address split,
        address token,
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address distributorAddress
    ) external;

    /// @notice Withdraw all balances for an account
    /// @param account Address to withdraw for
    /// @param withdrawETH Whether to withdraw ETH
    /// @param tokens List of ERC20 tokens to withdraw
    function withdraw(
        address account,
        uint256 withdrawETH,
        address[] calldata tokens
    ) external;

    /// @notice Get ETH balance for an account
    function getETHBalance(address account) external view returns (uint256);

    /// @notice Get ERC20 balance for an account
    function getERC20Balance(address account, address token) external view returns (uint256);

    /// @notice Get the hash of a split
    function getHash(address split) external view returns (bytes32);

    /// @notice Get controller of a split
    function getController(address split) external view returns (address);
}

/**
 * @title ISplitV2Factory
 * @notice Interface for 0xSplits V2 Factory
 * @dev V2 uses the Warehouse pattern for gas-efficient withdrawals
 */
interface ISplitV2Factory {
    struct Split {
        address[] recipients;
        uint256[] allocations;
        uint256 totalAllocation;
        uint16 distributionIncentive;
    }

    /// @notice Create a new split
    function createSplit(
        Split calldata _splitParams,
        address _owner,
        address _creator
    ) external returns (address split);

    /// @notice Predict split address
    function predictDeterministicAddress(
        Split calldata _splitParams,
        address _owner
    ) external view returns (address);
}

/**
 * @title ISplitWallet
 * @notice Interface for individual split wallet
 */
interface ISplitWallet {
    /// @notice Distribute funds to recipients
    function distribute(
        address[] calldata accounts,
        uint32[] calldata percentAllocations,
        uint32 distributorFee,
        address distributorAddress
    ) external;

    /// @notice Send ETH to this split
    function sendETHToMain() external payable;
}
