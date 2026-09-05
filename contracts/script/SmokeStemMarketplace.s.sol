// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Read-only validation of StemMarketplaceV2 configuration and authority graph.
contract SmokeStemMarketplace is Script {
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external view {
        address proxy = vm.envAddress("MARKETPLACE_ADDRESS");
        StemMarketplaceV2 marketplace = StemMarketplaceV2(payable(proxy));
        address owner = vm.envAddress("MARKETPLACE_OWNER");
        address deployer = vm.envAddress("MARKETPLACE_DEPLOYER");
        address guardian = vm.envAddress("MARKETPLACE_GUARDIAN");
        address implementation = vm.envAddress("MARKETPLACE_IMPLEMENTATION");
        address timelockAddress = vm.envAddress("MARKETPLACE_TIMELOCK_ADDRESS");
        address stemNft = vm.envAddress("STEM_NFT_ADDRESS");
        address contentProtection = vm.envAddress("CONTENT_PROTECTION_ADDRESS");
        address registry = vm.envAddress("PAYMENT_ASSET_REGISTRY_ADDRESS");
        uint256 feeBps = vm.envUint("PROTOCOL_FEE_BPS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 delay = vm.envUint("MARKETPLACE_TIMELOCK_MIN_DELAY");
        bool expectedPaused = vm.envOr("MARKETPLACE_PAUSED", false);

        require(proxy.code.length != 0, "proxy has no code");
        require(marketplace.owner() == owner, "owner mismatch");
        require(address(marketplace.stemNFT()) == stemNft, "StemNFT mismatch");
        require(address(marketplace.contentProtection()) == contentProtection, "ContentProtection mismatch");
        require(address(marketplace.paymentAssetRegistry()) == registry, "registry mismatch");
        require(marketplace.protocolFeeBps() == feeBps, "fee mismatch");
        require(marketplace.protocolFeeRecipient() == feeRecipient, "fee recipient mismatch");
        require(marketplace.upgradeAuthority() == timelockAddress, "upgrade authority mismatch");
        require(marketplace.paused() == expectedPaused, "paused state mismatch");
        address liveImplementation = address(uint160(uint256(vm.load(proxy, ERC1967_IMPLEMENTATION_SLOT))));
        require(liveImplementation == implementation, "implementation slot mismatch");

        TimelockController timelock = TimelockController(payable(timelockAddress));
        require(timelock.getMinDelay() == delay, "timelock delay mismatch");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), deployer), "deployer remains admin");
        require(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), timelockAddress), "timelock is not self-admin");
        _requireRecoveryRoles(timelock, owner);
        _requireRecoveryRoles(timelock, guardian);
        bool isLocal = block.chainid == 31337 || block.chainid == 1337;
        require(isLocal || (guardian != owner && guardian != deployer), "guardian is not independent");
        require(isLocal || delay >= 48 hours, "timelock delay below 48h");

        console.log("StemMarketplaceV2 authority graph/config smoke check passed:", proxy);
    }

    function _requireRecoveryRoles(TimelockController timelock, address account) internal view {
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), account), "recovery account is not proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), account), "recovery account is not executor");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), account), "recovery account is not canceller");
    }
}
