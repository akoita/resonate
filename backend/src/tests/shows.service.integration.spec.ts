import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";

const TEST_PREFIX = `shows_service_${Date.now()}_`;
const userId = `${TEST_PREFIX}artist_user`;
const listenerId = `${TEST_PREFIX}listener_user`;
const artistId = `${TEST_PREFIX}artist`;
const creditedArtistId = `${TEST_PREFIX}credited_artist`;
const releaseId = `${TEST_PREFIX}release`;
const creditedReleaseId = `${TEST_PREFIX}credited_release`;
const artistWallet = "0x" + "7".repeat(40);
const otherArtistUserId = `${TEST_PREFIX}other_artist_user`;
const otherArtistId = `${TEST_PREFIX}other_artist`;
const operatorUserId = `${TEST_PREFIX}operator`;
const ANVIL_CHAIN_ID = 31337;
const ANVIL_DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SHOW_ESCROW_ARTIFACT =
  require("../../../contracts/out/ShowCampaignEscrow.sol/ShowCampaignEscrow.json") as {
    abi: any[];
    bytecode: { object: `0x${string}` };
  };

const futureIso = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const anvilUrl = () => process.env.ANVIL_RPC_URL;

const visualFile = (name: string, body: string): Express.Multer.File => ({
  fieldname: "gallery",
  originalname: `${name}.webp`,
  encoding: "7bit",
  mimetype: "image/webp",
  size: Buffer.byteLength(body),
  buffer: Buffer.from(body),
  destination: "",
  filename: `${name}.webp`,
  path: "",
  stream: null as any,
});

describe("ShowsService integration", () => {
  const visualUploads = new Map<string, { data: Buffer; mimeType: string }>();
  const visualStorageProvider = {
    async upload(data: Buffer, filename: string, mimeType: string) {
      const uri = `memory://${filename}`;
      visualUploads.set(uri, { data, mimeType });
      return { uri, provider: "local" as const };
    },
    async download(uri: string) {
      return visualUploads.get(uri)?.data ?? null;
    },
    async delete(uri: string) {
      visualUploads.delete(uri);
    },
  };
  const service = new ShowsService(undefined, visualStorageProvider as any);
  const listenerWallet = "0x" + "8".repeat(40);
  const txHash = "0x" + "9".repeat(64);
  const refundTxHash = "0x" + "a".repeat(64);

  async function createActiveCampaignWithTier(city: string) {
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city,
        country: "FR",
        deadline: futureIso(30),
        goalAmountUnits: "3000000",
        minimumBackers: 100,
        bookingDeadline: futureIso(45),
      },
    );
    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}${city}-authority`,
      },
    );
    await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        authorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}${city}-credential`,
      },
    );
    const activated = await service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        contractAddress: "0x" + "5".repeat(40),
        contractCampaignId: `${Date.now()}`,
      },
    );
    const tier = await prisma.showCampaignTier.create({
      data: {
        campaignId: campaign.id,
        title: "Fan Signal",
        amountUnits: "250000",
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        sortOrder: 1,
      },
    });
    return { campaign: activated, tier };
  }

  async function createFundedCampaign(city: string) {
    const { campaign, tier } = await createActiveCampaignWithTier(city);
    const funded = await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "funded",
        fundedAt: new Date(),
        raisedAmountUnits: "3000000",
        confirmedPledgeCount: 12,
        uniqueBackerCount: 12,
      },
    });
    return { campaign: funded, tier };
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${TEST_PREFIX}artist@test.resonate` },
        { id: listenerId, email: `${TEST_PREFIX}listener@test.resonate` },
        { id: operatorUserId, email: `${TEST_PREFIX}operator@test.resonate` },
        { id: otherArtistUserId, email: `${TEST_PREFIX}other_artist@test.resonate` },
      ],
    });
    // #1221: pledge intents bind to the caller's registered wallet.
    await prisma.wallet.create({
      data: { userId: listenerId, address: listenerWallet, chainId: 84532 },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: `${TEST_PREFIX}Artist`,
        payoutAddress: artistWallet,
      },
    });
    await prisma.artist.create({
      data: {
        id: otherArtistId,
        userId: otherArtistUserId,
        displayName: `${TEST_PREFIX}Other Artist`,
        payoutAddress: "0x" + "4".repeat(40),
      },
    });
    await prisma.artist.create({
      data: {
        id: creditedArtistId,
        userId: null,
        displayName: `${TEST_PREFIX}Declared Credit`,
        payoutAddress: null,
        profileType: "public_artist",
        claimStatus: "unclaimed",
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: `${TEST_PREFIX}Ready Release`,
        status: "ready",
        primaryArtist: `${TEST_PREFIX}Artist`,
      },
    });
    await prisma.release.create({
      data: {
        id: creditedReleaseId,
        artistId,
        title: `${TEST_PREFIX}Declared Credit Release`,
        status: "ready",
        primaryArtist: `${TEST_PREFIX}Declared Credit`,
        artistCredits: {
          create: {
            artistId: creditedArtistId,
            role: "main",
            displayName: `${TEST_PREFIX}Declared Credit`,
            sortOrder: 0,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.showCampaignEvent.deleteMany({
      where: {
        campaign: { artistDisplayName: { startsWith: TEST_PREFIX } },
      },
    }).catch(() => {});
    await prisma.showPledge.deleteMany({
      where: {
        campaign: { artistDisplayName: { startsWith: TEST_PREFIX } },
      },
    }).catch(() => {});
    await prisma.showCampaignTier.deleteMany({
      where: {
        campaign: { artistDisplayName: { startsWith: TEST_PREFIX } },
      },
    }).catch(() => {});
    await prisma.showCampaign.deleteMany({
      where: { artistDisplayName: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { in: [releaseId, creditedReleaseId] } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, otherArtistId, creditedArtistId] } } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: { in: [listenerId] } } }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [userId, listenerId, operatorUserId, otherArtistUserId] } },
    }).catch(() => {});
    await prisma.$disconnect();
  });

  it("lets authenticated fans create public demand signals without artist authority", async () => {
    const signal = await service.createSignal(
      { userId: listenerId, role: "listener" },
      {
        artistDisplayName: `${TEST_PREFIX}Signal Artist`,
        city: "Paris",
        country: "FR",
        deadline: futureIso(20),
        metadata: { source: "integration-test" },
      },
    );

    expect(signal.campaignLevel).toBe("signal");
    expect(signal.artistAuthorityStatus).toBe("none");
    expect(signal.goalAmountUnits).toBe("0");
    expect(signal.events[0].eventType).toBe("campaign_signal_created");
  });

  it("creates draft escrow campaigns only for artists or operators", async () => {
    await expect(service.createDraftCampaign(
      { userId: listenerId, role: "listener" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Montreal",
        country: "CA",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
      },
    )).rejects.toThrow();

    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: "Famous Impersonation Target",
        title: "Sennarin in Montreal",
        city: "Montreal",
        country: "CA",
        venueTarget: "MTELUS",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        minimumBackers: 250,
        bookingDeadline: futureIso(45),
        releasePolicy: "refund_only_until_booking",
        tiers: [
          {
            title: "Fan Signal",
            description: "Refundable proof of demand",
            amountUnits: "250000",
            paymentAssetSymbol: "USDC",
            paymentAssetDecimals: 6,
            sortOrder: 0,
          },
          {
            title: "Ticket Intent",
            amountUnits: "750000",
            paymentAssetSymbol: "USDC",
            paymentAssetDecimals: 6,
            sortOrder: 1,
          },
        ],
      },
    );

    expect(campaign.status).toBe("draft");
    expect(campaign.campaignLevel).toBe("active_escrow_campaign");
    expect(campaign.artistAuthorityStatus).toBe("none");
    expect(campaign.artistId).toBe(artistId);
    expect(campaign.artistDisplayName).toBe(`${TEST_PREFIX}Artist`);
    expect(campaign.title).toBe("Sennarin in Montreal");
    expect(campaign.slug).toBe("sennarin-in-montreal-ca");
    expect(campaign.beneficiaryAddress).toBe(artistWallet.toLowerCase());
    expect(campaign.beneficiaryType).toBe("wallet");
    expect(campaign.tiers).toHaveLength(2);
    expect(campaign.tiers[0].title).toBe("Fan Signal");

    const updated = await service.updateDraftCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        title: "Sennarin at Club Soda",
        city: "Montreal",
        country: "CA",
        venueTarget: "Club Soda",
        deadline: futureIso(40),
        goalAmountUnits: "3500000",
        minimumBackers: 300,
        bookingDeadline: futureIso(55),
        releasePolicy: "refund_only_until_booking",
        tiers: [
          {
            title: "Ticket Intent",
            amountUnits: "850000",
            paymentAssetSymbol: "USDC",
            paymentAssetDecimals: 6,
            sortOrder: 0,
          },
        ],
      },
    );

    expect(updated.venueTarget).toBe("Club Soda");
    expect(updated.title).toBe("Sennarin at Club Soda");
    expect(updated.goalAmountUnits).toBe("3500000");
    expect(updated.tiers).toHaveLength(1);
    expect(updated.tiers[0].amountUnits).toBe("850000");
    expect(updated.events[0].eventType).toBe("campaign_updated");

    const visualized = await service.uploadCampaignVisuals(
      { userId, role: "artist" },
      updated.id,
      {
        hero: {
          buffer: Buffer.from("hero-image"),
          mimetype: "image/webp",
          size: 10,
        } as Express.Multer.File,
        card: {
          buffer: Buffer.from("card-image"),
          mimetype: "image/png",
          size: 10,
        } as Express.Multer.File,
        gallery: [
          {
            buffer: Buffer.from("gallery-image"),
            mimetype: "image/jpeg",
            size: 13,
          } as Express.Multer.File,
        ],
      },
    );
    expect(visualized.heroImageUrl).toBe(`/shows/campaigns/${updated.id}/visuals/hero`);
    expect(visualized.cardImageUrl).toBe(`/shows/campaigns/${updated.id}/visuals/card`);
    expect(visualized.visuals.some((visual) => visual.role === "gallery")).toBe(true);
    const heroVisual = await service.getCampaignVisual(updated.id, "hero");
    expect(heroVisual?.mimeType).toBe("image/webp");
    expect(heroVisual?.data.toString()).toBe("hero-image");
    const galleryVisualRef = visualized.visuals.find((visual) => visual.role === "gallery")?.id;
    expect(galleryVisualRef).toBeTruthy();
    const galleryVisual = await service.getCampaignVisual(updated.id, galleryVisualRef!);
    expect(galleryVisual?.mimeType).toBe("image/jpeg");
    expect(galleryVisual?.data.toString()).toBe("gallery-image");

    await expect(service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId: otherArtistId,
        artistDisplayName: `${TEST_PREFIX}Other Artist`,
        city: "Toronto",
        country: "CA",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
      },
    )).rejects.toThrow("Campaign artist identity must be in your managed catalog");

    const managedCreditDraft = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId: creditedArtistId,
        artistDisplayName: "Ignored Manager Input",
        title: `${TEST_PREFIX}Declared Credit in Lyon`,
        city: "Lyon",
        country: "FR",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
      },
    );

    expect(managedCreditDraft.artistId).toBe(creditedArtistId);
    expect(managedCreditDraft.artistDisplayName).toBe(`${TEST_PREFIX}Declared Credit`);
    expect(managedCreditDraft.beneficiaryAddress).toBe(artistWallet.toLowerCase());

    const managedCreditAuthority = await service.requestAuthority(
      { userId, role: "artist" },
      managedCreditDraft.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}managed-credit-authority`,
      },
    );

    expect(managedCreditAuthority.artistAuthorityStatus).toBe("artist_acknowledged");
    expect(managedCreditAuthority.beneficiaryAddress).toBe(artistWallet.toLowerCase());

    await expect(service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Ottawa",
        country: "CA",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: "0x" + "1".repeat(40),
        beneficiaryType: "wallet",
      },
    )).rejects.toThrow("beneficiaryAddress must match");

    await expect(service.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        artistId: otherArtistId,
        artistDisplayName: `${TEST_PREFIX}Other Artist`,
        city: "Berlin",
        country: "DE",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: "0x" + "2".repeat(40),
        beneficiaryType: "wallet",
      },
    )).rejects.toThrow("at least one ready or published release credited to that artist");

    await expect(service.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        artistDisplayName: `${TEST_PREFIX}Off Platform Artist`,
        city: "Berlin",
        country: "DE",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: "0x" + "2".repeat(40),
        beneficiaryType: "wallet",
      },
    )).rejects.toThrow("active escrow campaigns must select a catalog artist");

    const operatorDraft = await service.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        artistId,
        artistDisplayName: "Ignored Operator Input",
        city: "Berlin",
        country: "DE",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: "0x" + "2".repeat(40),
        beneficiaryType: "wallet",
      },
    );

    expect(operatorDraft.artistId).toBe(artistId);
    expect(operatorDraft.artistDisplayName).toBe(`${TEST_PREFIX}Artist`);
    expect(operatorDraft.beneficiaryAddress).toBe("0x" + "2".repeat(40));

    const declaredCreditDraft = await service.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        artistId: null,
        artistDisplayName: `${TEST_PREFIX}Declared Credit`,
        title: `${TEST_PREFIX}Declared Credit in Paris`,
        city: "Paris",
        country: "FR",
        deadline: futureIso(30),
        goalAmountUnits: "2500000",
        beneficiaryAddress: "0x" + "3".repeat(40),
        beneficiaryType: "wallet",
      },
    );

    expect(declaredCreditDraft.artistId).toBeNull();
    expect(declaredCreditDraft.artistDisplayName).toBe(`${TEST_PREFIX}Declared Credit`);
    expect(declaredCreditDraft.title).toBe(`${TEST_PREFIX}Declared Credit in Paris`);
  });

  it("lets campaign owners replace, reorder, and delete draft gallery visuals", async () => {
    const draft = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Paris",
        country: "FR",
        deadline: futureIso(30),
        goalAmountUnits: "3000000",
        bookingDeadline: futureIso(45),
      },
    );

    const withVisuals = await service.uploadCampaignVisuals(
      { userId, role: "artist" },
      draft.id,
      {
        gallery: [
          visualFile("gallery-one", "first"),
          visualFile("gallery-two", "second"),
          visualFile("gallery-three", "third"),
        ],
      },
    );
    const gallery = withVisuals.visuals.filter((visual) => visual.role === "gallery");
    expect(gallery.map((visual) => visual.sortOrder)).toEqual([10, 11, 12]);

    const replaced = await service.replaceCampaignVisual(
      { userId, role: "artist" },
      draft.id,
      gallery[1].id,
      visualFile("gallery-two-replacement", "second-replaced"),
    );
    const replacedVisual = replaced.visuals.find((visual) => visual.id === gallery[1].id);
    expect(replacedVisual?.mimeType).toBe("image/webp");
    await expect(service.getCampaignVisual(draft.id, gallery[1].id)).resolves.toMatchObject({
      data: Buffer.from("second-replaced"),
      mimeType: "image/webp",
    });

    const reordered = await service.reorderCampaignVisuals(
      { userId, role: "artist" },
      draft.id,
      { visualIds: [gallery[2].id, gallery[0].id, gallery[1].id] },
    );
    expect(reordered.visuals.filter((visual) => visual.role === "gallery").map((visual) => visual.id)).toEqual([
      gallery[2].id,
      gallery[0].id,
      gallery[1].id,
    ]);

    const afterDelete = await service.deleteCampaignVisual(
      { userId, role: "artist" },
      draft.id,
      gallery[0].id,
    );
    expect(afterDelete.visuals.filter((visual) => visual.role === "gallery").map((visual) => visual.id)).toEqual([
      gallery[2].id,
      gallery[1].id,
    ]);

    await expect(service.reorderCampaignVisuals(
      { userId, role: "artist" },
      draft.id,
      { visualIds: [gallery[2].id] },
    )).rejects.toThrow(BadRequestException);
  });

  it("exposes campaign fee accounting and goal payout estimates", async () => {
    const { campaign } = await createActiveCampaignWithTier("Marseille");
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        feeBps: 600,
        totalReleasedUnits: "1000000",
        totalFeePaidUnits: "60000",
      },
    });

    const publicCampaign = await service.getCampaign(campaign.slug);
    expect(publicCampaign).toMatchObject({
      feeBps: 600,
      totalFeePaid: "60000",
      totalFeePaidUnits: "60000",
      campaignFeeBreakdown: {
        feeBps: 600,
        totalFeePaidUnits: "60000",
        grossReleasedUnits: "1000000",
        netReleasedToArtistUnits: "940000",
        estimatedFeeAtGoalUnits: "180000",
        estimatedNetToArtistAtGoalUnits: "2820000",
        feeChargedOnlyOnSuccessfulRelease: true,
        refundFeeUnits: "0",
      },
    });
  });

  it("requires approved artist authority before activation", async () => {
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Quebec City",
        country: "CA",
        deadline: futureIso(35),
        goalAmountUnits: "1500000",
        minimumBackers: 100,
        bookingDeadline: futureIso(50),
      },
    );

    await expect(service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {},
    )).rejects.toThrow(BadRequestException);

    const requested = await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}authority-evidence`,
        evidence: { method: "official_site_challenge" },
      },
    );

    expect(requested.artistAuthorityStatus).toBe("artist_acknowledged");
    expect(requested.beneficiaryAddress).toBe(artistWallet.toLowerCase());

    const approved = await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        authorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}authority-credential`,
      },
    );

    expect(approved.artistAuthorityStatus).toBe("artist_authorized");
    expect(approved.authorityCredentialId).toBe(`${TEST_PREFIX}authority-credential`);

    const activated = await service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        contractAddress: "0x" + "6".repeat(40),
        contractCampaignId: "1",
      },
    );

    expect(activated.status).toBe("active");
    expect(activated.contractCampaignId).toBe("1");
    const activationEvent = await prisma.showCampaignEvent.findFirst({
      where: { campaignId: campaign.id, eventType: "campaign_activated" },
      orderBy: { createdAt: "desc" },
    });
    expect(activationEvent).not.toBeNull();
  });

  it("hydrates linked escrow state directly from Anvil during activation", async () => {
    if (!anvilUrl()) {
      console.warn("ANVIL_RPC_URL not set. Skipping activation chain hydration integration test.");
      return;
    }

    const chain = { ...foundry, id: ANVIL_CHAIN_ID };
    const account = privateKeyToAccount(ANVIL_DEPLOYER_PRIVATE_KEY);
    const publicClient = createPublicClient({
      chain,
      transport: http(anvilUrl()),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(anvilUrl()),
    });
    const deployHash = await walletClient.deployContract({
      abi: SHOW_ESCROW_ARTIFACT.abi,
      bytecode: SHOW_ESCROW_ARTIFACT.bytecode.object,
      args: [account.address, 600n, account.address],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const escrowAddress = deployReceipt.contractAddress;
    expect(escrowAddress).toBeTruthy();

    const block = await publicClient.getBlock({ blockTag: "latest" });
    const deadline = block.timestamp + 7n * 24n * 60n * 60n;
    const bookingDeadline = deadline + 7n * 24n * 60n * 60n;
    const paymentToken = "0x" + "1".repeat(40);
    const createHash = await walletClient.writeContract({
      address: escrowAddress!,
      abi: SHOW_ESCROW_ARTIFACT.abi,
      functionName: "createCampaign",
      args: [
        keccak256(stringToHex(`${TEST_PREFIX}artist`)),
        keccak256(stringToHex(`${TEST_PREFIX}authority`)),
        artistWallet,
        paymentToken,
        1500000n,
        10n,
        deadline,
        bookingDeadline,
        0n,
        604800n,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    const activateHash = await walletClient.writeContract({
      address: escrowAddress!,
      abi: SHOW_ESCROW_ARTIFACT.abi,
      functionName: "activateCampaign",
      args: [1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: activateHash });

    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Hydrated Artist`,
        city: "Berlin",
        country: "DE",
        deadline: futureIso(20),
        goalAmountUnits: "1500000",
        minimumBackers: 10,
        bookingDeadline: futureIso(30),
        paymentTokenAddress: paymentToken,
        chainId: ANVIL_CHAIN_ID,
      },
    );
    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}hydrated-authority`,
      },
    );
    await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        authorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}hydrated-credential`,
      },
    );

    const activated = await service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        contractAddress: escrowAddress,
        contractCampaignId: "1",
      },
    );

    expect(activated.status).toBe("active");
    expect(activated.contractAddress).toBe(escrowAddress!.toLowerCase());
    expect(activated.contractCampaignId).toBe("1");
    expect(activated.feeBps).toBe(600);
    expect(activated.onChainStatus).toBe("Active");
    expect(activated.raisedAmountUnits).toBe("0");
    expect(activated.totalRefundedUnits).toBe("0");
    expect(activated.totalReleasedUnits).toBe("0");
    expect(activated.totalFeePaidUnits).toBe("0");
    expect(activated.uniqueBackerCount).toBe(0);
    expect(activated).not.toHaveProperty("reconciliationError");
    expect(activated).not.toHaveProperty("lastEscrowIndexedBlock");
    expect(() => JSON.stringify(activated)).not.toThrow();

    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        feeBps: null,
        onChainStatus: null,
        lastEscrowIndexedBlock: BigInt(123456789),
        reconciliationError: "stale snapshot",
        reconciliationErrorAt: new Date(),
      },
    });
    const resynced = await service.resyncCampaignFromChain(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
    );
    expect(resynced.feeBps).toBe(600);
    expect(resynced.onChainStatus).toBe("Active");
    expect(resynced).not.toHaveProperty("reconciliationError");
    expect(resynced).not.toHaveProperty("lastEscrowIndexedBlock");
    expect(() => JSON.stringify(resynced)).not.toThrow();

    // #1391: campaigns created before the platform-default payment token env
    // was set persist paymentTokenAddress = null, which blocks wallet pledge
    // execution. Re-sync from chain must correct this by adopting the escrow's
    // authoritative token.
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { paymentTokenAddress: null },
    });
    const tokenCorrected = await service.resyncCampaignFromChain(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
    );
    expect(tokenCorrected.paymentTokenAddress).toBeTruthy();
    expect(tokenCorrected.paymentTokenAddress!.toLowerCase()).toBe(paymentToken.toLowerCase());
  });

  it("rejects invalid beneficiary addresses and records rejected authority reviews", async () => {
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Lyon",
        country: "FR",
        deadline: futureIso(40),
        goalAmountUnits: "1750000",
        bookingDeadline: futureIso(55),
      },
    );

    await expect(service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: "not-a-wallet",
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}bad-wallet-evidence`,
      },
    )).rejects.toThrow(BadRequestException);

    const requested = await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}reject-authority-evidence`,
      },
    );

    expect(requested.artistAuthorityStatus).toBe("artist_acknowledged");

    const rejected = await service.rejectAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        reason: "artist wallet challenge did not match official channel",
        authorityEvidenceBundleId: `${TEST_PREFIX}reject-review-evidence`,
      },
    );

    expect(rejected.artistAuthorityStatus).toBe("rejected");
    expect(rejected.authorityCredentialId).toBeNull();
    expect(rejected.events[0].eventType).toBe("artist_authority_rejected");

    await expect(service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {},
    )).rejects.toThrow(BadRequestException);
  });

  it("revokes and expires authority before activation", async () => {
    const revokeCampaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Nantes",
        country: "FR",
        deadline: futureIso(45),
        goalAmountUnits: "2250000",
        bookingDeadline: futureIso(60),
      },
    );

    await service.requestAuthority(
      { userId, role: "artist" },
      revokeCampaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}revoke-authority-evidence`,
      },
    );

    const approved = await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      revokeCampaign.id,
      {
        authorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}revoked-credential`,
      },
    );

    expect(approved.artistAuthorityStatus).toBe("artist_authorized");

    const revoked = await service.revokeAuthority(
      { userId: operatorUserId, role: "operator" },
      revokeCampaign.id,
      { reason: "artist withdrew authorization before activation" },
    );

    expect(revoked.artistAuthorityStatus).toBe("revoked");
    expect(revoked.authorityCredentialId).toBeNull();
    expect(revoked.events[0].eventType).toBe("artist_authority_revoked");

    await expect(service.activateCampaign(
      { userId, role: "artist" },
      revokeCampaign.id,
      {},
    )).rejects.toThrow(BadRequestException);

    const expireCampaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Toulouse",
        country: "FR",
        deadline: futureIso(50),
        goalAmountUnits: "2000000",
        bookingDeadline: futureIso(65),
      },
    );

    const expired = await service.expireAuthority(
      { userId: operatorUserId, role: "operator" },
      expireCampaign.id,
      { reason: "authority evidence timed out" },
    );

    expect(expired.artistAuthorityStatus).toBe("expired");
    expect(expired.events[0].eventType).toBe("artist_authority_expired");
  });

  it("blocks self-issued artist authority at campaign creation (#946)", async () => {
    // A self-serve artist must not be able to stand up an already-authorized
    // escrow campaign and then self-activate it; authorization is operator-only.
    await expect(service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Nice",
        country: "FR",
        deadline: futureIso(33),
        goalAmountUnits: "1000000",
        bookingDeadline: futureIso(48),
        artistAuthorityStatus: "artist_authorized",
      },
    )).rejects.toThrow(ForbiddenException);

    // An operator may create an authorized campaign — and its approved terms are
    // snapshotted immediately, so they are locked from creation onward.
    const opCampaign = await service.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Nice",
        country: "FR",
        deadline: futureIso(33),
        goalAmountUnits: "1000000",
        bookingDeadline: futureIso(48),
        artistAuthorityStatus: "artist_authorized",
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
      },
    );
    expect(opCampaign.artistAuthorityStatus).toBe("artist_authorized");
    const storedOp = await prisma.showCampaign.findUniqueOrThrow({ where: { id: opCampaign.id } });
    expect(storedOp.approvedTermsHash).toBeTruthy();

    await expect(service.updateDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      opCampaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Nice",
        country: "FR",
        deadline: futureIso(33),
        goalAmountUnits: "7777777",
        bookingDeadline: futureIso(48),
      },
    )).rejects.toThrow(BadRequestException);
  });

  it("locks critical terms after authority approval and refuses silent changes (#946)", async () => {
    const deadline = futureIso(37);
    const booking = futureIso(52);
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Grenoble",
        country: "FR",
        deadline,
        goalAmountUnits: "1500000",
        minimumBackers: 100,
        bookingDeadline: booking,
      },
    );
    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}grenoble-authority`,
      },
    );
    const approved = await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        authorityStatus: "artist_authorized",
        authorityCredentialId: `${TEST_PREFIX}grenoble-credential`,
      },
    );
    expect(approved.approvedTermsHash).toBeTruthy();
    expect(approved.events[0].metadata).toMatchObject({ approvedTermsHash: approved.approvedTermsHash });

    // Bumping the goal after approval is refused.
    await expect(service.updateDraftCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Grenoble",
        country: "FR",
        deadline,
        goalAmountUnits: "9999999",
        minimumBackers: 100,
        bookingDeadline: booking,
      },
    )).rejects.toThrow(BadRequestException);

    // An operator swapping the beneficiary wallet is refused too.
    await expect(service.updateDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Grenoble",
        country: "FR",
        deadline,
        goalAmountUnits: "1500000",
        minimumBackers: 100,
        bookingDeadline: booking,
        beneficiaryAddress: "0x" + "b".repeat(40),
        beneficiaryType: "wallet",
      },
    )).rejects.toThrow(BadRequestException);

    const stored = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored.goalAmountUnits).toBe("1500000");
    expect(stored.beneficiaryAddress).toBe(artistWallet.toLowerCase());

    // Re-saving with identical critical terms (only changing pitch copy) is allowed.
    const edited = await service.updateDraftCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Grenoble",
        country: "FR",
        deadline,
        goalAmountUnits: "1500000",
        minimumBackers: 100,
        bookingDeadline: booking,
        description: "Refreshed pitch copy after approval",
      },
    );
    expect(edited.description).toBe("Refreshed pitch copy after approval");
    expect(edited.artistAuthorityStatus).toBe("artist_authorized");
    expect(edited.goalAmountUnits).toBe("1500000");
  });

  it("reopens term edits after revocation and requires re-approval before activation (#946)", async () => {
    const deadline = futureIso(38);
    const booking = futureIso(53);
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Rennes",
        country: "FR",
        deadline,
        goalAmountUnits: "2000000",
        minimumBackers: 80,
        bookingDeadline: booking,
      },
    );
    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}rennes-authority`,
      },
    );
    await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { authorityStatus: "artist_authorized", authorityCredentialId: `${TEST_PREFIX}rennes-credential` },
    );

    // Locked while approved.
    await expect(service.updateDraftCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Rennes",
        country: "FR",
        deadline,
        goalAmountUnits: "2500000",
        minimumBackers: 80,
        bookingDeadline: booking,
      },
    )).rejects.toThrow(BadRequestException);

    // Revoking clears the lock so terms can be amended.
    await service.revokeAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { reason: "artist requested a higher goal" },
    );
    const afterRevoke = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(afterRevoke.approvedTermsHash).toBeNull();
    expect(afterRevoke.artistAuthorityStatus).toBe("revoked");

    const edited = await service.updateDraftCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Rennes",
        country: "FR",
        deadline,
        goalAmountUnits: "2500000",
        minimumBackers: 80,
        bookingDeadline: booking,
      },
    );
    expect(edited.goalAmountUnits).toBe("2500000");

    // Activation is blocked until authority is granted again on the new terms.
    await expect(service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {},
    )).rejects.toThrow(BadRequestException);

    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}rennes-authority-2`,
      },
    );
    await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { authorityStatus: "artist_authorized", authorityCredentialId: `${TEST_PREFIX}rennes-credential-2` },
    );
    const activated = await service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      { contractAddress: "0x" + "6".repeat(40), contractCampaignId: "1" },
    );
    expect(activated.status).toBe("active");
    const finalCampaign = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(finalCampaign.goalAmountUnits).toBe("2500000");
  });

  it("refuses activation when terms drift from the approved snapshot (#946)", async () => {
    const campaign = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Dijon",
        country: "FR",
        deadline: futureIso(39),
        goalAmountUnits: "1800000",
        bookingDeadline: futureIso(54),
      },
    );
    await service.requestAuthority(
      { userId, role: "artist" },
      campaign.id,
      {
        beneficiaryAddress: artistWallet,
        beneficiaryType: "wallet",
        authorityEvidenceBundleId: `${TEST_PREFIX}dijon-authority`,
      },
    );
    await service.approveAuthority(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { authorityStatus: "artist_authorized", authorityCredentialId: `${TEST_PREFIX}dijon-credential` },
    );

    // Simulate an out-of-band write that bypasses the update lock entirely.
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { goalAmountUnits: "9000000" },
    });

    await expect(service.activateCampaign(
      { userId, role: "artist" },
      campaign.id,
      {},
    )).rejects.toThrow(BadRequestException);
  });

  it("creates pledge intents, confirms receipts, and keeps progress indexer-owned", async () => {
    const { campaign, tier } = await createActiveCampaignWithTier("Marseille");

    const intent = await service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      {
        tierId: tier.id,
        walletAddress: listenerWallet,
        metadata: { source: "integration-test" },
      },
    );

    expect(intent.pledge.status).toBe("intent_created");
    expect(intent.pledge.confirmationStatus).toBe("not_submitted");
    expect(intent.pledge.amountUnits).toBe(tier.amountUnits);
    expect(intent.pledge.receiptId).toBeTruthy();
    expect(intent.contractCall).toMatchObject({
      chainId: campaign.chainId,
      contractAddress: campaign.contractAddress,
      functionName: "pledge",
      args: [campaign.contractCampaignId, tier.amountUnits],
      value: "0",
    });
    expect(intent.pledge.events[0].eventType).toBe("pledge_intent_created");

    // #948: a wallet user recording their tx cannot self-confirm. The pledge
    // is "submitted"/"pending" until the on-chain Pledged event is indexed; a
    // client-claimed "confirmed" is intentionally downgraded.
    const submitted = await service.confirmPledge(
      { userId: listenerId, role: "listener" },
      intent.pledge.id,
      {
        transactionHash: txHash,
        blockNumber: "123456",
        confirmationStatus: "confirmed",
      },
    );

    expect(submitted.pledge.status).toBe("submitted");
    expect(submitted.pledge.confirmationStatus).toBe("pending");
    expect(submitted.pledge.transactionHash).toBe(txHash);
    expect(submitted.pledge.blockNumber).toBe("123456");
    expect(submitted.pledge.events[0].eventType).toBe("pledge_submitted");

    const storedCampaign = await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(storedCampaign.raisedAmountUnits).toBe("0");
    expect(storedCampaign.confirmedPledgeCount).toBe(0);

    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { lastEscrowIndexedBlock: BigInt(234567890) },
    });

    const myPledges = await service.getMyPledges(
      { userId: listenerId, role: "listener" },
      { walletAddress: listenerWallet, chainId: campaign.chainId },
    );
    expect(myPledges).toHaveLength(1);
    expect(myPledges[0].id).toBe(intent.pledge.id);
    expect(myPledges[0].campaign?.status).toBe("active");
    expect(myPledges[0].campaign).not.toHaveProperty("lastEscrowIndexedBlock");
    expect(() => JSON.stringify(myPledges)).not.toThrow();
  });

  it("opens pledge refunds when a campaign is cancelled and records refund receipts", async () => {
    const { campaign, tier } = await createActiveCampaignWithTier("Toulouse");

    const intent = await service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      {
        tierId: tier.id,
        walletAddress: listenerWallet,
      },
    );
    // Operator manual-confirm (privileged override) establishes a confirmed
    // pledge precondition; wallet users can no longer self-confirm (#948).
    await service.confirmPledge(
      { userId: operatorUserId, role: "operator" },
      intent.pledge.id,
      {
        transactionHash: "0x" + "b".repeat(64),
        blockNumber: "234567",
        confirmationStatus: "confirmed",
      },
    );

    await service.cancelCampaign(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { reason: "artist withdrew before booking" },
    );

    const refundable = await prisma.showPledge.findUniqueOrThrow({ where: { id: intent.pledge.id } });
    expect(refundable.status).toBe("refund_available");
    expect(refundable.refundAvailableAt).toBeTruthy();

    const refunded = await service.confirmPledgeRefund(
      { userId: listenerId, role: "listener" },
      intent.pledge.id,
      {
        transactionHash: refundTxHash,
        blockNumber: "234600",
        receipt: { source: "integration-test" },
      },
    );

    expect(refunded.pledge.status).toBe("refunded");
    expect(refunded.pledge.refundedAt).toBeTruthy();
    expect(refunded.pledge.events[0].eventType).toBe("pledge_refunded");
    expect(refunded.pledge.events[0].transactionHash).toBe(refundTxHash);
    expect(refunded.pledge.receipt).toMatchObject({
      refund: {
        transactionHash: refundTxHash,
        blockNumber: "234600",
        receipt: { source: "integration-test" },
      },
    });
  });

  it("rejects pledge intents whose wallet is not the caller's registered wallet (#1221)", async () => {
    const { campaign, tier } = await createActiveCampaignWithTier("Nantes");

    // A foreign address (not the listener's registered wallet) is rejected
    // (403 Forbidden), closing the pledge-attribution hijack from the #948 review.
    const foreign = service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      { tierId: tier.id, walletAddress: "0x" + "9".repeat(40) },
    );
    await expect(foreign).rejects.toBeInstanceOf(ForbiddenException);
    await expect(foreign).rejects.toThrow(/must match your connected wallet/);

    // A caller with no registered wallet cannot pledge at all (400 Bad Request).
    const noWallet = service.createPledgeIntent(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { tierId: tier.id, walletAddress: "0x" + "9".repeat(40) },
    );
    await expect(noWallet).rejects.toBeInstanceOf(BadRequestException);
    await expect(noWallet).rejects.toThrow(/Connect a wallet/);

    // The caller's own registered wallet succeeds.
    const ok = await service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      { tierId: tier.id, walletAddress: listenerWallet },
    );
    expect(ok.pledge.status).toBe("intent_created");
  });

  it("rejects pledge intents that bypass campaign, wallet, or tier rules", async () => {
    const draft = await service.createDraftCampaign(
      { userId, role: "artist" },
      {
        artistId,
        artistDisplayName: `${TEST_PREFIX}Artist`,
        city: "Nice",
        country: "FR",
        deadline: futureIso(30),
        goalAmountUnits: "3000000",
        bookingDeadline: futureIso(45),
      },
    );

    await expect(service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      draft.id,
      {
        walletAddress: listenerWallet,
        amountUnits: "250000",
      },
    )).rejects.toThrow(BadRequestException);

    const { campaign, tier } = await createActiveCampaignWithTier("Bordeaux");

    await expect(service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      {
        tierId: tier.id,
        walletAddress: "bad-wallet",
      },
    )).rejects.toThrow(BadRequestException);

    await expect(service.createPledgeIntent(
      { userId: listenerId, role: "listener" },
      campaign.id,
      {
        tierId: tier.id,
        walletAddress: listenerWallet,
        amountUnits: "1",
      },
    )).rejects.toThrow(BadRequestException);
  });

  it("excludes fan signals from campaign listings unless explicitly requested", async () => {
    const defaultList = await service.listCampaigns();
    expect(defaultList.some((campaign) => campaign.campaignLevel === "signal")).toBe(false);

    const withSignals = await service.listCampaigns({ includeSignals: true });
    expect(withSignals.some((campaign) => campaign.artistDisplayName === `${TEST_PREFIX}Signal Artist`)).toBe(true);
  });

  it("excludes refund/terminal campaigns from public listings by default and allows explicit status/scope lookup", async () => {
    const { campaign } = await createActiveCampaignWithTier("Bordeaux");
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "refund_available",
        refundAvailableAt: new Date(),
      },
    });

    const defaultList = await service.listCampaigns();
    expect(defaultList.some((listed) => listed.id === campaign.id)).toBe(false);

    const refundList = await service.listCampaigns({ status: "refund_available" });
    expect(refundList.some((listed) => listed.id === campaign.id)).toBe(true);

    const allList = await service.listCampaigns({ scope: "all" });
    expect(allList.some((listed) => listed.id === campaign.id)).toBe(true);
  });

  it("rejects unknown public campaign list status filters", async () => {
    await expect(service.listCampaigns({ status: "failed" })).rejects.toThrow(BadRequestException);
  });

  it("rejects unknown public campaign list scopes", async () => {
    await expect(service.listCampaigns({ scope: "operator" })).rejects.toThrow(BadRequestException);
  });

  it("public campaign reads expose trust/terms but never sensitive authority evidence (#949)", async () => {
    const { campaign } = await createActiveCampaignWithTier("Strasbourg");
    // Populate an internal storage URI + a visual carrying a storage URI so the
    // withholding assertions below run against actually-present data.
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { heroImageStorageUri: "gs://internal-bucket/hero.webp", heroImageMimeType: "image/webp" },
    });
    await prisma.showCampaignVisual.create({
      data: {
        campaignId: campaign.id,
        role: "gallery",
        publicUrl: "https://cdn.example/g1.webp",
        storageUri: "gs://internal-bucket/g1.webp",
        mimeType: "image/webp",
        sortOrder: 0,
      },
    });

    const publicCampaign = (await service.getCampaign(campaign.slug)) as Record<string, unknown>;

    // Trust + immutable terms the fan UI needs are present.
    expect(publicCampaign.campaignLevel).toBe("active_escrow_campaign");
    expect(publicCampaign.artistAuthorityStatus).toBe("artist_authorized");
    expect(publicCampaign.beneficiaryAddress).toBe(artistWallet);
    expect(publicCampaign.releasePolicy).toBeDefined();
    expect(publicCampaign.disputeWindowSeconds).toBeDefined();
    expect(publicCampaign).toHaveProperty("depositReleaseBps");
    expect(Array.isArray(publicCampaign.tiers)).toBe(true);

    // Sensitive evidence / internal fields are NOT exposed.
    expect(publicCampaign).not.toHaveProperty("authorityCredentialId");
    expect(publicCampaign).not.toHaveProperty("authorityEvidenceBundleId");
    expect(publicCampaign).not.toHaveProperty("events");
    expect(publicCampaign).not.toHaveProperty("heroImageStorageUri");
    expect(publicCampaign).not.toHaveProperty("cardImageStorageUri");
    expect(publicCampaign).not.toHaveProperty("bookingTerms");
    expect(publicCampaign).not.toHaveProperty("reconciliationError");
    expect(publicCampaign).not.toHaveProperty("lastEscrowIndexedBlock");
    // Visuals expose only public fields — never the internal storage URI.
    const visuals = (publicCampaign.visuals ?? []) as Array<Record<string, unknown>>;
    expect(visuals.length).toBeGreaterThan(0);
    for (const visual of visuals) {
      expect(visual).not.toHaveProperty("storageUri");
      expect(visual).toHaveProperty("publicUrl");
    }
    // The serialized payload as a whole leaks no evidence ids or storage URIs.
    expect(JSON.stringify(publicCampaign)).not.toContain("-authority");
    expect(JSON.stringify(publicCampaign)).not.toContain("-credential");
    expect(JSON.stringify(publicCampaign)).not.toContain("internal-bucket");

    // listCampaigns goes through the same DTO — assert it withholds too.
    const listed = (await service.listCampaigns()) as Array<Record<string, unknown>>;
    const listedCampaign = listed.find((c) => c.id === campaign.id);
    expect(listedCampaign).toBeDefined();
    expect(listedCampaign).not.toHaveProperty("authorityEvidenceBundleId");
    expect(listedCampaign).not.toHaveProperty("heroImageStorageUri");
  });

  it("operator-scoped read exposes evidence ids + disputes to operator/owner, denies strangers (#949)", async () => {
    const { campaign } = await createActiveCampaignWithTier("Annecy");
    await prisma.showCampaignDispute.create({
      data: { campaignId: campaign.id, initiatorRole: "operator", status: "open", reason: "venue check" },
    });

    // Operator sees the withheld authority evidence ids + the dispute list.
    const managed = (await service.getManagedCampaign(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
    )) as Record<string, any>;
    expect(managed.authorityCredentialId).toBe(`${TEST_PREFIX}Annecy-credential`);
    expect(managed.authorityEvidenceBundleId).toBe(`${TEST_PREFIX}Annecy-authority`);
    expect(Array.isArray(managed.disputes)).toBe(true);
    expect(managed.disputes[0]).toMatchObject({ status: "open", reason: "venue check" });

    // The owning artist can read it too.
    const owned = (await service.getManagedCampaign(
      { userId, role: "artist" },
      campaign.id,
    )) as Record<string, any>;
    expect(owned.authorityEvidenceBundleId).toBe(`${TEST_PREFIX}Annecy-authority`);

    // A stranger (non-owner, non-operator) is denied.
    await expect(
      service.getManagedCampaign({ userId: listenerId, role: "listener" }, campaign.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("cancels an active campaign into refund availability with lifecycle events", async () => {
    const { campaign } = await createActiveCampaignWithTier("Rennes");

    const cancelled = await service.cancelCampaign(
      { userId, role: "artist" },
      campaign.id,
      {
        reason: "artist withdrew before booking",
        evidenceBundleId: `${TEST_PREFIX}cancel-evidence`,
      },
    );

    expect(cancelled.status).toBe("refund_available");
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(cancelled.refundAvailableAt).toBeTruthy();
    expect(cancelled.events.map((event) => event.eventType)).toContain("campaign_cancelled");
    expect(cancelled.events.map((event) => event.eventType)).toContain("refund_available");
  });

  it("requires operators to confirm booking and fulfillment evidence in order", async () => {
    const { campaign } = await createFundedCampaign("Strasbourg");

    await expect(service.confirmBooking(
      { userId, role: "artist" },
      campaign.id,
      { evidenceBundleId: `${TEST_PREFIX}booking-evidence` },
    )).rejects.toThrow();

    const booked = await service.confirmBooking(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        evidenceBundleId: `${TEST_PREFIX}booking-evidence`,
        evidence: { venueHold: "accepted" },
      },
    );

    expect(booked.status).toBe("booking_confirmed");
    expect(booked.bookingEvidenceBundleId).toBe(`${TEST_PREFIX}booking-evidence`);
    expect(booked.events[0].eventType).toBe("booking_confirmed");

    const fulfilled = await service.confirmFulfillment(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      {
        evidenceBundleId: `${TEST_PREFIX}fulfillment-evidence`,
        evidence: { doorReport: "accepted" },
      },
    );

    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.fulfillmentEvidenceBundleId).toBe(`${TEST_PREFIX}fulfillment-evidence`);
    expect(fulfilled.events[0].eventType).toBe("fulfillment_confirmed");
  });

  it("does not confirm booking after the booking deadline", async () => {
    const { campaign } = await createFundedCampaign("Lille");
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { bookingDeadline: new Date(Date.now() - 60_000) },
    });

    await expect(service.confirmBooking(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { evidenceBundleId: `${TEST_PREFIX}late-booking-evidence` },
    )).rejects.toThrow(BadRequestException);
  });

  it("requires evidence to confirm booking and fulfillment (#950)", async () => {
    const { campaign } = await createFundedCampaign("Dijon");
    // No evidence bundle → booking confirmation is rejected.
    await expect(
      service.confirmBooking({ userId: operatorUserId, role: "operator" }, campaign.id, {}),
    ).rejects.toThrow(/evidence/i);

    await service.confirmBooking({ userId: operatorUserId, role: "operator" }, campaign.id, {
      evidenceBundleId: `${TEST_PREFIX}dijon-booking`,
    });
    // Fulfillment also requires evidence.
    await expect(
      service.confirmFulfillment({ userId: operatorUserId, role: "operator" }, campaign.id, {}),
    ).rejects.toThrow(/evidence/i);
  });

  it("runs the off-chain dispute lifecycle and blocks release while open (#950)", async () => {
    const { campaign } = await createFundedCampaign("Grenoble");
    await service.confirmBooking({ userId: operatorUserId, role: "operator" }, campaign.id, {
      evidenceBundleId: `${TEST_PREFIX}grenoble-booking`,
    });

    // Non-operators cannot initiate.
    await expect(
      service.initiateDispute({ userId: listenerId, role: "listener" }, campaign.id, { reason: "no-show risk" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const dispute = await service.initiateDispute(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { reason: "venue hold disputed" },
    );
    expect(dispute.status).toBe("open");

    // A second open dispute is rejected.
    await expect(
      service.initiateDispute({ userId: operatorUserId, role: "operator" }, campaign.id, {}),
    ).rejects.toThrow(/already exists/i);

    // An open dispute blocks fulfillment (progress toward final release).
    await expect(
      service.confirmFulfillment({ userId: operatorUserId, role: "operator" }, campaign.id, {
        evidenceBundleId: `${TEST_PREFIX}grenoble-fulfillment`,
      }),
    ).rejects.toThrow(/open dispute/i);

    // Public DTO surfaces the active dispute without leaking notes/reason.
    const active = (await service.getCampaign(campaign.slug)) as Record<string, unknown>;
    expect(active.disputeStatus).toBe("active");
    expect(JSON.stringify(active)).not.toContain("venue hold disputed");

    // Resolve, then fulfillment proceeds.
    await expect(
      service.resolveDispute({ userId: operatorUserId, role: "operator" }, campaign.id, dispute.id, {
        outcome: "rejected",
        operatorNote: "evidence sufficient",
      }),
    ).resolves.toMatchObject({ status: "resolved", outcome: "rejected" });

    const fulfilled = await service.confirmFulfillment(
      { userId: operatorUserId, role: "operator" },
      campaign.id,
      { evidenceBundleId: `${TEST_PREFIX}grenoble-fulfillment` },
    );
    expect(fulfilled.status).toBe("fulfilled");

    // After fulfillment the DTO exposes the dispute window close time + resolved status.
    const resolvedView = (await service.getCampaign(campaign.slug)) as Record<string, unknown>;
    expect(resolvedView.disputeStatus).toBe("resolved");
    expect(resolvedView.disputeWindowClosesAt).toBeTruthy();
    expect(JSON.stringify(resolvedView)).not.toContain("evidence sufficient");
  });
});
