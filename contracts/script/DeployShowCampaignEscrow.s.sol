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
 *         ERC1967 proxy, with a TimelockController as the upgrade authority. Both
 *         the ops owner and an independent guardian hold PROPOSER + EXECUTOR +
 *         CANCELLER roles on the timelock (issue #1497 + SCE-2/#1271,
 *         RFC contract-upgradeability-and-recovery).
 *
 * Authority model:
 *   - `owner` (ops multisig): day-to-day operations + the instant emergency pause.
 *     It CANNOT upgrade the implementation directly. On the timelock it is a
 *     proposer + executor + canceller.
 *   - `guardian` (independent recovery key): a SECOND, fully independent
 *     proposer + executor + canceller on the timelock. It has no operational
 *     authority over the escrow itself, but it can schedule + execute a recovery
 *     upgrade through the timelock without the owner, and can cancel an
 *     owner-scheduled upgrade.
 *   - `TimelockController`: the escrow's `upgradeAuthority`. Only a scheduled,
 *     delay-elapsed operation through the timelock can upgrade the proxy.
 *
 * Recovery rationale (SCE-2, #1271):
 *   The escrow freezes ALL backer refund paths while paused, and `setPaused` is
 *   `onlyOwner`. If the owner key is lost or compromised while paused, the only
 *   recovery is a UUPS upgrade through the timelock. Recovery must therefore NOT
 *   depend on a single key: the guardian is a fully independent proposer +
 *   executor so it can drive a recovery upgrade on its own. Safety is preserved
 *   because that recovery upgrade is still gated by the same `minDelay` (48h)
 *   timelock, and the owner — also a canceller — can cancel a malicious
 *   guardian-initiated upgrade during the delay (and vice-versa). The two
 *   authorities thus check each other without weakening the 48h protection
 *   against a malicious upgrade.
 *
 * The deployer takes DEFAULT_ADMIN_ROLE on the timelock only transiently — long
 * enough to grant the guardian its roles — then renounces it, leaving the timelock
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
 *   SHOW_CAMPAIGN_GUARDIAN        - independent recovery key (proposer+executor+canceller);
 *                                   required on remote, local defaults to owner
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
        //    OZ 5.x constructor, a canceller — it grants CANCELLER_ROLE to every proposer).
        //    Deployer is a transient admin so it can also make the guardian an independent
        //    proposer + executor + canceller, then renounces.
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, deployer);
        // SCE-2 (#1271): recovery must not depend on a single key. Grant the guardian a
        // fully independent recovery path — PROPOSER + EXECUTOR + CANCELLER — so it can
        // schedule and execute a recovery upgrade on its own if the owner key is lost or
        // compromised while the escrow is paused. Safety is unchanged: the recovery upgrade
        // is still gated by `minDelay` (48h), and the owner (also a canceller) can cancel a
        // malicious guardian-initiated upgrade during the delay, and vice-versa.
        timelock.grantRole(timelock.PROPOSER_ROLE(), guardian);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), guardian);
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
        console.log("Guardian (PROPOSER + EXECUTOR + CANCELLER):", guardian);
    }
}
