import { prisma } from "../db/prisma";
import { CuratorReputationService } from "../modules/contracts/curator-reputation.service";

const TEST_PREFIX = `currep_${Date.now()}_`;

describe("CuratorReputationService (integration)", () => {
  const service = new CuratorReputationService();
  const wallet = `0x${TEST_PREFIX.padEnd(40, "a").slice(0, 40)}`;

  beforeAll(async () => {
    await prisma.curatorReputation.create({
      data: {
        walletAddress: wallet,
        score: 32,
        successfulFlags: 3,
        rejectedFlags: 1,
        totalBounties: 2,
        reportsFiled: 4,
        lastActiveAt: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.dispute.create({
      data: {
        id: `${TEST_PREFIX}dispute`,
        tokenId: "77",
        reporterAddr: wallet,
        creatorAddr: `0x${TEST_PREFIX.padEnd(40, "b").slice(0, 40)}`,
        evidenceURI: "ipfs://evidence",
        counterStake: "2000000000000000",
        status: "FILED",
      },
    });
  });

  afterAll(async () => {
    await prisma.dispute.deleteMany({ where: { id: `${TEST_PREFIX}dispute` } }).catch(() => {});
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: wallet } }).catch(() => {});
  });

  it("builds a decayed curator profile with reporting gate state", async () => {
    const profile = await service.getProfile(wallet);

    expect(profile.score).toBe(32);
    expect(profile.decayPenalty).toBe(4);
    expect(profile.effectiveScore).toBe(28);
    expect(profile.activeReports).toBe(1);
    expect(profile.reportsFiled).toBe(4);
    expect(profile.requiresHumanVerification).toBe(true);
    expect(profile.stakeTier.key).toBe("trusted");
  });

  it("clears the human gate after verification is stored", async () => {
    await service.saveHumanVerificationStatus(wallet, {
      provider: "passport",
      status: "verified",
      verified: true,
      score: 24,
      threshold: 20,
      verifiedAt: new Date(),
    });

    const profile = await service.getProfile(wallet);
    expect(profile.humanVerification.verified).toBe(true);
    expect(profile.requiresHumanVerification).toBe(false);
  });
});
