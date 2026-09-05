// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StemNFT} from "../src/core/StemNFT.sol";
import {ContentProtection} from "../src/core/ContentProtection.sol";
import {CurationRewards} from "../src/core/CurationRewards.sol";
import {RevenueEscrow} from "../src/core/RevenueEscrow.sol";
import {ShowCampaignEscrow} from "../src/core/ShowCampaignEscrow.sol";
import {StemMarketplaceV2} from "../src/core/StemMarketplaceV2.sol";
import {PaymentAssetRegistry} from "../src/payments/PaymentAssetRegistry.sol";
import {MockUSDC} from "../src/payments/MockUSDC.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DeploymentKey} from "./DeploymentKey.s.sol";

interface IEIP712DomainView {
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

interface IFailedPaymentRecovery {
    function claimFailedPayment(address token) external;
}

contract GlamsterdamRecoveringReceiver {
    bool public reject = true;

    function setReject(bool value) external {
        reject = value;
    }

    function claim(address target) external {
        IFailedPaymentRecovery(target).claimFailedPayment(address(0));
    }

    receive() external payable {
        if (reject) revert("characterization receiver rejected payment");
    }
}

/// @notice Broadcasts representative state-creating protocol lifecycles against
///         an already-deployed Glamsterdam characterization network.
/// @dev This is local/devnet evidence tooling, not a production deployment path.
///      Private keys are accepted only through the environment and must never be
///      copied into retained evidence or committed broadcast artifacts.
contract GlamsterdamRuntime is Script, DeploymentKey {
    bytes32 private constant ATTESTATION_AUTHORIZATION_TYPEHASH =
        keccak256("AttestationAuthorization(address attester,uint256 tokenId,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NATIVE_ASSET_ID = keccak256("base-sepolia:eth");

    uint256 private constant RELEASE_ID = 10_001;
    uint256 private constant TRACK_ID = 10_002;
    uint256 private constant STEM_PROTECTION_ID = 10_003;
    uint256 private constant ATTESTATION_DEADLINE = type(uint256).max;
    uint256 private constant STAKE_AMOUNT = 0.005 ether;
    uint256 private constant COUNTER_STAKE = 0.001 ether;
    uint256 private constant USDC = 1e6;

    function run() external {
        uint256 deployerKey = _deploymentPrivateKey();
        uint256 participantKey = vm.envUint("GLAMSTERDAM_PARTICIPANT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address participant = vm.addr(participantKey);
        require(participant != deployer, "participant must differ from deployer");

        StemNFT stemNFT = StemNFT(vm.envAddress("GLAMSTERDAM_STEM_NFT"));
        ContentProtection protection = ContentProtection(payable(vm.envAddress("GLAMSTERDAM_CONTENT_PROTECTION")));
        CurationRewards curation = CurationRewards(vm.envAddress("GLAMSTERDAM_CURATION_REWARDS"));
        RevenueEscrow revenueEscrow = RevenueEscrow(payable(vm.envAddress("GLAMSTERDAM_REVENUE_ESCROW")));
        StemMarketplaceV2 marketplace = StemMarketplaceV2(payable(vm.envAddress("GLAMSTERDAM_STEM_MARKETPLACE")));
        PaymentAssetRegistry registry = PaymentAssetRegistry(vm.envAddress("GLAMSTERDAM_PAYMENT_ASSET_REGISTRY"));

        bytes memory releaseVoucher = _attestationVoucher(protection, deployerKey, deployer, RELEASE_ID);
        bytes memory trackVoucher = _attestationVoucher(protection, deployerKey, deployer, TRACK_ID);

        vm.startBroadcast(deployerKey);

        (bool funded,) = payable(participant).call{value: 2 ether}("");
        require(funded, "participant funding failed");

        protection.attestRelease(
            RELEASE_ID,
            keccak256("glamsterdam-release"),
            keccak256("glamsterdam-release-fingerprint"),
            "ipfs://glamsterdam-release",
            ATTESTATION_DEADLINE,
            releaseVoucher
        );
        protection.attest(
            TRACK_ID,
            keccak256("glamsterdam-track"),
            keccak256("glamsterdam-track-fingerprint"),
            "ipfs://glamsterdam-track",
            ATTESTATION_DEADLINE,
            trackVoucher
        );
        protection.stakeForRelease{value: STAKE_AMOUNT}(RELEASE_ID);
        protection.registerTrack(RELEASE_ID, TRACK_ID);
        protection.registerStem(TRACK_ID, STEM_PROTECTION_ID);

        uint256[] memory noParents = new uint256[](0);
        uint256 originalId = stemNFT.mint(deployer, 10, "ipfs://glamsterdam-original", deployer, 500, true, noParents);
        stemNFT.mintMore(deployer, originalId, 2);
        uint256[] memory parents = new uint256[](1);
        parents[0] = originalId;
        stemNFT.mint(deployer, 4, "ipfs://glamsterdam-remix", deployer, 500, true, parents);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(originalId, 10, 0.001 ether, address(0), 7 days);

        revenueEscrow.setDefaultEscrowPeriod(0);
        revenueEscrow.deposit{value: 0.5 ether}(originalId, deployer);
        revenueEscrow.deposit{value: 0.25 ether}(originalId, deployer);
        revenueEscrow.release(originalId);

        registry.configureAsset(NATIVE_ASSET_ID, address(0), "ETH", 18, true, false);

        (ShowCampaignEscrow campaign, MockUSDC paymentToken, uint256 campaignId) =
            _deployCampaignFixture(deployer, participant);

        vm.stopBroadcast();

        vm.startBroadcast(participantKey);
        marketplace.buy{value: 0.002 ether}(listingId, 2);
        curation.reportContent{value: COUNTER_STAKE}(RELEASE_ID, "ipfs://glamsterdam-report");
        paymentToken.approve(address(campaign), type(uint256).max);
        campaign.pledge(campaignId, 1000 * USDC);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        protection.revokeRelease(RELEASE_ID);
        vm.stopBroadcast();

        require(stemNFT.balanceOf(participant, originalId) == 2, "marketplace purchase failed");
        require(curation.counterStakes(1) == COUNTER_STAKE, "curation report failed");
        require(uint8(campaign.campaignStatus(campaignId)) == 2, "campaign did not reach funded state");

        console.log("Glamsterdam runtime characterization completed");
        console.log("Original stem:", originalId);
        console.log("Marketplace listing:", listingId);
        console.log("Campaign:", campaignId);
    }

    function runRecovery() external {
        uint256 deployerKey = _deploymentPrivateKey();
        uint256 participantKey = vm.envUint("GLAMSTERDAM_PARTICIPANT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address participant = vm.addr(participantKey);

        StemNFT stemNFT = StemNFT(vm.envAddress("GLAMSTERDAM_STEM_NFT"));
        ContentProtection protection = ContentProtection(payable(vm.envAddress("GLAMSTERDAM_CONTENT_PROTECTION")));
        RevenueEscrow revenueEscrow = RevenueEscrow(payable(vm.envAddress("GLAMSTERDAM_REVENUE_ESCROW")));
        StemMarketplaceV2 marketplace = StemMarketplaceV2(payable(vm.envAddress("GLAMSTERDAM_STEM_MARKETPLACE")));

        uint256 refundId = 20_001;
        uint256 slashId = 20_002;
        bytes memory refundVoucher = _attestationVoucher(protection, deployerKey, deployer, refundId);
        bytes memory slashVoucher = _attestationVoucher(protection, deployerKey, deployer, slashId);

        vm.startBroadcast(deployerKey);
        GlamsterdamRecoveringReceiver receiver = new GlamsterdamRecoveringReceiver();
        _attest(protection, refundId, "refund", refundVoucher);
        protection.stake{value: STAKE_AMOUNT}(refundId);
        _attest(protection, slashId, "slash", slashVoucher);
        protection.stake{value: STAKE_AMOUNT}(slashId);

        uint256[] memory noParents = new uint256[](0);
        uint256 tokenId =
            stemNFT.mint(deployer, 2, "ipfs://glamsterdam-recovery", address(receiver), 500, true, noParents);
        stemNFT.setApprovalForAll(address(marketplace), true);
        uint256 listingId = marketplace.list(tokenId, 2, 0.001 ether, address(0), 7 days);

        revenueEscrow.deposit{value: 0.25 ether}(20_003, address(receiver));
        revenueEscrow.release(20_003);
        vm.stopBroadcast();

        vm.startBroadcast(participantKey);
        marketplace.buy{value: 0.002 ether}(listingId, 2);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        protection.refundStake(refundId);
        protection.slash(slashId, participant);
        receiver.setReject(false);
        receiver.claim(address(marketplace));
        receiver.claim(address(revenueEscrow));
        vm.stopBroadcast();

        require(marketplace.failedPayments(address(0), address(receiver)) == 0, "marketplace recovery failed");
        require(revenueEscrow.failedPayments(address(0), address(receiver)) == 0, "escrow recovery failed");
        require(stemNFT.balanceOf(participant, tokenId) == 2, "full purchase failed");
        console.log("Glamsterdam recovery characterization completed");
        console.log("Recovery receiver:", address(receiver));
        console.log("Recovery stem:", tokenId);
    }

    function runAssetEscrow() external {
        uint256 deployerKey = _deploymentPrivateKey();
        address deployer = vm.addr(deployerKey);
        address participant = vm.addr(vm.envUint("GLAMSTERDAM_PARTICIPANT_PRIVATE_KEY"));
        RevenueEscrow revenueEscrow = RevenueEscrow(payable(vm.envAddress("GLAMSTERDAM_REVENUE_ESCROW")));
        MockUSDC paymentToken = MockUSDC(vm.envAddress("GLAMSTERDAM_PAYMENT_TOKEN"));
        uint256 tokenId = 30_001;

        vm.startBroadcast(deployerKey);
        paymentToken.mint(deployer, 200 * USDC);
        paymentToken.approve(address(revenueEscrow), type(uint256).max);
        revenueEscrow.deposit{value: 0.1 ether}(tokenId, participant);
        revenueEscrow.depositWithAsset(tokenId, participant, address(paymentToken), 100 * USDC);
        revenueEscrow.freezeAsset(tokenId, address(paymentToken));
        revenueEscrow.redirectAsset(tokenId, address(paymentToken), deployer);
        revenueEscrow.release(tokenId);
        vm.stopBroadcast();

        require(paymentToken.balanceOf(deployer) == 200 * USDC, "asset redirect failed");
        require(revenueEscrow.getEscrowAssets(tokenId).length == 2, "multi-asset tracking failed");
        console.log("Glamsterdam multi-asset escrow characterization completed");
        console.log("Escrow token id:", tokenId);
    }

    function _deployCampaignFixture(address deployer, address participant)
        private
        returns (ShowCampaignEscrow campaign, MockUSDC paymentToken, uint256 campaignId)
    {
        paymentToken = new MockUSDC();
        ShowCampaignEscrow implementation = new ShowCampaignEscrow();
        bytes memory initialization =
            abi.encodeCall(ShowCampaignEscrow.initializeFresh, (deployer, 0, deployer, address(0xA0A0), 1 days));
        campaign = ShowCampaignEscrow(address(new ERC1967Proxy(address(implementation), initialization)));
        paymentToken.mint(participant, 1000 * USDC);
        campaignId = campaign.createCampaign(
            keccak256("glamsterdam-artist"),
            keccak256("glamsterdam-authority"),
            deployer,
            address(paymentToken),
            1000 * USDC,
            1,
            block.timestamp + 2 days,
            block.timestamp + 4 days,
            0,
            1 hours
        );
        campaign.activateCampaign(campaignId);
    }

    function _attest(ContentProtection protection, uint256 tokenId, string memory label, bytes memory voucher) private {
        protection.attest(
            tokenId,
            keccak256(bytes(label)),
            keccak256(abi.encodePacked(label, "-fingerprint")),
            string.concat("ipfs://glamsterdam-", label),
            ATTESTATION_DEADLINE,
            voucher
        );
    }

    function _attestationVoucher(ContentProtection protection, uint256 registrarKey, address attester, uint256 tokenId)
        private
        view
        returns (bytes memory)
    {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            IEIP712DomainView(address(protection)).eip712Domain();
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_AUTHORIZATION_TYPEHASH, attester, tokenId, ATTESTATION_DEADLINE));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(registrarKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
