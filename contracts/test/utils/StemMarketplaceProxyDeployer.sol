// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";

/// @notice Shared helper ensuring every StemMarketplaceV2 suite exercises the UUPS proxy shape.
library StemMarketplaceProxyDeployer {
    function deploy(
        address stemNFT,
        address contentProtection,
        address paymentAssetRegistry,
        address feeRecipient,
        uint256 feeBps,
        address owner,
        address upgradeAuthority
    ) internal returns (StemMarketplaceV2 marketplace) {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        marketplace = deployProxy(
            implementation,
            stemNFT,
            contentProtection,
            paymentAssetRegistry,
            feeRecipient,
            feeBps,
            owner,
            upgradeAuthority
        );
    }

    function deployProxy(
        StemMarketplaceV2 implementation,
        address stemNFT,
        address contentProtection,
        address paymentAssetRegistry,
        address feeRecipient,
        uint256 feeBps,
        address owner,
        address upgradeAuthority
    ) internal returns (StemMarketplaceV2 marketplace) {
        bytes memory initData = abi.encodeCall(
            StemMarketplaceV2.initialize,
            (stemNFT, contentProtection, paymentAssetRegistry, feeRecipient, feeBps, owner, upgradeAuthority)
        );
        marketplace = StemMarketplaceV2(payable(address(new ERC1967Proxy(address(implementation), initData))));
    }
}
