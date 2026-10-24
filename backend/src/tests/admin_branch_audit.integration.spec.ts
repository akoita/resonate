/**
 * Admin branches inside user-facing routes write one AdminAuditEvent (#2380).
 *
 * Real Postgres. For each service-level branch: the admin/operator branch writes
 * one row (ids and codes only, the owner as target), and the owner's own access,
 * an admin acting on their own data, and a call that carries no audit actor write
 * none. The controller-level branches are covered by the HTTP specs
 * (wallet, collection, notifications, notify-listing).
 *
 * Run: npm run test:integration -- admin_branch_audit
 */
import { prisma } from "../db/prisma";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { WalletService } from "../modules/identity/wallet.service";
import { WalletProviderRegistry } from "../modules/identity/wallet_provider_registry";
import { Erc4337WalletProvider } from "../modules/identity/wallet_providers/erc4337_wallet_provider";
import { LocalWalletProvider } from "../modules/identity/wallet_providers/local_wallet_provider";
import { PaymasterService } from "../modules/identity/paymaster.service";
import { RightsRouteReassessmentService } from "../modules/rights/rights-route-reassessment.service";
import { ShowsService } from "../modules/shows/shows.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `branch_audit_${Date.now()}_`;
const BASE = BigInt(Date.now()) * 1000n;
const address = (offset: bigint) => `0x${(BASE + offset).toString(16).padStart(40, "a").slice(-40)}`;

const ownerId = address(1n);
const adminId = `${P}admin`;
const operatorId = `${P}operator`;
const listenerId = `${P}listener`;
const artistId = `${P}artist`;
const releaseId = `${P}release`;

const admin = { userId: adminId, role: "admin" };
const operator = { userId: operatorId, role: "operator" };
const owner = { userId: ownerId, role: "listener" };

const rowsBy = (actorUserId: string) =>
  prisma.adminAuditEvent.findMany({ where: { actorUserId }, orderBy: { createdAt: "asc" } });

describe("admin branches write an audit row (integration, #2380)", () => {
  const campaignIds: string[] = [];

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${P}owner@test.resonate` },
        { id: adminId, email: `${P}admin@test.resonate` },
        { id: operatorId, email: `${P}operator@test.resonate` },
        { id: listenerId, email: `${P}listener@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: { id: artistId, userId: ownerId, displayName: `${P}Artist`, payoutAddress: "0x" + "7".repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: `${P}Release`, status: "published", primaryArtist: `${P}Artist`, rightsRoute: "STANDARD_ESCROW", rightsFlags: [] },
    });
    // The shows payout-eligibility gate (#1498) needs a human-verified owner.
    await prisma.curatorReputation.create({
      data: { walletAddress: ownerId, humanVerificationStatus: "human_verified", verifiedHuman: true, humanVerifiedAt: new Date() },
    });
    await prisma.wallet.create({ data: { userId: ownerId, address: ownerId, chainId: 84532 } });
  });

  afterAll(async () => {
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: [adminId, operatorId, ownerId] } } });
    await prisma.communityBenefitRule.deleteMany({ where: { artistId } });
    await prisma.showCampaignEvent.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.showCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: ownerId } });
    await prisma.wallet.deleteMany({ where: { userId: ownerId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, operatorId, listenerId] } } });
  });

  beforeEach(async () => {
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: [adminId, operatorId, ownerId] } } });
  });

  it("artist analytics: an admin on another artist is recorded; the owner and an admin on their own artist are not", async () => {
    const service = new AnalyticsAuthorizationService();
    await service.assertCanReadArtistMetrics(artistId, owner);
    expect(await rowsBy(ownerId)).toHaveLength(0);

    await service.assertCanReadArtistMetrics(artistId, admin);
    const rows = await rowsBy(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "artist_analytics.support_viewed",
      targetUserId: ownerId,
      outcome: "success",
      detail: { artistId },
    });

    // An admin who owns the artist reads their own data.
    await prisma.artist.update({ where: { id: artistId }, data: { userId: adminId } });
    try {
      await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: adminId } });
      await service.assertCanReadArtistMetrics(artistId, admin);
      expect(await rowsBy(adminId)).toHaveLength(0);
    } finally {
      await prisma.artist.update({ where: { id: artistId }, data: { userId: ownerId } });
    }
  });

  it("wallet read: an admin reading someone else's wallet is recorded; the owner is not", async () => {
    const wallets = new WalletService(
      new EventBus(),
      new WalletProviderRegistry(new LocalWalletProvider(), new Erc4337WalletProvider()),
      {} as any,
      new PaymasterService(),
      {} as any,
    );
    await wallets.getWalletForCaller({ userId: ownerId }, ownerId);
    expect(await rowsBy(ownerId)).toHaveLength(0);

    await wallets.getWalletForCaller(admin, ownerId);
    const rows = await rowsBy(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "wallet.support_viewed", targetUserId: ownerId });
  });

  it("route history: an admin on someone else's release is recorded; the owner, and a call with no audit actor, are not", async () => {
    const service = new RightsRouteReassessmentService();
    await service.listReleaseHistory(releaseId, ownerId, "listener", owner);
    await service.listReleaseHistory(releaseId, null, "admin");
    expect(await rowsBy(ownerId)).toHaveLength(0);
    expect(await rowsBy(adminId)).toHaveLength(0);

    await service.listReleaseHistory(releaseId, adminId, "admin", admin);
    const rows = await rowsBy(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "rights_reassessment_history.support_viewed",
      targetUserId: ownerId,
      detail: { releaseId },
    });
  });

  it("community benefit rules: an operator managing an artist's rules is recorded; the artist is not", async () => {
    const service = new CommunityEligibilityService({ publish: jest.fn() } as any);
    await service.listArtistBenefitRules({ userId: ownerId, role: "listener" }, artistId);
    expect(await rowsBy(ownerId)).toHaveLength(0);

    await service.listArtistBenefitRules(operator, artistId);
    const rows = await rowsBy(operatorId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "community_benefit_rule.operator_managed",
      targetUserId: ownerId,
      detail: { artistId, via: "list" },
    });

    await expect(service.listArtistBenefitRules({ userId: listenerId, role: "listener" }, artistId)).rejects.toThrow();
    expect(await rowsBy(listenerId)).toHaveLength(0);
  });

  it("show campaign: an operator editing an artist's draft is recorded with a route code; the artist is not", async () => {
    const shows = new ShowsService();
    const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const input = {
      artistId,
      artistDisplayName: `${P}Artist`,
      city: "Lyon",
      country: "FR",
      deadline: future(30),
      goalAmountUnits: "3000000",
      minimumBackers: 100,
      bookingDeadline: future(45),
    };
    const campaign = await shows.createDraftCampaign({ userId: ownerId, role: "listener" }, input);
    campaignIds.push(campaign.id);

    await shows.updateDraftCampaign({ userId: ownerId, role: "listener" }, campaign.id, { ...input, city: "Paris" });
    expect(await rowsBy(ownerId)).toHaveLength(0);

    await shows.updateDraftCampaign(operator, campaign.id, { ...input, city: "Nice" });
    const rows = await rowsBy(operatorId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "show_campaign.operator_accessed",
      targetUserId: ownerId,
      detail: { campaignId: campaign.id, via: "update_draft" },
    });

    // The management read is not recorded.
    await shows.getManagedCampaign(operator, campaign.id);
    expect(await rowsBy(operatorId)).toHaveLength(1);
  });
});
