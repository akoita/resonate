// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title UpgradeShowCampaignEscrow
 * @notice Two-phase UUPS upgrade of ShowCampaignEscrow through its TimelockController
 *         upgrade authority (issue #1497). The ops owner (timelock proposer+executor)
 *         schedules the upgrade; after the min delay elapses it executes. A guardian
 *         CANCELLER can abort a scheduled operation in between.
 *
 * The signer (PRIVATE_KEY) must be the timelock's proposer/executor (the ops owner).
 *
 * Required env:
 *   UPGRADE_ACTION               - "schedule" or "execute"
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - the proxy address (upgrade target)
 *   SHOW_CAMPAIGN_TIMELOCK_ADDRESS - the TimelockController (upgrade authority)
 *
 * schedule mode:
 *   - deploys a fresh implementation and schedules upgradeToAndCall(newImpl, initCall).
 *   - logs the new implementation, the operation id, and the ETA.
 * execute mode (after delay):
 *   - NEW_IMPLEMENTATION - the implementation address logged by the schedule run.
 *
 * Reinitializer (issue #1271): for the 2.0.0→2.1.0 upgrade the scheduled call carries
 * `initializeV2(fulfillmentWindow)` so the deployed proxy gets a non-zero fulfillment
 * window in the same atomic upgrade. schedule and execute MUST build identical calldata,
 * so both read the same env. Set SHOW_CAMPAIGN_FULFILLMENT_WINDOW=0 to skip the reinit
 * (a plain implementation swap) for future upgrades that must not re-run initializeV2 —
 * initializeV2 is a one-time reinitializer and reverts InvalidInitialization if replayed.
 *
 * Optional env:
 *   SHOW_CAMPAIGN_UPGRADE_SALT - bytes32 salt tying schedule↔execute; defaults to 0.
 *   SHOW_CAMPAIGN_FULFILLMENT_WINDOW - seconds; defaults to 2592000 (30 days). 0 = no reinit.
 */
contract UpgradeShowCampaignEscrow is DeploymentKey {
    uint256 internal constant DEFAULT_FULFILLMENT_WINDOW = 30 days;

    /// @dev Builds the `upgradeToAndCall` calldata, appending the `initializeV2` reinit
    /// call unless SHOW_CAMPAIGN_FULFILLMENT_WINDOW=0. Called identically by schedule and
    /// execute so the timelock operation hash matches across the two phases.
    function _upgradeCalldata(address newImpl) internal view returns (bytes memory) {
        uint256 fulfillmentWindow = vm.envOr("SHOW_CAMPAIGN_FULFILLMENT_WINDOW", DEFAULT_FULFILLMENT_WINDOW);
        bytes memory initCall =
            fulfillmentWindow == 0 ? bytes("") : abi.encodeCall(ShowCampaignEscrow.initializeV2, (fulfillmentWindow));
        return abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (newImpl, initCall));
    }

    function run() external {
        uint256 signerKey = _deploymentPrivateKey();
        address signer = vm.addr(signerKey);
        string memory action = vm.envString("UPGRADE_ACTION");
        address proxy = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        TimelockController timelock = TimelockController(payable(vm.envAddress("SHOW_CAMPAIGN_TIMELOCK_ADDRESS")));
        bytes32 salt = vm.envOr("SHOW_CAMPAIGN_UPGRADE_SALT", bytes32(0));

        bytes32 actionHash = keccak256(bytes(action));
        if (actionHash == keccak256("schedule")) {
            _schedule(signerKey, signer, proxy, timelock, salt);
        } else if (actionHash == keccak256("execute")) {
            _execute(signerKey, signer, proxy, timelock, salt);
        } else {
            revert("UPGRADE_ACTION must be 'schedule' or 'execute'");
        }
    }

    function _schedule(uint256 signerKey, address signer, address proxy, TimelockController timelock, bytes32 salt)
        internal
    {
        uint256 delay = timelock.getMinDelay();

        vm.startBroadcast(signerKey);
        ShowCampaignEscrow newImpl = new ShowCampaignEscrow();
        bytes memory data = _upgradeCalldata(address(newImpl));
        timelock.schedule(proxy, 0, data, bytes32(0), salt, delay);
        vm.stopBroadcast();

        bytes32 opId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);

        console.log("=== ShowCampaignEscrow upgrade SCHEDULED ===");
        console.log("Signer:", signer);
        console.log("Proxy:", proxy);
        console.log("Timelock:", address(timelock));
        console.log("New implementation:", address(newImpl));
        console.log("Delay (s):", delay);
        console.log("ETA (unix):", block.timestamp + delay);
        console.log("Operation id:");
        console.logBytes32(opId);
        console.log("To execute after the ETA: set UPGRADE_ACTION=execute and NEW_IMPLEMENTATION to the address above.");
    }

    function _execute(uint256 signerKey, address signer, address proxy, TimelockController timelock, bytes32 salt)
        internal
    {
        address newImpl = vm.envAddress("NEW_IMPLEMENTATION");
        bytes memory data = _upgradeCalldata(newImpl);
        bytes32 opId = timelock.hashOperation(proxy, 0, data, bytes32(0), salt);

        vm.startBroadcast(signerKey);
        timelock.execute(proxy, 0, data, bytes32(0), salt);
        vm.stopBroadcast();

        console.log("=== ShowCampaignEscrow upgrade EXECUTED ===");
        console.log("Signer:", signer);
        console.log("Proxy:", proxy);
        console.log("New implementation:", newImpl);
        console.log("Operation id:");
        console.logBytes32(opId);
    }
}
