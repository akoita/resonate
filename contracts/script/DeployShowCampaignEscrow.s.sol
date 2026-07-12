// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title DeployShowCampaignEscrow
 * @notice Deploys the Shows campaign escrow as a UUPS implementation behind an
 *         ERC1967 proxy, with a TimelockController as the upgrade authority and a
 *         guardian holding the CANCELLER role (issue #1497,
 *         RFC contract-upgradeability-and-recovery).
 *
 * Authority model:
 *   - `owner` (ops multisig): day-to-day operations + the instant emergency pause.
 *     It CANNOT upgrade the implementation.
 *   - `TimelockController`: the escrow's `upgradeAuthority`. Only a scheduled,
 *     delay-elapsed operation through the timelock can upgrade the proxy. The ops
 *     owner is the timelock's proposer+executor; the guardian is a CANCELLER that
 *     can abort a scheduled malicious/mistaken upgrade before it executes.
 *
 * The deployer takes DEFAULT_ADMIN_ROLE on the timelock only transiently — long
 * enough to grant the guardian CANCELLER — then renounces it, leaving the timelock
 * self-administered (no EOA admin). This is the canonical OZ TimelockController
 * bootstrap; the alternative (admin=address(0)) makes the guardian grant impossible.
 *
 * Required env:
 *   PRIVATE_KEY - deployer private key (see DeploymentKey for local override rules)
 *
 * Optional env:
 *   SHOW_CAMPAIGN_ESCROW_OWNER    - ops owner/multisig; defaults to deployer
 *   SHOW_CAMPAIGN_FEE_BPS         - success-only campaign fee in bps; defaults to 600
 *   SHOW_CAMPAIGN_FEE_RECIPIENT   - fee recipient; required on remote, local defaults to owner
 *   SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY - upgrade delay in seconds; defaults to 172800 (48h)
 *   SHOW_CAMPAIGN_GUARDIAN        - guardian CANCELLER; required on remote, local defaults to owner
 */
contract DeployShowCampaignEscrow is DeploymentKey {
    uint256 internal constant DEFAULT_TIMELOCK_MIN_DELAY = 172_800; // 48 hours

    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("SHOW_CAMPAIGN_ESCROW_OWNER", deployer);
        uint256 feeBps = vm.envOr("SHOW_CAMPAIGN_FEE_BPS", uint256(600));
        uint256 minDelay = vm.envOr("SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY", DEFAULT_TIMELOCK_MIN_DELAY);

        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        address feeRecipient = isLocal ? vm.envOr("SHOW_CAMPAIGN_FEE_RECIPIENT", owner) : vm.envAddress("SHOW_CAMPAIGN_FEE_RECIPIENT");
        address guardian = isLocal ? vm.envOr("SHOW_CAMPAIGN_GUARDIAN", owner) : vm.envAddress("SHOW_CAMPAIGN_GUARDIAN");

        vm.startBroadcast(deployerKey);

        // 1. Implementation (initializer-disabled in its constructor).
        ShowCampaignEscrow impl = new ShowCampaignEscrow();

        // 2. Upgrade-authority timelock. Ops owner is proposer + executor (and, per the
        //    OZ constructor, a canceller). Deployer is a transient admin so it can add
        //    the guardian as a canceller, then renounces.
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, deployer);
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);

        // 3. Proxy — initialize binds ops owner, fee config, and the timelock as upgradeAuthority.
        bytes memory initData =
            abi.encodeCall(ShowCampaignEscrow.initialize, (owner, feeBps, feeRecipient, address(timelock)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        ShowCampaignEscrow escrow = ShowCampaignEscrow(address(proxy));

        vm.stopBroadcast();

        console.log("=== ShowCampaignEscrow (UUPS) Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Ops owner:", owner);
        console.log("Fee BPS:", feeBps);
        console.log("Fee Recipient:", feeRecipient);
        console.log("Implementation:", address(impl));
        console.log("ShowCampaignEscrow (proxy):", address(escrow));
        console.log("Upgrade authority (timelock):", address(timelock));
        console.log("Timelock min delay (s):", minDelay);
        console.log("Guardian (CANCELLER):", guardian);
    }
}
