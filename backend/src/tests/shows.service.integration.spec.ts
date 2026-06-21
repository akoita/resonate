import { BadRequestException, ForbiddenException } from "@nestjs/common";
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

const futureIso = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

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
    expect(activated.events[0].eventType).toBe("campaign_activated");
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

    const myPledges = await service.getMyPledges(
      { userId: listenerId, role: "listener" },
      { walletAddress: listenerWallet, chainId: campaign.chainId },
    );
    expect(myPledges).toHaveLength(1);
    expect(myPledges[0].id).toBe(intent.pledge.id);
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
});
