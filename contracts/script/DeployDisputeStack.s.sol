// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {DisputeResolution} from "../src/core/DisputeResolution.sol";
import {CurationRewards} from "../src/core/CurationRewards.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

/**
 * @title DeployDisputeStack
 * @notice Deploys a replacement DisputeResolution (v2.1.0+) and its CurationRewards
 *         next to an existing ContentProtection proxy, so open disputes can hold
 *         creator stakes (#1759).
 *
 * DisputeResolution is not upgradeable and CurationRewards binds it in its
 * constructor, so a chain moves to a lock-capable dispute flow by deploying both
 * again. The run:
 *   1. reads the previous stack (optional) and replicates what behaviour depends on:
 *      the dispute id counter (`disputeCount()` becomes the new `disputeIdOffset`, so
 *      ids stay unique per chain), the juror pool, the counter-stake ratio, the
 *      treasury and the owners;
 *   2. deploys DisputeResolution and CurationRewards wired to the existing
 *      ContentProtection;
 *   3. authorises the new DisputeResolution on ContentProtection when the signer is
 *      the ContentProtection owner and no other authority is set; otherwise logs a
 *      PENDING step for `configure-content-protection-stake-lock`;
 *   4. turns stake locking on (`configureStakeLocking`), so only CurationRewards can
 *      file. Until step 3 is done every report reverts with `NotStakeLockAuthority`:
 *      the new stack never files a dispute that does not hold the stake;
 *   5. hands ownership of both contracts to the configured owners.
 *
 * Environment:
 *   CONTENT_PROTECTION_ADDRESS (or CONTENT_PROTECTION_PROXY)  existing V7 proxy, required
 *   PREVIOUS_DISPUTE_RESOLUTION_ADDRESS   optional; the DisputeResolution being replaced
 *   PREVIOUS_CURATION_REWARDS_ADDRESS     optional; the CurationRewards being replaced
 *   DISPUTE_ID_HEADROOM                   optional, default 0; ids skipped on top of the
 *                                         previous `disputeCount()`
 *   FEE_RECIPIENT                         CurationRewards treasury (as DeployProtocol);
 *                                         defaults to the previous treasury, then (local
 *                                         chains only) to the deployer
 *   DISPUTE_RESOLUTION_OWNER              optional; defaults to the previous owner, then
 *                                         the deployer
 *   CURATION_REWARDS_OWNER                optional; defaults to the previous owner, then
 *                                         the DisputeResolution owner
 *
 * Run:
 *   forge script script/DeployDisputeStack.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployDisputeStack is DeploymentKey {
    /// @dev Upper bound on jurors copied from the previous DisputeResolution.
    uint256 internal constant MAX_JURORS_TO_COPY = 256;

    /// @dev CurationRewards' constructor default, used when nothing is replicated.
    uint256 internal constant DEFAULT_COUNTER_STAKE_BPS = 2000;

    struct DisputeStackConfig {
        address contentProtection;
        address previousDisputeResolution;
        address previousCurationRewards;
        uint256 previousDisputeCount;
        uint256 disputeIdOffset;
        address treasury;
        address disputeResolutionOwner;
        address curationRewardsOwner;
        uint256 counterStakeBps;
        address[] jurors;
    }

    /// @dev Explicit operator inputs; zero means "not set".
    struct DisputeStackInputs {
        address contentProtection;
        address previousDisputeResolution;
        address previousCurationRewards;
        uint256 disputeIdHeadroom;
        address treasury;
        address disputeResolutionOwner;
        address curationRewardsOwner;
    }

    struct DisputeStackResult {
        DisputeResolution disputeResolution;
        CurationRewards curationRewards;
        address deployer;
        bool stakeLockAuthoritySet;
        address stakeLockAuthorityBefore;
        uint256 startBlock;
    }

    function run() external returns (DisputeStackResult memory result) {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        DisputeStackConfig memory config = _resolveDisputeStackConfig(_disputeStackInputs(), deployer);
        result = _deployDisputeStack(deployerKey, config);
        _logSummary(config, result);
    }

    // ============ Config ============

    function _disputeStackInputs() internal view returns (DisputeStackInputs memory inputs) {
        inputs.contentProtection =
            vm.envOr("CONTENT_PROTECTION_ADDRESS", vm.envOr("CONTENT_PROTECTION_PROXY", address(0)));
        inputs.previousDisputeResolution = vm.envOr("PREVIOUS_DISPUTE_RESOLUTION_ADDRESS", address(0));
        inputs.previousCurationRewards = vm.envOr("PREVIOUS_CURATION_REWARDS_ADDRESS", address(0));
        inputs.disputeIdHeadroom = vm.envOr("DISPUTE_ID_HEADROOM", uint256(0));
        inputs.treasury = vm.envOr("FEE_RECIPIENT", address(0));
        inputs.disputeResolutionOwner = vm.envOr("DISPUTE_RESOLUTION_OWNER", address(0));
        inputs.curationRewardsOwner = vm.envOr("CURATION_REWARDS_OWNER", address(0));
    }

    /// @dev Explicit inputs win; the previous contracts provide the defaults.
    function _resolveDisputeStackConfig(DisputeStackInputs memory inputs, address deployer)
        internal
        view
        returns (DisputeStackConfig memory config)
    {
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;

        config.contentProtection = inputs.contentProtection;
        require(config.contentProtection != address(0), "CONTENT_PROTECTION_ADDRESS is required");
        require(config.contentProtection.code.length != 0, "ContentProtection has no code");
        try ContentProtection(payable(config.contentProtection)).stakeLockAuthority() returns (address) {}
        catch {
            revert("ContentProtection is not V7 (#1759): execute the V7 upgrade first");
        }

        address previousOwner;
        config.previousDisputeResolution = inputs.previousDisputeResolution;
        if (config.previousDisputeResolution != address(0)) {
            require(config.previousDisputeResolution.code.length != 0, "previous DisputeResolution has no code");
            require(
                config.previousDisputeResolution != config.contentProtection,
                "PREVIOUS_DISPUTE_RESOLUTION_ADDRESS is the ContentProtection address"
            );
            DisputeResolution previous = DisputeResolution(config.previousDisputeResolution);
            config.previousDisputeCount = previous.disputeCount();
            previousOwner = previous.owner();
            config.jurors = _readJurorPool(previous);
        }
        config.disputeIdOffset = config.previousDisputeCount + inputs.disputeIdHeadroom;

        address previousCurationOwner;
        address previousTreasury;
        config.counterStakeBps = DEFAULT_COUNTER_STAKE_BPS;
        config.previousCurationRewards = inputs.previousCurationRewards;
        if (config.previousCurationRewards != address(0)) {
            require(config.previousCurationRewards.code.length != 0, "previous CurationRewards has no code");
            CurationRewards previousCuration = CurationRewards(config.previousCurationRewards);
            if (config.previousDisputeResolution != address(0)) {
                require(
                    address(previousCuration.disputeResolution()) == config.previousDisputeResolution,
                    "previous CurationRewards is not wired to the previous DisputeResolution"
                );
            }
            previousCurationOwner = previousCuration.owner();
            previousTreasury = previousCuration.treasury();
            config.counterStakeBps = previousCuration.counterStakeBps();
        }

        config.treasury = inputs.treasury != address(0) ? inputs.treasury : previousTreasury;
        if (config.treasury == address(0)) {
            require(isLocal, "FEE_RECIPIENT is required (or PREVIOUS_CURATION_REWARDS_ADDRESS to reuse its treasury)");
            config.treasury = deployer;
        }

        config.disputeResolutionOwner = inputs.disputeResolutionOwner;
        if (config.disputeResolutionOwner == address(0)) config.disputeResolutionOwner = previousOwner;
        if (config.disputeResolutionOwner == address(0)) config.disputeResolutionOwner = deployer;

        config.curationRewardsOwner = inputs.curationRewardsOwner;
        if (config.curationRewardsOwner == address(0)) config.curationRewardsOwner = previousCurationOwner;
        if (config.curationRewardsOwner == address(0)) config.curationRewardsOwner = config.disputeResolutionOwner;
    }

    /// @dev `jurorPool` has no length getter; read entries until the bounds check reverts.
    function _readJurorPool(DisputeResolution previous) internal view returns (address[] memory jurors) {
        address[] memory buffer = new address[](MAX_JURORS_TO_COPY);
        uint256 count;
        for (uint256 i = 0; i < MAX_JURORS_TO_COPY; i++) {
            try previous.jurorPool(i) returns (address juror) {
                buffer[count++] = juror;
            } catch {
                break;
            }
        }
        if (count == MAX_JURORS_TO_COPY) {
            bool more;
            try previous.jurorPool(MAX_JURORS_TO_COPY) returns (address) {
                more = true;
            } catch {}
            require(!more, "previous juror pool exceeds MAX_JURORS_TO_COPY");
        }
        jurors = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            jurors[i] = buffer[i];
        }
    }

    // ============ Deploy ============

    function _deployDisputeStack(uint256 deployerKey, DisputeStackConfig memory config)
        internal
        returns (DisputeStackResult memory result)
    {
        address deployer = vm.addr(deployerKey);
        ContentProtection cp = ContentProtection(payable(config.contentProtection));
        result.deployer = deployer;
        result.startBlock = block.number;
        result.stakeLockAuthorityBefore = cp.stakeLockAuthority();

        vm.startBroadcast(deployerKey);

        // The deployer owns both contracts while they are configured, then hands off.
        DisputeResolution disputeResolution = new DisputeResolution(deployer, config.disputeIdOffset);
        CurationRewards curationRewards =
            new CurationRewards(deployer, config.contentProtection, address(disputeResolution), config.treasury);

        if (config.counterStakeBps != curationRewards.counterStakeBps()) {
            curationRewards.setCounterStakeBps(config.counterStakeBps);
        }
        for (uint256 i = 0; i < config.jurors.length; i++) {
            disputeResolution.registerJuror(config.jurors[i]);
        }

        // Authorise first, then lock (the order ConfigureContentProtectionStakeLock
        // enforces). Never take over from another live authority here: a previous
        // lock-capable DisputeResolution could no longer release its holds.
        if (cp.owner() == deployer && result.stakeLockAuthorityBefore == address(0)) {
            cp.setStakeLockAuthority(address(disputeResolution));
            result.stakeLockAuthoritySet = true;
        }
        disputeResolution.configureStakeLocking(config.contentProtection, address(curationRewards));

        if (config.disputeResolutionOwner != deployer) {
            disputeResolution.transferOwnership(config.disputeResolutionOwner);
        }
        if (config.curationRewardsOwner != deployer) {
            curationRewards.transferOwnership(config.curationRewardsOwner);
        }

        vm.stopBroadcast();

        result.disputeResolution = disputeResolution;
        result.curationRewards = curationRewards;
    }

    // ============ Summary ============

    function _logSummary(DisputeStackConfig memory config, DisputeStackResult memory result) internal pure {
        address dr = address(result.disputeResolution);
        address cr = address(result.curationRewards);

        console.log("=== Dispute stack deployed (#1759) ===");
        console.log("ContentProtection:", config.contentProtection);
        console.log("DisputeResolution:", dr);
        console.log("CurationRewards:", cr);
        console.log("Deployer:", result.deployer);
        console.log("Previous DisputeResolution:", config.previousDisputeResolution);
        console.log("Previous CurationRewards:", config.previousCurationRewards);
        console.log("Previous disputeCount():", config.previousDisputeCount);
        console.log("New disputeIdOffset:", config.disputeIdOffset);
        console.log("First new dispute id:", config.disputeIdOffset + 1);
        console.log("Jurors copied:", config.jurors.length);
        console.log("Counter-stake bps:", config.counterStakeBps);
        console.log("Treasury:", config.treasury);
        console.log("DisputeResolution owner:", config.disputeResolutionOwner);
        console.log("CurationRewards owner:", config.curationRewardsOwner);
        console.log("Simulation head block (the deploy lands after it):", result.startBlock);

        if (config.previousDisputeResolution == address(0)) {
            console.log("WARNING: no PREVIOUS_DISPUTE_RESOLUTION_ADDRESS; dispute ids start at offset + 1.");
            console.log("  Only correct on a chain where no earlier DisputeResolution issued ids.");
        }
        if (config.previousDisputeResolution != address(0) && config.previousCurationRewards == address(0)) {
            console.log("NOTE: no PREVIOUS_CURATION_REWARDS_ADDRESS; counter-stake bps and treasury not replicated.");
        }
        if (result.stakeLockAuthoritySet) {
            console.log("Stake lock authority: set to the new DisputeResolution");
        } else {
            console.log("PENDING: ContentProtection.setStakeLockAuthority(new DisputeResolution).");
            console.log("  Reports revert with NotStakeLockAuthority until it is done. Run");
            console.log("  configure-content-protection-stake-lock with the ContentProtection owner signer");
            console.log("  and DISPUTE_RESOLUTION_ADDRESS / CURATION_REWARDS_ADDRESS set to the addresses above.");
            if (result.stakeLockAuthorityBefore != address(0)) {
                console.log("  Current authority (retire its holds first):", result.stakeLockAuthorityBefore);
            }
        }

        // One machine-readable line for the handoff and the step summary.
        console.log(
            string.concat(
                "DISPUTE_STACK_DEPLOYED disputeResolution=",
                vm.toString(dr),
                " curationRewards=",
                vm.toString(cr),
                " contentProtection=",
                vm.toString(config.contentProtection),
                " disputeIdOffset=",
                vm.toString(config.disputeIdOffset),
                " firstDisputeId=",
                vm.toString(config.disputeIdOffset + 1),
                " startBlock=",
                vm.toString(result.startBlock),
                " stakeLockAuthoritySet=",
                result.stakeLockAuthoritySet ? "true" : "false"
            )
        );
    }
}
