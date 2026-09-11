import { prisma } from "../db/prisma";
import { AnalyticsCatalogMetadataService } from "../modules/analytics/analytics_catalog_metadata.service";

const TEST_PREFIX = `analytics_catalog_metadata_${Date.now()}_`;

describe("AnalyticsCatalogMetadataService integration", () => {
  const service = new AnalyticsCatalogMetadataService();

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}user`,
        email: `${TEST_PREFIX}user@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Grey",
        payoutAddress: "0x0000000000000000000000000000000000000919",
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Extra Musica",
        status: "ready",
        tracks: {
          create: {
            id: `${TEST_PREFIX}track`,
            title: "Zongi Sanga",
            processingStatus: "complete",
          },
        },
      },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: `${TEST_PREFIX}drop`,
        trackId: `${TEST_PREFIX}track`,
        artistId: `${TEST_PREFIX}artist`,
      },
    });
  });

  afterAll(async () => {
    await prisma.punchlineDrop.deleteMany({ where: { id: `${TEST_PREFIX}drop` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("returns track, release, and artist metadata for analytics enrichment", async () => {
    const metadata = await service.findTracks([`${TEST_PREFIX}track`, `${TEST_PREFIX}track`, "missing"]);

    expect(metadata.get(`${TEST_PREFIX}track`)).toEqual({
      trackId: `${TEST_PREFIX}track`,
      title: "Zongi Sanga",
      releaseId: `${TEST_PREFIX}release`,
      releaseTitle: "Extra Musica",
      artistId: `${TEST_PREFIX}artist`,
      artistName: "Grey",
      managerArtistId: `${TEST_PREFIX}artist`,
      managerArtistName: "Grey",
      creditedArtistId: null,
      creditedArtistName: "Grey",
      creditedArtistIds: [],
      creditedArtistNames: [],
    });
    expect(metadata.has("missing")).toBe(false);
  });

  // #1743: punchline product events carry a dropId only, so ingest-time artist
  // attribution resolves through the drop.
  it("returns the artist behind a punchline drop", async () => {
    const artists = await service.findPunchlineDropArtists([`${TEST_PREFIX}drop`, "missing"]);

    expect(artists.get(`${TEST_PREFIX}drop`)).toBe(`${TEST_PREFIX}artist`);
    expect(artists.has("missing")).toBe(false);
  });
});
