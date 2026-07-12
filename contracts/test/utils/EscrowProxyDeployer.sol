// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";

/**
 * @title EscrowProxyDeployer
 * @notice Shared helper so every ShowCampaignEscrow test exercises the contract
 *         through its real production shape: a UUPS implementation behind an
 *         ERC1967 proxy, initialized via {ShowCampaignEscrow.initialize}.
 * @dev `internal` so the `new` deployments execute in the calling test's context.
 */
library EscrowProxyDeployer {
    /// @return escrow The proxy, typed as ShowCampaignEscrow.
    function deploy(address owner, uint256 feeBps, address feeRecipient, address upgradeAuthority)
        internal
        returns (ShowCampaignEscrow escrow)
    {
        ShowCampaignEscrow impl = new ShowCampaignEscrow();
        bytes memory initData =
            abi.encodeCall(ShowCampaignEscrow.initialize, (owner, feeBps, feeRecipient, upgradeAuthority));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        escrow = ShowCampaignEscrow(address(proxy));
    }
}
