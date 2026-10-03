import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { FirstListenerDiscoveryService } from "../modules/recommendations/first_listener_discovery.service";

const P = `first_home_${Date.now()}_`;
const GENRE = `${P}Afro`;
const HUMAN_RELEASE = `${P}human_release`;

describe("fresh release placement through the real Home recommendation pipeline", () => {
  const home = new RecommendationsService(new EventBus(), new DiscoveryRankingService(),
    undefined, undefined, undefined, new DiscoveryPolicyContextService(), undefined, undefined,
    new FirstListenerDiscoveryService());

  beforeAll(async () => {
    for (const name of ["creator", "ai_creator", "unverified", "fit", "no_fit", "repeat"]) {
      await prisma.user.create({ data: { id: `${P}${name}`, email: `${P}${name}@test.resonate` } });
    }
    for (const creator of ["creator", "ai_creator"]) {
      await prisma.curatorReputation.create({ data: {
        walletAddress: `${P}${creator}`.toLowerCase(), humanVerificationStatus: "human_verified", humanVerifiedAt: new Date(),
      } });
    }
    for (const name of ["human", "unverified", "ai"]) {
      const creator = name === "unverified" ? `${P}unverified` : name === "ai" ? `${P}ai_creator` : `${P}creator`;
      await prisma.artist.create({ data: { id: `${P}${name}_artist`, userId: creator, displayName: name } });
      await prisma.release.create({ data: {
        id: `${P}${name}_release`, artistId: `${P}${name}_artist`, title: name,
        status: "published", genre: GENRE, createdAt: new Date(Date.now() - 86_400_000),
      } });
      for (let position = 1; position <= (name === "human" ? 2 : 1); position++) {
        await prisma.track.create({ data: {
          id: `${P}${name}_track_${position}`, releaseId: `${P}${name}_release`, title: `${name} ${position}`,
          position, processingStatus: "complete", contentStatus: "clean", aiDisclosureLevel: name === "ai" ? "ALL" : "NONE",
        } });
      }
    }
  });

  afterAll(async () => {
    await prisma.firstListenerExposure.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.recommendationProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: { startsWith: P.toLowerCase() } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  });

  it("serves a fitting verified human release with its durable placement and explanation", async () => {
    const response = await home.getRecommendations(`${P}fit`, 5, { genres: [GENRE] });
    const discovery = response.items.filter((item) => item.reasonCode === "discovery_pick");
    expect(discovery).toHaveLength(1);
    expect(discovery[0].releaseId).toBe(HUMAN_RELEASE);
    expect(discovery[0].explanations.join(" ")).toContain("Discovery pick");
    expect(response.items.some((item) => item.id === `${P}ai_track_1`)).toBe(false);
    expect(await prisma.firstListenerExposure.count({ where: { userId: `${P}fit`, releaseId: HUMAN_RELEASE } })).toBe(1);
  });

  it("never reserves first-listener exposure for a listener without matching taste", async () => {
    const response = await home.getRecommendations(`${P}no_fit`, 5, { genres: [`${P}unrelated`] });
    expect(response.items.some((item) => item.releaseId === HUMAN_RELEASE && item.reasonCode === "discovery_pick")).toBe(false);
    expect(await prisma.firstListenerExposure.count({ where: { userId: `${P}no_fit` } })).toBe(0);
  });

  it("cannot bypass the listener/release cap by serving another track from the same fresh release", async () => {
    const first = await home.getRecommendations(`${P}repeat`, 1, { genres: [GENRE] });
    expect(first.items[0]?.releaseId).toBe(HUMAN_RELEASE);
    expect(first.items[0]?.reasonCode).toBe("discovery_pick");
    const second = await home.getRecommendations(`${P}repeat`, 1, { genres: [GENRE] });
    expect(second.items.some((item) => item.releaseId === HUMAN_RELEASE && item.reasonCode === "discovery_pick")).toBe(false);
    expect(await prisma.firstListenerExposure.count({ where: { userId: `${P}repeat`, releaseId: HUMAN_RELEASE } })).toBe(1);
  });
});
