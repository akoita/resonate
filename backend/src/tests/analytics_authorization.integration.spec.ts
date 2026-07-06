import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { prisma } from "../db/prisma";

describe("AnalyticsAuthorizationService (integration)", () => {
  const TEST_PREFIX = `analytics_auth_${Date.now()}_`;
  const ownerId = `${TEST_PREFIX}owner`;
  const listenerId = `${TEST_PREFIX}listener`;
  const artistId = `${TEST_PREFIX}artist`;
  let service: AnalyticsAuthorizationService;

  beforeAll(async () => {
    service = new AnalyticsAuthorizationService();

    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@test.resonate` },
        { id: listenerId, email: `${listenerId}@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: ownerId,
        displayName: "Analytics Auth Artist",
        payoutAddress: "0x1234567890123456789012345678901234567890",
      },
    });
  });

  afterAll(async () => {
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, listenerId] } } });
  });

  it("allows agent users to read artist aggregate metrics", async () => {
    await expect(
      service.assertCanReadArtistMetrics(artistId, { userId: `${TEST_PREFIX}agent`, role: "agent" }),
    ).resolves.toBeUndefined();
  });

  it("forbids a listener who is not the artist owner", async () => {
    await expect(
      service.assertCanReadArtistMetrics(artistId, { userId: listenerId, role: "listener" }),
    ).rejects.toThrow("Artist analytics are restricted to the artist owner");
  });

  it("allows the artist owner", async () => {
    await expect(
      service.assertCanReadArtistMetrics(artistId, { userId: ownerId, role: "listener" }),
    ).resolves.toBeUndefined();
  });

  it("allows admin users", async () => {
    await expect(
      service.assertCanReadArtistMetrics(artistId, { userId: `${TEST_PREFIX}admin`, role: "admin" }),
    ).resolves.toBeUndefined();
  });
});
