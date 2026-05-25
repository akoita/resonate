// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

abstract contract DeploymentKey is Script {
    uint256 internal constant DEFAULT_ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function _deploymentPrivateKey() internal view returns (uint256) {
        string memory privateKey = vm.envOr("PRIVATE_KEY", string(""));
        if (bytes(privateKey).length != 0) {
            return vm.envUint("PRIVATE_KEY");
        }

        if (_isLocalChain() || vm.envOr("ALLOW_DEFAULT_ANVIL_PRIVATE_KEY", false)) {
            return DEFAULT_ANVIL_PRIVATE_KEY;
        }

        revert(
            "PRIVATE_KEY is required for non-local deployment; "
            "set ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true to override explicitly"
        );
    }

    function _isLocalChain() private view returns (bool) {
        return block.chainid == 31337 || block.chainid == 1337;
    }
}
