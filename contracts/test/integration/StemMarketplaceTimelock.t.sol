// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {IStemMarketplaceV2} from "../../src/interfaces/IStemMarketplaceV2.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockContentProtectionMarketplace} from "../mocks/MockContentProtectionMarketplace.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";
import {StemMarketplaceV2UpgradeMock} from "../mocks/StemMarketplaceV2UpgradeMock.sol";
import {StemMarketplaceProxyDeployer} from "../utils/StemMarketplaceProxyDeployer.sol";

contract StemMarketplaceTimelockTest is Test, IStemMarketplaceV2 {
    uint256 internal constant MIN_DELAY = 48 hours;
    uint256 internal constant FEE_BPS = 1_000;
    uint96 internal constant ROYALTY_BPS = 500;

    StemNFT internal stemNFT;
    StemMarketplaceV2 internal marketplace;
    TransferValidator internal validator;
    PaymentAssetRegistry internal registry;
    MockContentProtectionMarketplace internal contentProtection;
    TimelockController internal timelock;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

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

        stemNFT = new StemNFT("https://api.resonate.fm/metadata/");
        validator = new TransferValidator();
        contentProtection = new MockContentProtectionMarketplace();
        registry = new PaymentAssetRegistry(owner);
        vm.prank(owner);
        registry.configureAsset(keccak256("local:eth"), address(0), "ETH", 18, true, false);

        marketplace = StemMarketplaceProxyDeployer.deploy(
            address(stemNFT),
            address(contentProtection),
            address(registry),
            feeRecipient,
            FEE_BPS,
            owner,
            address(timelock)
        );
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);
        stemNFT.grantRole(stemNFT.MINTER_ROLE(), seller);
        vm.deal(buyer, 10 ether);
    }

    function test_TimelockedUpgradePreservesLiveStateAndMarketplaceRecovers() public {
        RevertingReceiver royaltyReceiver = new RevertingReceiver();
        uint256[] memory parentIds = new uint256[](0);
        vm.prank(seller);
        uint256 tokenId =
            stemNFT.mint(seller, 10, "ipfs://upgrade-state", address(royaltyReceiver), ROYALTY_BPS, true, parentIds);
        vm.startPrank(seller);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, 10, 1 ether, address(0), 7 days);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buy{value: 1 ether}(listingId, 1);
        assertEq(marketplace.failedPayments(address(0), address(royaltyReceiver)), 0.05 ether);

        vm.prank(owner);
        marketplace.setPaused(true);

        (bytes memory data, bytes32 salt,) = _schedule(owner, "state-preserving-upgrade");
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);

        assertEq(StemMarketplaceV2UpgradeMock(payable(address(marketplace))).version(), 3);
        assertEq(marketplace.owner(), owner);
        assertEq(marketplace.upgradeAuthority(), address(timelock));
        assertTrue(marketplace.paused());
        assertEq(address(marketplace.stemNFT()), address(stemNFT));
        assertEq(address(marketplace.contentProtection()), address(contentProtection));
        assertEq(address(marketplace.paymentAssetRegistry()), address(registry));
        assertEq(marketplace.protocolFeeRecipient(), feeRecipient);
        assertEq(marketplace.protocolFeeBps(), FEE_BPS);
        assertEq(marketplace.failedPayments(address(0), address(royaltyReceiver)), 0.05 ether);
        IStemMarketplaceV2.Listing memory listing = marketplace.getListing(listingId);
        assertEq(listing.seller, seller);
        assertEq(listing.tokenId, tokenId);
        assertEq(listing.amount, 9);
        assertEq(listing.pricePerUnit, 1 ether);

        royaltyReceiver.setReject(false);
        vm.prank(address(royaltyReceiver));
        marketplace.claimFailedPayment(address(0));
        vm.prank(owner);
        marketplace.setPaused(false);
        vm.prank(buyer);
        marketplace.buy{value: 1 ether}(listingId, 1);
        assertEq(stemNFT.balanceOf(buyer, tokenId), 2);
        assertEq(address(royaltyReceiver).balance, 0.1 ether);
    }

    function test_DirectOwnerUpgradeReverts() public {
        StemMarketplaceV2UpgradeMock nextImplementation = new StemMarketplaceV2UpgradeMock();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, owner));
        marketplace.upgradeToAndCall(address(nextImplementation), "");
    }

    function test_GuardianCanCancelOwnerUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(owner, "owner-upgrade");
        vm.prank(guardian);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);
    }

    function test_OwnerCanCancelGuardianUpgrade() public {
        (bytes memory data, bytes32 salt, bytes32 operationId) = _schedule(guardian, "guardian-upgrade");
        vm.prank(owner);
        timelock.cancel(operationId);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);
    }

    function test_GuardianAloneCanRecoverAfterDelay() public {
        (bytes memory data, bytes32 salt,) = _schedule(guardian, "guardian-recovery");
        vm.prank(guardian);
        vm.expectRevert();
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(guardian);
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);
        assertEq(StemMarketplaceV2UpgradeMock(payable(address(marketplace))).version(), 3);
    }

    function test_TimelockAloneCanRotateUpgradeAuthorityAfterDelay() public {
        address nextAuthority = makeAddr("nextAuthority");
        bytes memory data = abi.encodeCall(StemMarketplaceV2.setUpgradeAuthority, (nextAuthority));
        bytes32 salt = keccak256("rotate-marketplace-authority");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedUpgrade.selector, owner));
        marketplace.setUpgradeAuthority(nextAuthority);

        vm.prank(owner);
        timelock.schedule(address(marketplace), 0, data, bytes32(0), salt, MIN_DELAY);
        vm.prank(owner);
        vm.expectRevert();
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(owner);
        timelock.execute(address(marketplace), 0, data, bytes32(0), salt);
        assertEq(marketplace.upgradeAuthority(), nextAuthority);
    }

    function test_TimelockRoleWiringHasNoEoaAdmin() public view {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), guardian));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), owner));
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), guardian));
        assertTrue(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)));
    }

    function _schedule(address proposer, string memory label)
        internal
        returns (bytes memory data, bytes32 salt, bytes32 operationId)
    {
        StemMarketplaceV2UpgradeMock nextImplementation = new StemMarketplaceV2UpgradeMock();
        data = abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(nextImplementation), ""));
        salt = keccak256(bytes(label));
        vm.prank(proposer);
        timelock.schedule(address(marketplace), 0, data, bytes32(0), salt, MIN_DELAY);
        operationId = timelock.hashOperation(address(marketplace), 0, data, bytes32(0), salt);
    }
}
