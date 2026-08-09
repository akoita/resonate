// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {IContentProtectionEvents} from "../../src/interfaces/IContentProtectionEvents.sol";
import {ContentProtectionV2} from "../mocks/ContentProtectionV2.sol";

contract ContentProtectionTimelockTest is Test, IContentProtectionEvents {
    uint256 internal constant MIN_DELAY = 48 hours;
    uint256 internal constant STAKE_AMOUNT = 0.01 ether;

    ContentProtection internal contentProtection;
    TimelockController internal timelock;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        address[] memory proposers = new address[](1);
        proposers[0] = owner;
        address[] memory executors = new address[](1);
        executors[0] = owner;
        timelock = new TimelockController(MIN_DELAY, proposers, executors, address(this));
        timelock.grantRole(timelock.PROPOSER_ROLE(), guardian);
        timelock.grantRole(timelock.EXECUTOR_ROLE(), guardian);
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        ContentProtection implementation = new ContentProtection();
        bytes memory initData =
            abi.encodeCall(ContentProtection.initializeFresh, (owner, treasury, STAKE_AMOUNT, address(timelock)));
        contentProtection = ContentProtection(payable(address(new ERC1967Proxy(address(implementation), initData))));
    }

    function test_DirectOwnerUpgradeReverts() public {
        ContentProtectionV2 v2 = new ContentProtectionV2();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, owner));
        contentProtection.upgradeToAndCall(address(v2), "");
    }

    function test_UpgradeWaitsForDelayAndPreservesState() public {
        vm.prank(owner);
        contentProtection.setRegistrar(makeAddr("registrar"), true);
        vm.prank(owner);
        contentProtection.setPaused(true);

        (bytes memory data, bytes32 salt,) = _schedule(owner, "owner-upgrade");
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(contentProtection), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(contentProtection), 0, data, bytes32(0), salt);

        assertEq(ContentProtectionV2(address(contentProtection)).version(), 2);
        assertEq(contentProtection.owner(), owner);
        assertEq(contentProtection.treasury(), treasury);
        assertEq(contentProtection.stakeAmount(), STAKE_AMOUNT);
        assertEq(contentProtection.upgradeAuthority(), address(timelock));
        assertTrue(contentProtection.paused());
    }

    function test_GuardianCanCancelOwnerUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(owner, "owner-cancelled");
        vm.prank(guardian);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(contentProtection), 0, data, bytes32(0), salt);
    }

    function test_OwnerCanCancelGuardianUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(guardian, "guardian-cancelled");
        vm.prank(owner);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(contentProtection), 0, data, bytes32(0), salt);
    }

    function test_GuardianAloneCanRecoverAfterDelay() public {
        (bytes memory data, bytes32 salt,) = _schedule(guardian, "guardian-recovery");
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        timelock.execute(address(contentProtection), 0, data, bytes32(0), salt);
        assertEq(ContentProtectionV2(address(contentProtection)).version(), 2);
    }

    function test_RoleWiringHasNoEoaAdmin() public view {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), guardian));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), owner));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), guardian));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)));
    }

    function _schedule(address proposer, string memory label)
        internal
        returns (bytes memory data, bytes32 salt, bytes32 operationId)
    {
        ContentProtectionV2 v2 = new ContentProtectionV2();
        data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(v2), ""));
        salt = keccak256(bytes(label));
        vm.prank(proposer);
        timelock.schedule(address(contentProtection), 0, data, bytes32(0), salt, MIN_DELAY);
        operationId = timelock.hashOperation(address(contentProtection), 0, data, bytes32(0), salt);
    }
}
