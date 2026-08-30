// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {Kernel} from "kernel-v4/Kernel.sol";
import {KernelFactory} from "kernel-v4/KernelFactory.sol";
import {KernelImmutableECDSA} from "kernel-v4/KernelImmutableECDSA.sol";
import {KernelUUPS} from "kernel-v4/KernelUUPS.sol";
import {Install} from "kernel-v4/types/Structs.sol";
import {InvalidSigner} from "kernel-v4/types/Error.sol";

/// @notice First-party smoke coverage for the isolated Kernel v4 dependency.
/// @dev This harness intentionally exercises deployECDSA with no validator
/// plugin. Existing Resonate accounts and the production local-AA script stay
/// on the legacy Kernel v2.4/v3.1 dependency boundary.
contract KernelFactoryCompatibilityTest is Test {
    EntryPoint internal entryPoint;
    KernelFactory internal factory;
    address internal signer;

    function setUp() public {
        entryPoint = new EntryPoint();
        KernelUUPS uups = new KernelUUPS(IEntryPoint(address(entryPoint)));
        KernelImmutableECDSA immutableEcdsa = new KernelImmutableECDSA(IEntryPoint(address(entryPoint)));
        factory = new KernelFactory(uups, immutableEcdsa);
        (signer,) = makeAddrAndKey("Kernel v4 signer");
    }

    function test_getECDSAAddress_agreesWithDeployment() public {
        Install[] memory packages = _emptyPackages();
        uint256 nonce = 17;
        address predicted = factory.getECDSAAddress(signer, packages, nonce);

        Kernel deployed = factory.deployECDSA(signer, packages, nonce);

        assertEq(address(deployed), predicted);
    }

    function test_deployECDSA_rejectsZeroSigner() public {
        Install[] memory packages = _emptyPackages();

        vm.expectRevert(InvalidSigner.selector);
        factory.deployECDSA(address(0), packages, 1);
    }

    function test_deployECDSA_differentNonceProducesDifferentAddress() public view {
        Install[] memory packages = _emptyPackages();

        address first = factory.getECDSAAddress(signer, packages, 1);
        address second = factory.getECDSAAddress(signer, packages, 2);

        assertTrue(first != second);
    }

    function test_deployECDSA_sameSignerAndNonceIsIdempotent() public {
        Install[] memory packages = _emptyPackages();

        Kernel first = factory.deployECDSA(signer, packages, 3);
        Kernel second = factory.deployECDSA(signer, packages, 3);

        assertEq(address(second), address(first));
    }

    function test_deployECDSA_initializesAccount() public {
        Install[] memory packages = _emptyPackages();
        Kernel deployed = factory.deployECDSA(signer, packages, 4);
        KernelUUPS account = KernelUUPS(payable(address(deployed)));

        assertGt(address(account).code.length, 0);
        vm.expectRevert();
        account.initialize(packages);
    }

    function test_deployECDSA_forwardsValue() public {
        Install[] memory packages = _emptyPackages();
        uint256 value = 1 ether;
        vm.deal(address(this), value);

        Kernel deployed = factory.deployECDSA{value: value}(signer, packages, 5);

        assertEq(address(deployed).balance, value);
    }

    function testFuzz_getECDSAAddress_isStable(address candidateSigner, uint256 nonce) public {
        vm.assume(candidateSigner != address(0));
        Install[] memory packages = _emptyPackages();

        address predicted = factory.getECDSAAddress(candidateSigner, packages, nonce);
        Kernel deployed = factory.deployECDSA(candidateSigner, packages, nonce);

        assertEq(address(deployed), predicted);
        assertGt(predicted.code.length, 0);
    }

    function _emptyPackages() internal pure returns (Install[] memory packages) {
        packages = new Install[](0);
    }
}
