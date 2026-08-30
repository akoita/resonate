// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IEntryPoint} from "I4337/interfaces/IEntryPoint.sol";
import {IKernel} from "../../lib/kernel-v3/src/interfaces/IKernel.sol";
import {IKernelValidator} from "../../lib/kernel-v3/src/interfaces/IKernelValidator.sol";
import {Kernel} from "../../lib/kernel-v3/src/Kernel.sol";
import {TestValidator} from "../../lib/kernel-v3/src/mock/TestValidator.sol";
import {KernelFactory} from "../../src/aa/KernelFactory.sol";
import {ContentProtection} from "../../src/core/ContentProtection.sol";
import {CurationRewards} from "../../src/core/CurationRewards.sol";
import {DisputeResolution} from "../../src/core/DisputeResolution.sol";
import {RevenueEscrow} from "../../src/core/RevenueEscrow.sol";
import {ShowCampaignEscrow} from "../../src/core/ShowCampaignEscrow.sol";
import {IShowCampaignEscrow} from "../../src/interfaces/IShowCampaignEscrow.sol";
import {StemMarketplaceV2} from "../../src/core/StemMarketplaceV2.sol";
import {StemNFT} from "../../src/core/StemNFT.sol";
import {TransferValidator} from "../../src/modules/TransferValidator.sol";
import {PaymentAssetRegistry} from "../../src/payments/PaymentAssetRegistry.sol";
import {MockUSDC} from "../../src/payments/MockUSDC.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AttestationVoucher} from "../utils/AttestationVoucher.sol";
import {EscrowProxyDeployer} from "../utils/EscrowProxyDeployer.sol";
import {RevenueEscrowProxyDeployer} from "../utils/RevenueEscrowProxyDeployer.sol";
import {StemMarketplaceProxyDeployer} from "../utils/StemMarketplaceProxyDeployer.sol";
import {MockContentProtectionMarketplace} from "../mocks/MockContentProtectionMarketplace.sol";
import {RevertingReceiver} from "../mocks/RevertingReceiver.sol";

/// @title Glamsterdam repricing characterization harness
/// @notice Representative cold/repeat lifecycle transitions for the storage-heavy
///         and custody-sensitive protocol flows most likely to be affected by an
///         EVM repricing. The suite deliberately records observations instead of
///         asserting today's gas numbers, so it remains useful across compiler and
///         fork changes.
/// @dev This is local characterization only. It never broadcasts transactions or
///      reads a live RPC. Use the companion evidence tooling to retain sanitized
///      receipt/estimate observations from an explicitly approved environment.
contract GlamsterdamRepricingTest is Test {
    uint256 internal constant REGISTRAR_PK = 0xA11CE;
    uint256 internal constant AUTH_DEADLINE = type(uint256).max;
    uint256 internal constant STAKE_AMOUNT = 0.01 ether;
    uint256 internal constant COUNTER_STAKE = 0.002 ether;
    uint256 internal constant ESCROW_PERIOD = 30 days;
    uint256 internal constant USDC = 1e6;

    address internal constant ARTIST = address(0xA11CE);
    address internal constant REPORTER = address(0xB0B);
    address internal constant BENEFICIARY = address(0xCAFE);
    address internal constant FEE_RECIPIENT = address(0xFEE);
    address internal constant UPGRADE_AUTHORITY = address(0xA0A0);
    address internal constant CONFIRMER = address(0xC0DE);

    function test_Glamsterdam_KernelFactoryCreate2AndInitialization() public {
        Kernel implementation = new Kernel(IEntryPoint(address(0)));
        TestValidator validator = new TestValidator();
        KernelFactory factory = new KernelFactory(address(implementation));
        bytes memory initialization =
            abi.encodeCall(IKernel.initialize, (IKernelValidator(address(validator)), abi.encodePacked(address(this))));
        bytes32 salt = keccak256("glamsterdam-kernel");

        address predicted = factory.getAddress(initialization, salt);
        uint256 gasBefore = gasleft();
        address account = factory.createAccount(initialization, salt);
        emit log_named_uint("kernelFactory.create2.initialization.cold", gasBefore - gasleft());

        assertEq(account, predicted, "CREATE2 address must match prediction");
        assertGt(account.code.length, 0, "account proxy must be deployed");
        assertEq(
            address(IKernel(account).getDefaultValidator()), address(validator), "initialization must persist validator"
        );

        gasBefore = gasleft();
        address repeated = factory.createAccount(initialization, salt);
        emit log_named_uint("kernelFactory.create2.initialization.repeat", gasBefore - gasleft());
        assertEq(repeated, account, "repeat creation must return the existing account");
    }

    function test_Glamsterdam_StemMintRemixAndRepeatStorage() public {
        StemNFT stemNFT = new StemNFT("ipfs://stems/");
        uint256[] memory noParents = new uint256[](0);

        uint256 gasBefore = gasleft();
        uint256 originalId = stemNFT.mint(ARTIST, 10, "ipfs://original", address(this), 500, true, noParents);
        emit log_named_uint("stemNFT.mint.original.cold", gasBefore - gasleft());
        assertEq(stemNFT.balanceOf(ARTIST, originalId), 10);

        gasBefore = gasleft();
        stemNFT.mintMore(ARTIST, originalId, 2);
        emit log_named_uint("stemNFT.mintMore.repeat", gasBefore - gasleft());
        assertEq(stemNFT.balanceOf(ARTIST, originalId), 12);

        uint256[] memory parents = new uint256[](1);
        parents[0] = originalId;
        gasBefore = gasleft();
        uint256 remixId = stemNFT.mint(ARTIST, 4, "ipfs://remix", address(this), 500, true, parents);
        emit log_named_uint("stemNFT.mint.remix.storage-growth", gasBefore - gasleft());
        assertTrue(stemNFT.isRemix(remixId), "remix lineage must be recorded");
        assertEq(stemNFT.getParentIds(remixId)[0], originalId);
    }

    function test_Glamsterdam_ContentProtectionRegistrationAndRevokeVariants() public {
        ContentProtection protection = _deployContentProtection();
        _attest(protection, 100, "release");

        // A small release exercises the bounded whole-array revoke path.
        uint256 gasBefore;
        for (uint256 i = 0; i < 3; ++i) {
            uint256 trackId = 200 + i;
            _attest(protection, trackId, "track");
            gasBefore = gasleft();
            protection.registerTrack(100, trackId);
            emit log_named_uint("contentProtection.registerTrack.cold", gasBefore - gasleft());

            gasBefore = gasleft();
            protection.registerTrack(100, trackId);
            emit log_named_uint("contentProtection.registerTrack.repeat", gasBefore - gasleft());
        }

        gasBefore = gasleft();
        protection.registerStem(200, 300);
        emit log_named_uint("contentProtection.registerStem.cold", gasBefore - gasleft());
        gasBefore = gasleft();
        protection.registerStem(200, 300);
        emit log_named_uint("contentProtection.registerStem.repeat", gasBefore - gasleft());
        assertEq(protection.getTrackStemCount(200), 1);

        gasBefore = gasleft();
        protection.revokeRelease(100);
        emit log_named_uint("contentProtection.revokeRelease.whole-array", gasBefore - gasleft());
        assertFalse(protection.isReleaseVerified(100));
        assertFalse(protection.isTrackVerified(200));
        assertFalse(protection.isTrackVerified(202));

        // A second release is revoked in bounded pages to characterize the
        // paginated distinction without constructing an unbounded fixture.
        _attest(protection, 110, "release");
        for (uint256 i = 0; i < 3; ++i) {
            uint256 trackId = 210 + i;
            _attest(protection, trackId, "track");
            protection.registerTrack(110, trackId);
        }

        gasBefore = gasleft();
        protection.revokeReleaseBatch(110, 0, 2);
        emit log_named_uint("contentProtection.revokeRelease.paginated.page-0", gasBefore - gasleft());
        assertFalse(protection.isReleaseVerified(110));
        assertFalse(protection.isAttested(210));
        assertFalse(protection.isAttested(211));
        assertTrue(protection.isAttested(212));

        gasBefore = gasleft();
        protection.revokeReleaseBatch(110, 2, 2);
        emit log_named_uint("contentProtection.revokeRelease.paginated.page-1", gasBefore - gasleft());
        assertFalse(protection.isAttested(212));
    }

    function test_Glamsterdam_StemMarketplaceListPartialAndFullPurchase() public {
        StemNFT stemNFT = new StemNFT("ipfs://stems/");
        MockContentProtectionMarketplace protection = new MockContentProtectionMarketplace();
        PaymentAssetRegistry registry = new PaymentAssetRegistry(address(this));
        registry.configureAsset(keccak256("local:eth"), address(0), "ETH", 18, true, false);
        StemMarketplaceV2 marketplace = StemMarketplaceProxyDeployer.deploy(
            address(stemNFT),
            address(protection),
            address(registry),
            FEE_RECIPIENT,
            250,
            address(this),
            UPGRADE_AUTHORITY
        );

        TransferValidator validator = new TransferValidator();
        stemNFT.setTransferValidator(address(validator));
        validator.setWhitelist(address(marketplace), true);

        uint256[] memory noParents = new uint256[](0);
        uint256 tokenId = stemNFT.mint(ARTIST, 10, "ipfs://market", ARTIST, 500, true, noParents);
        vm.prank(ARTIST);
        stemNFT.setApprovalForAll(address(marketplace), true);
        vm.deal(REPORTER, 20 ether);

        vm.prank(ARTIST);
        uint256 gasBefore = gasleft();
        uint256 listingId = marketplace.list(tokenId, 10, 1 ether, address(0), 7 days);
        emit log_named_uint("stemMarketplace.list.cold", gasBefore - gasleft());

        vm.prank(REPORTER);
        gasBefore = gasleft();
        marketplace.buy{value: 2 ether}(listingId, 2);
        emit log_named_uint("stemMarketplace.buy.partial.cold", gasBefore - gasleft());
        assertEq(stemNFT.balanceOf(REPORTER, tokenId), 2);
        assertEq(marketplace.getListing(listingId).amount, 8);

        vm.prank(REPORTER);
        gasBefore = gasleft();
        marketplace.buy{value: 8 ether}(listingId, 8);
        emit log_named_uint("stemMarketplace.buy.full.repeat-delete", gasBefore - gasleft());
        assertEq(stemNFT.balanceOf(REPORTER, tokenId), 10);
        assertEq(marketplace.getListing(listingId).seller, address(0));
    }

    function test_Glamsterdam_RevenueEscrowDepositReleaseAndRepeat() public {
        RevenueEscrow escrow = RevenueEscrowProxyDeployer.deploy(address(this), ESCROW_PERIOD, UPGRADE_AUTHORITY);
        vm.deal(address(this), 2 ether);

        uint256 gasBefore = gasleft();
        escrow.deposit{value: 0.5 ether}(1, BENEFICIARY);
        emit log_named_uint("revenueEscrow.deposit.cold", gasBefore - gasleft());

        gasBefore = gasleft();
        escrow.deposit{value: 0.25 ether}(1, BENEFICIARY);
        emit log_named_uint("revenueEscrow.deposit.repeat", gasBefore - gasleft());
        (, uint256 balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0.75 ether);

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        uint256 beneficiaryBefore = BENEFICIARY.balance;
        gasBefore = gasleft();
        escrow.release(1);
        emit log_named_uint("revenueEscrow.release.permissionless", gasBefore - gasleft());
        assertEq(BENEFICIARY.balance - beneficiaryBefore, 0.75 ether);
        (, balance,,) = escrow.getEscrow(1);
        assertEq(balance, 0);
    }

    function test_Glamsterdam_RevenueEscrowFailedPayoutRecovery() public {
        RevenueEscrow escrow = RevenueEscrowProxyDeployer.deploy(address(this), ESCROW_PERIOD, UPGRADE_AUTHORITY);
        RevertingReceiver receiver = new RevertingReceiver();
        vm.deal(address(this), 1 ether);
        escrow.deposit{value: 0.5 ether}(2, address(receiver));

        vm.warp(block.timestamp + ESCROW_PERIOD + 1);
        uint256 gasBefore = gasleft();
        escrow.release(2);
        emit log_named_uint("revenueEscrow.release.failed-payout", gasBefore - gasleft());
        assertEq(escrow.failedPayments(address(0), address(receiver)), 0.5 ether);

        receiver.setReject(false);
        uint256 receiverBefore = address(receiver).balance;
        vm.prank(address(receiver));
        gasBefore = gasleft();
        escrow.claimFailedPayment(address(0));
        emit log_named_uint("revenueEscrow.recovery.claim", gasBefore - gasleft());
        assertEq(address(receiver).balance - receiverBefore, 0.5 ether);
        assertEq(escrow.failedPayments(address(0), address(receiver)), 0);
    }

    function test_Glamsterdam_ShowCampaignCreatePledgeAndRelease() public {
        (ShowCampaignEscrow escrow, MockUSDC paymentToken) = _deployCampaignEscrow();
        uint256 campaignId = _createCampaign(escrow, paymentToken, 2 days, 4 days);
        escrow.activateCampaign(campaignId);

        vm.prank(ARTIST);
        uint256 gasBefore = gasleft();
        escrow.pledge(campaignId, 400 * USDC);
        emit log_named_uint("showCampaign.pledge.first", gasBefore - gasleft());

        vm.prank(ARTIST);
        gasBefore = gasleft();
        escrow.pledge(campaignId, 100 * USDC);
        emit log_named_uint("showCampaign.pledge.repeat", gasBefore - gasleft());

        vm.prank(REPORTER);
        gasBefore = gasleft();
        escrow.pledge(campaignId, 500 * USDC);
        emit log_named_uint("showCampaign.pledge.funded", gasBefore - gasleft());
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(IShowCampaignEscrow.CampaignStatus.Funded));

        vm.prank(CONFIRMER);
        gasBefore = gasleft();
        escrow.confirmBooking(campaignId);
        emit log_named_uint("showCampaign.confirmBooking", gasBefore - gasleft());

        vm.prank(CONFIRMER);
        gasBefore = gasleft();
        escrow.confirmFulfillment(campaignId);
        emit log_named_uint("showCampaign.confirmFulfillment", gasBefore - gasleft());

        vm.warp(block.timestamp + 1 hours + 1);
        uint256 artistBefore = paymentToken.balanceOf(BENEFICIARY);
        gasBefore = gasleft();
        escrow.releaseFunds(campaignId);
        emit log_named_uint("showCampaign.release.final", gasBefore - gasleft());
        assertEq(paymentToken.balanceOf(BENEFICIARY) - artistBefore, 1000 * USDC);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(IShowCampaignEscrow.CampaignStatus.Released));
    }

    function test_Glamsterdam_ShowCampaignMissedDeadlineRefund() public {
        (ShowCampaignEscrow escrow, MockUSDC paymentToken) = _deployCampaignEscrow();
        uint256 campaignId = _createCampaign(escrow, paymentToken, 1 days, 2 days);
        escrow.activateCampaign(campaignId);

        vm.prank(ARTIST);
        uint256 gasBefore = gasleft();
        escrow.pledge(campaignId, 100 * USDC);
        emit log_named_uint("showCampaign.refund.pledge-first", gasBefore - gasleft());
        vm.prank(REPORTER);
        gasBefore = gasleft();
        escrow.pledge(campaignId, 100 * USDC);
        emit log_named_uint("showCampaign.refund.pledge-repeat", gasBefore - gasleft());

        vm.warp(block.timestamp + 1 days + 1);
        gasBefore = gasleft();
        escrow.markFailed(campaignId);
        emit log_named_uint("showCampaign.refund.open", gasBefore - gasleft());

        vm.prank(ARTIST);
        gasBefore = gasleft();
        escrow.claimRefund(campaignId);
        emit log_named_uint("showCampaign.refund.claim-first", gasBefore - gasleft());
        vm.prank(REPORTER);
        gasBefore = gasleft();
        escrow.claimRefund(campaignId);
        emit log_named_uint("showCampaign.refund.claim-repeat", gasBefore - gasleft());

        assertEq(paymentToken.balanceOf(ARTIST), 2000 * USDC);
        assertEq(paymentToken.balanceOf(REPORTER), 2000 * USDC);
        assertEq(uint8(escrow.campaignStatus(campaignId)), uint8(IShowCampaignEscrow.CampaignStatus.Refunded));
    }

    function test_Glamsterdam_RegistryDisputeAndCurationStorageGrowth() public {
        PaymentAssetRegistry registry = new PaymentAssetRegistry(address(this));
        MockUSDC paymentToken = new MockUSDC();
        bytes32 assetId = keccak256("local:usdc");

        uint256 gasBefore = gasleft();
        registry.configureAsset(assetId, address(paymentToken), "USDC", 6, true, true);
        emit log_named_uint("paymentAssetRegistry.configure.cold", gasBefore - gasleft());
        gasBefore = gasleft();
        registry.configureAsset(assetId, address(paymentToken), "USDC", 6, true, true);
        emit log_named_uint("paymentAssetRegistry.configure.repeat", gasBefore - gasleft());
        assertTrue(registry.isTokenEnabled(address(paymentToken)));

        DisputeResolution disputes = new DisputeResolution(address(this));
        gasBefore = gasleft();
        uint256 firstDispute = disputes.fileDispute(1, REPORTER, ARTIST, "ipfs://evidence-1");
        emit log_named_uint("disputeResolution.file.cold", gasBefore - gasleft());
        gasBefore = gasleft();
        uint256 secondDispute = disputes.fileDispute(2, REPORTER, ARTIST, "ipfs://evidence-2");
        emit log_named_uint("disputeResolution.file.repeat", gasBefore - gasleft());
        assertEq(firstDispute, 1);
        assertEq(secondDispute, 2);
        assertEq(disputes.disputeCount(), 2);

        ContentProtection protection = _deployContentProtection();
        _attestAs(protection, ARTIST, 1, "audio-1");
        _attestAs(protection, ARTIST, 2, "audio-2");
        vm.deal(ARTIST, 1 ether);
        vm.prank(ARTIST);
        protection.stake{value: STAKE_AMOUNT}(1);
        vm.prank(ARTIST);
        protection.stake{value: STAKE_AMOUNT}(2);

        CurationRewards curation = new CurationRewards(
            address(this), address(protection), address(new DisputeResolution(address(this))), BENEFICIARY
        );
        vm.deal(REPORTER, 1 ether);
        vm.prank(REPORTER);
        gasBefore = gasleft();
        uint256 firstReport = curation.reportContent{value: COUNTER_STAKE}(1, "ipfs://report-1");
        emit log_named_uint("curationRewards.report.cold", gasBefore - gasleft());
        vm.prank(REPORTER);
        gasBefore = gasleft();
        uint256 secondReport = curation.reportContent{value: COUNTER_STAKE}(2, "ipfs://report-2");
        emit log_named_uint("curationRewards.report.repeat", gasBefore - gasleft());
        assertEq(firstReport, 1);
        assertEq(secondReport, 2);
        assertEq(curation.counterStakes(firstReport), COUNTER_STAKE);
        assertEq(curation.counterStakes(secondReport), COUNTER_STAKE);
    }

    function _deployContentProtection() internal returns (ContentProtection protection) {
        ContentProtection implementation = new ContentProtection();
        bytes memory initialization = abi.encodeCall(
            ContentProtection.initializeFresh, (address(this), BENEFICIARY, STAKE_AMOUNT, UPGRADE_AUTHORITY)
        );
        protection = ContentProtection(address(new ERC1967Proxy(address(implementation), initialization)));
        protection.setRegistrar(vm.addr(REGISTRAR_PK), true);
    }

    function _attest(ContentProtection protection, uint256 tokenId, string memory label) internal {
        _attestAs(protection, address(this), tokenId, label);
    }

    function _attestAs(ContentProtection protection, address attester, uint256 tokenId, string memory label) internal {
        bytes memory voucher =
            AttestationVoucher.sign(address(protection), REGISTRAR_PK, attester, tokenId, AUTH_DEADLINE);
        vm.prank(attester);
        protection.attest(
            tokenId,
            keccak256(bytes(label)),
            keccak256(abi.encodePacked(label, ":fingerprint")),
            string.concat("ipfs://", label),
            AUTH_DEADLINE,
            voucher
        );
    }

    function _deployCampaignEscrow() internal returns (ShowCampaignEscrow escrow, MockUSDC paymentToken) {
        paymentToken = new MockUSDC();
        escrow = EscrowProxyDeployer.deploy(address(this), 0, FEE_RECIPIENT, UPGRADE_AUTHORITY);
        escrow.setConfirmer(CONFIRMER, true);
        paymentToken.mint(ARTIST, 2000 * USDC);
        paymentToken.mint(REPORTER, 2000 * USDC);
        vm.prank(ARTIST);
        paymentToken.approve(address(escrow), type(uint256).max);
        vm.prank(REPORTER);
        paymentToken.approve(address(escrow), type(uint256).max);
    }

    function _createCampaign(
        ShowCampaignEscrow escrow,
        MockUSDC paymentToken,
        uint256 deadlineOffset,
        uint256 bookingOffset
    ) internal returns (uint256 campaignId) {
        uint256 deadline = block.timestamp + deadlineOffset;
        uint256 bookingDeadline = block.timestamp + bookingOffset;
        uint256 gasBefore = gasleft();
        campaignId = escrow.createCampaign(
            keccak256("artist"),
            keccak256("authority"),
            BENEFICIARY,
            address(paymentToken),
            1000 * USDC,
            2,
            deadline,
            bookingDeadline,
            0,
            1 hours
        );
        emit log_named_uint("showCampaign.create.cold", gasBefore - gasleft());
    }
}
