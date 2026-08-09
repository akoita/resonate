// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";

/// @notice Shared helper ensuring every RevenueEscrow suite exercises the UUPS proxy shape.
library RevenueEscrowProxyDeployer {
    function deploy(address owner, uint256 defaultEscrowPeriod, address upgradeAuthority)
        internal
        returns (RevenueEscrow escrow)
    {
        RevenueEscrow implementation = new RevenueEscrow();
        bytes memory initData = abi.encodeCall(RevenueEscrow.initialize, (owner, defaultEscrowPeriod, upgradeAuthority));
        escrow = RevenueEscrow(address(new ERC1967Proxy(address(implementation), initData)));
    }
}
