// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {IStemMarketplaceV2} from "../../src/interfaces/IStemMarketplaceV2.sol";
import {StemMarketplaceV2UpgradeMock} from "../mocks/StemMarketplaceV2UpgradeMock.sol";
import {StemMarketplaceProxyDeployer} from "../utils/StemMarketplaceProxyDeployer.sol";

contract StemMarketplaceUpgradeTest is Test, IStemMarketplaceV2 {
    StemMarketplaceV2 internal marketplace;

    address internal stemNFT = makeAddr("stemNFT");
    address internal contentProtection = makeAddr("contentProtection");
    address internal registry = makeAddr("registry");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal owner = makeAddr("owner");
    address internal authority = makeAddr("authority");

    function setUp() public {
        marketplace = StemMarketplaceProxyDeployer.deploy(
            stemNFT, contentProtection, registry, feeRecipient, 1_000, owner, authority
        );
    }

    function test_ImplementationCannotBeInitialized() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert();
        implementation.initialize(stemNFT, contentProtection, registry, feeRecipient, 1_000, owner, authority);
    }

    function test_UsesCanonicalERC7201NamespaceWithoutLinearState() public {
        bytes32 namespaceRoot = 0xf3c94fb6abe0389909903f3f4216f8fe092cd4b74654cae83abd3da828d90500;
        StemMarketplaceV2UpgradeMock implementation = new StemMarketplaceV2UpgradeMock();
        assertEq(implementation.storageLocation(), namespaceRoot);

        // OpenZeppelin v5 parents and marketplace-owned state are namespaced, so
        // initialization must not consume the conventional slot-zero tree.
        assertEq(vm.load(address(marketplace), bytes32(0)), bytes32(0));
        assertEq(address(uint160(uint256(vm.load(address(marketplace), namespaceRoot)))), stemNFT);
        assertEq(
            address(uint160(uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 1))))),
            contentProtection
        );
        assertEq(
            address(uint160(uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 2))))), registry
        );
        assertEq(
            address(uint160(uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 3))))), feeRecipient
        );
        assertEq(uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 4))), 1_000);

        uint256 authorityAndPause = uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 8)));
        // The address occupies the low 160 bits of this explicitly decoded packed slot.
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(address(uint160(authorityAndPause)), authority);
        assertEq((authorityAndPause >> 160) & 0xff, 0);

        vm.prank(owner);
        marketplace.setPaused(true);
        authorityAndPause = uint256(vm.load(address(marketplace), bytes32(uint256(namespaceRoot) + 8)));
        assertEq((authorityAndPause >> 160) & 0xff, 1);
    }

    function test_InitializeRejectsZeroStemNFT() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(ZeroAddress.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation, address(0), contentProtection, registry, feeRecipient, 1_000, owner, authority
        );
    }

    function test_InitializeRejectsZeroOwner() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(ZeroAddress.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation, stemNFT, contentProtection, registry, feeRecipient, 1_000, address(0), authority
        );
    }

    function test_InitializeRejectsZeroUpgradeAuthority() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(ZeroAddress.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation, stemNFT, contentProtection, registry, feeRecipient, 1_000, owner, address(0)
        );
    }

    function test_InitializeRejectsOwnerAsUpgradeAuthority() public {
        StemMarketplaceV2 implementation = new StemMarketplaceV2();
        vm.expectRevert(AuthorityMustDifferFromOwner.selector);
        StemMarketplaceProxyDeployer.deployProxy(
            implementation, stemNFT, contentProtection, registry, feeRecipient, 1_000, owner, owner
        );
    }

    function test_OnlyUpgradeAuthorityCanUpgrade() public {
        StemMarketplaceV2UpgradeMock nextImplementation = new StemMarketplaceV2UpgradeMock();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, owner));
        marketplace.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(authority);
        marketplace.upgradeToAndCall(address(nextImplementation), "");
        assertEq(StemMarketplaceV2UpgradeMock(payable(address(marketplace))).version(), 3);
    }

    function test_UpgradeAuthorityCanRotateItselfButOldAuthorityLosesAccess() public {
        address nextAuthority = makeAddr("nextAuthority");
        StemMarketplaceV2UpgradeMock nextImplementation = new StemMarketplaceV2UpgradeMock();

        vm.prank(authority);
        vm.expectEmit(true, true, false, true);
        emit UpgradeAuthorityUpdated(authority, nextAuthority);
        marketplace.setUpgradeAuthority(nextAuthority);

        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, authority));
        marketplace.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(nextAuthority);
        marketplace.upgradeToAndCall(address(nextImplementation), "");
        assertEq(StemMarketplaceV2UpgradeMock(payable(address(marketplace))).version(), 3);
    }

    function test_OwnerCannotRotateUpgradeAuthority() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, owner));
        marketplace.setUpgradeAuthority(makeAddr("nextAuthority"));
    }

    function test_SetUpgradeAuthorityRejectsZeroAndOwner() public {
        vm.startPrank(authority);
        vm.expectRevert(ZeroAddress.selector);
        marketplace.setUpgradeAuthority(address(0));
        vm.expectRevert(AuthorityMustDifferFromOwner.selector);
        marketplace.setUpgradeAuthority(owner);
        vm.stopPrank();
    }

    function test_OwnershipCannotBeTransferredToUpgradeAuthority() public {
        vm.prank(owner);
        vm.expectRevert(AuthorityMustDifferFromOwner.selector);
        marketplace.transferOwnership(authority);
    }

    function test_TwoStepOwnership() public {
        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        marketplace.transferOwnership(nextOwner);
        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.pendingOwner(), nextOwner);

        vm.prank(nextOwner);
        marketplace.acceptOwnership();
        assertEq(marketplace.owner(), nextOwner);
    }

    function test_PendingOwnerCannotAcceptAfterAuthorityRotatesToIt() public {
        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        marketplace.transferOwnership(nextOwner);
        vm.prank(authority);
        marketplace.setUpgradeAuthority(nextOwner);

        vm.prank(nextOwner);
        vm.expectRevert(AuthorityMustDifferFromOwner.selector);
        marketplace.acceptOwnership();
        assertEq(marketplace.owner(), owner);
    }

    function test_OwnerCanReplacePaymentAssetRegistry() public {
        address nextRegistry = makeAddr("nextRegistry");
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PaymentAssetRegistryUpdated(registry, nextRegistry);
        marketplace.setPaymentAssetRegistry(nextRegistry);
        assertEq(address(marketplace.paymentAssetRegistry()), nextRegistry);
    }

    function test_SetPaymentAssetRegistryRejectsZeroAndNonOwner() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        marketplace.setPaymentAssetRegistry(address(0));

        vm.prank(authority);
        vm.expectRevert();
        marketplace.setPaymentAssetRegistry(makeAddr("nextRegistry"));
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(authority);
        vm.expectRevert();
        marketplace.setPaused(true);

        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit MarketplacePaused(true);
        marketplace.setPaused(true);
        assertTrue(marketplace.paused());
    }
}
