// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {EntryPoint} from "@account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "I4337/interfaces/IEntryPoint.sol";
import {Kernel} from "kernel/Kernel.sol";
import {KernelFactory} from "../src/aa/KernelFactory.sol";
import {ECDSAValidator} from "kernel/validator/ECDSAValidator.sol";
import {UniversalSigValidator} from "../src/aa/UniversalSigValidator.sol";

/**
 * @title DeployLocalAA
 * @notice Deploys ERC-4337 EntryPoint v0.7 and ERC-6492 UniversalSigValidator to local Anvil
 *
 * Run with:
 *   forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast
 */
contract DeployLocalAA is Script {
    function run() external {
        // Use first Anvil account (has 10000 ETH)
        uint256 deployerKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            )
        );

        vm.startBroadcast(deployerKey);

        console.log("=== Deploying Local AA Infrastructure ===");
        console.log("");

        // Deploy EntryPoint v0.7
        EntryPoint entryPoint = new EntryPoint();
        console.log("EntryPoint v0.7 deployed at:", address(entryPoint));

        // Deploy UniversalSigValidator (ERC-6492)
        UniversalSigValidator sigValidator = new UniversalSigValidator();
        console.log(
            "UniversalSigValidator (ERC-6492) deployed at:",
            address(sigValidator)
        );

        // Deploy Kernel Implementation (v3.1)
        Kernel kernelImpl = new Kernel(IEntryPoint(address(entryPoint)));
        console.log("Kernel Implementation deployed at:", address(kernelImpl));

        // Deploy KernelFactory
        KernelFactory factory = new KernelFactory(address(kernelImpl));
        console.log("KernelFactory deployed at:", address(factory));

        // Deploy ECDSAValidator
        ECDSAValidator ecdsaValidator = new ECDSAValidator();
        console.log("ECDSAValidator deployed at:", address(ecdsaValidator));

        // V-002: Whitelist KernelFactory in the signature validator
        sigValidator.setAllowedFactory(address(factory), true);
        // V-004: Whitelist only createAccount selector on the factory
        sigValidator.setAllowedSelector(
            address(factory),
            factory.createAccount.selector,
            true
        );
        console.log(
            "KernelFactory whitelisted in UniversalSigValidator (factory + selector)"
        );

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("");
        console.log(
            "IMPORTANT: Update the local Alto ENTRY_POINTS setting in resonate-iac with:",
            address(entryPoint)
        );
        console.log("");
        console.log("Next steps:");
        console.log(
            "1. Stop the local bundler in resonate-iac"
        );
        console.log(
            "2. Update its ENTRY_POINTS setting to:",
            address(entryPoint)
        );
        console.log(
            "3. Restart the bundler stack from resonate-iac"
        );
    }
}
