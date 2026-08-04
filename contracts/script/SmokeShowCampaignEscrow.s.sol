// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../src/interfaces/IShowCampaignEscrow.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title SmokeShowCampaignEscrow
 * @notice Post-deploy smoke check (#947) for a deployed ShowCampaignEscrow.
 *
 * Read-only by default: verifies the deployed bytecode answers with the
 * expected constants, a non-zero owner, and a sane initial state. This is the
 * "owner, confirmers, constants" gate that runs against local Anvil and any
 * testnet without a signer.
 *
 * On a local chain (or any chain where the deployer is the owner) set
 * SMOKE_CREATE_CAMPAIGN=true to also exercise basic campaign creation +
 * confirmer round-trip via broadcast. This needs PRIVATE_KEY (the owner).
 *
 * Required env:
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS - address of the deployed escrow
 *
 * Optional env:
 *   SMOKE_VERIFY_UPGRADE_GRAPH - "true" to require and verify the generated UUPS handoff
 *   SMOKE_CREATE_CAMPAIGN - "true" to broadcast a create-campaign + confirmer check
 *   PRIVATE_KEY           - owner key, only needed when SMOKE_CREATE_CAMPAIGN=true
 */
contract SmokeShowCampaignEscrow is DeploymentKey {
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        address escrowAddress = vm.envAddress("SHOW_CAMPAIGN_ESCROW_ADDRESS");
        ShowCampaignEscrow escrow = ShowCampaignEscrow(escrowAddress);

        console.log("=== ShowCampaignEscrow Smoke Check ===");
        console.log("Address:", escrowAddress);

        // 1. Constants must match the deployed product policy.
        require(escrow.BPS_DENOMINATOR() == 10_000, "BPS_DENOMINATOR != 10000");
        require(escrow.MAX_DEPOSIT_RELEASE_BPS() == 3000, "MAX_DEPOSIT_RELEASE_BPS != 3000");

        // 2. Owner is configured.
        address owner = escrow.owner();
        require(owner != address(0), "owner is zero");

        // 3. Initial operational state is sane.
        bool isPaused = escrow.paused();
        uint256 nextId = escrow.nextCampaignId();
        console.log("Owner:", owner);
        console.log("Paused:", isPaused);
        console.log("Next campaign id:", nextId);
        require(!isPaused, "escrow is paused");

        if (vm.envOr("SMOKE_VERIFY_UPGRADE_GRAPH", false)) {
            _verifyUpgradeGraph(escrowAddress, escrow, owner);
        }

        if (!vm.envOr("SMOKE_CREATE_CAMPAIGN", false)) {
            console.log("Read-only smoke check passed.");
            return;
        }

        // 4. Optional write path (local/owner only): create a campaign and a
        //    confirmer, then assert the state moved as expected.
        uint256 deployerKey = _deploymentPrivateKey();
        address caller = vm.addr(deployerKey);
        require(caller == owner, "SMOKE_CREATE_CAMPAIGN requires the owner key");

        uint256 deadline = block.timestamp + 7 days;
        uint256 bookingDeadline = deadline + 7 days;

        vm.startBroadcast(deployerKey);
        uint256 campaignId = escrow.createCampaign(
            keccak256("smoke-artist"),
            keccak256("smoke-authority"),
            caller, // beneficiary
            caller, // payment token placeholder (non-zero; not exercised here)
            1 ether, // goal
            1, // minimum backers
            deadline,
            bookingDeadline,
            1000, // depositReleaseBps (<= MAX)
            3 days // dispute window
        );
        escrow.setConfirmer(caller, true);
        vm.stopBroadcast();

        require(escrow.nextCampaignId() == nextId + 1, "nextCampaignId did not advance");
        require(
            escrow.campaignStatus(campaignId) == IShowCampaignEscrow.CampaignStatus.Draft,
            "new campaign not in Draft status"
        );
        require(escrow.confirmers(caller), "confirmer was not set");

        console.log("Created campaign id:", campaignId);
        console.log("Write smoke check passed.");
    }

    function _verifyUpgradeGraph(address escrowAddress, ShowCampaignEscrow escrow, address owner) internal view {
        address expectedOwner = vm.envAddress("SHOW_CAMPAIGN_ESCROW_OWNER");
        address expectedDeployer = vm.envAddress("SHOW_CAMPAIGN_ESCROW_DEPLOYER");
        address expectedImplementation = vm.envAddress("SHOW_CAMPAIGN_ESCROW_IMPLEMENTATION");
        address expectedTimelock = vm.envAddress("SHOW_CAMPAIGN_TIMELOCK_ADDRESS");
        address expectedGuardian = vm.envAddress("SHOW_CAMPAIGN_GUARDIAN");
        address expectedFeeRecipient = vm.envAddress("SHOW_CAMPAIGN_FEE_RECIPIENT");
        uint256 expectedFeeBps = vm.envUint("SHOW_CAMPAIGN_FEE_BPS");
        uint256 expectedDelay = vm.envUint("SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY");
        uint256 expectedFulfillmentWindow = vm.envUint("SHOW_CAMPAIGN_FULFILLMENT_WINDOW");

        require(owner == expectedOwner, "owner does not match handoff");
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        require(isLocal || expectedGuardian != expectedOwner, "guardian is not independent");
        require(escrow.upgradeAuthority() == expectedTimelock, "upgrade authority does not match handoff");
        require(escrow.campaignFeeBps() == expectedFeeBps, "fee BPS does not match handoff");
        require(escrow.feeRecipient() == expectedFeeRecipient, "fee recipient does not match handoff");
        require(escrow.fulfillmentWindow() == expectedFulfillmentWindow, "fulfillment window does not match handoff");

        address liveImplementation = address(uint160(uint256(vm.load(escrowAddress, ERC1967_IMPLEMENTATION_SLOT))));
        require(liveImplementation == expectedImplementation, "implementation slot does not match handoff");

        TimelockController timelock = TimelockController(payable(expectedTimelock));
        require(timelock.getMinDelay() == expectedDelay, "timelock delay does not match handoff");

        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        bytes32 cancellerRole = timelock.CANCELLER_ROLE();
        bytes32 adminRole = timelock.DEFAULT_ADMIN_ROLE();
        _requireRecoveryRoles(timelock, proposerRole, executorRole, cancellerRole, expectedOwner);
        _requireRecoveryRoles(timelock, proposerRole, executorRole, cancellerRole, expectedGuardian);
        require(timelock.hasRole(adminRole, expectedTimelock), "timelock is not self-administered");
        require(!timelock.hasRole(adminRole, expectedDeployer), "deployer retained timelock admin");
        require(!timelock.hasRole(adminRole, expectedOwner), "owner unexpectedly has timelock admin");
        require(!timelock.hasRole(adminRole, expectedGuardian), "guardian unexpectedly has timelock admin");

        console.log("Implementation:", liveImplementation);
        console.log("Upgrade authority:", expectedTimelock);
        console.log("Guardian:", expectedGuardian);
        console.log("Fulfillment window:", expectedFulfillmentWindow);
        console.log("UUPS/timelock/guardian smoke check passed.");
    }

    function _requireRecoveryRoles(
        TimelockController timelock,
        bytes32 proposerRole,
        bytes32 executorRole,
        bytes32 cancellerRole,
        address account
    ) internal view {
        require(timelock.hasRole(proposerRole, account), "recovery account is not proposer");
        require(timelock.hasRole(executorRole, account), "recovery account is not executor");
        require(timelock.hasRole(cancellerRole, account), "recovery account is not canceller");
    }
}
