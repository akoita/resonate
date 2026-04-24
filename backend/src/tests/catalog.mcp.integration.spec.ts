import { prisma } from "../db/prisma";
import { CatalogService } from "../modules/catalog/catalog.service";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { ConfigService } from "@nestjs/config";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const TEST_PREFIX = `mcp_catalog_${Date.now()}_`;

describe("CatalogService MCP catalog search (integration)", () => {
  let catalog: CatalogService;

  beforeAll(async () => {
    const configService = new ConfigService({
      ENCRYPTION_SECRET:
        process.env.ENCRYPTION_SECRET ||
        "test-encryption-secret-for-integration",
    });
    const encryption = new EncryptionService(
      new AesEncryptionProvider(configService) as any,
      configService,
    );

    catalog = new CatalogService(
      new EventBus(),
      encryption as any,
      new LocalStorageProvider(),
      new UploadRightsRoutingService(),
    );

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
        displayName: "MCP Artist",
        payoutAddress: `0x${"1".repeat(40)}`,
      },
    });
  });

  afterAll(async () => {
    await prisma.stemListing.deleteMany({
      where: { stem: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } },
    });
    await prisma.stem.deleteMany({
      where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } },
    });
    await prisma.track.deleteMany({
      where: { release: { artistId: `${TEST_PREFIX}artist` } },
    });
    await prisma.release.deleteMany({
      where: { artistId: `${TEST_PREFIX}artist` },
    });
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("returns the stable nine-field MCP release shape with licensable status", async () => {
    const releaseId = `${TEST_PREFIX}release`;
    const trackId = `${TEST_PREFIX}track`;
    const stemId = `${TEST_PREFIX}stem`;

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: "The Horizon Is Home",
        status: "published",
        primaryArtist: "MCP Primary Artist",
        genre: "electronic",
        releaseDate: new Date("2026-04-22T00:00:00.000Z"),
        artworkMimeType: "image/png",
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: "Horizon Intro",
        artist: "MCP Primary Artist",
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: "vocals",
        uri: "horizon-vocals.wav",
      },
    });
    await prisma.stemListing.create({
      data: {
        id: `${TEST_PREFIX}listing`,
        listingId: 1n,
        stemId,
        tokenId: 1n,
        chainId: 31337,
        contractAddress: `0x${"2".repeat(40)}`,
        sellerAddress: `0x${"3".repeat(40)}`,
        pricePerUnit: "100000",
        amount: 1n,
        paymentToken: `0x${"4".repeat(40)}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        transactionHash: `0x${"5".repeat(64)}`,
        blockNumber: 1n,
        status: "active",
        listedAt: new Date("2026-04-22T00:00:00.000Z"),
      },
    });

    const result = await catalog.searchMcpCatalog("horizon", 5);

    expect(result.items).toEqual([
      {
        id: releaseId,
        title: "The Horizon Is Home",
        artist: "MCP Primary Artist",
        genre: "electronic",
        releaseDate: "2026-04-22T00:00:00.000Z",
        artworkUrl: `http://localhost:3000/catalog/releases/${releaseId}/artwork`,
        trackCount: 1,
        licensable: true,
        deeplink: `http://localhost:3001/release/${releaseId}`,
      },
    ]);
  });

  it("does not mark expired or sold-out listings as licensable", async () => {
    const expiredReleaseId = `${TEST_PREFIX}expired_release`;
    const expiredTrackId = `${TEST_PREFIX}expired_track`;
    const expiredStemId = `${TEST_PREFIX}expired_stem`;
    const soldOutReleaseId = `${TEST_PREFIX}soldout_release`;
    const soldOutTrackId = `${TEST_PREFIX}soldout_track`;
    const soldOutStemId = `${TEST_PREFIX}soldout_stem`;

    await prisma.release.createMany({
      data: [
        {
          id: expiredReleaseId,
          artistId: `${TEST_PREFIX}artist`,
          title: "Unavailable Expired",
          status: "published",
        },
        {
          id: soldOutReleaseId,
          artistId: `${TEST_PREFIX}artist`,
          title: "Unavailable Sold Out",
          status: "published",
        },
      ],
    });
    await prisma.track.createMany({
      data: [
        {
          id: expiredTrackId,
          releaseId: expiredReleaseId,
          title: "Expired Track",
        },
        {
          id: soldOutTrackId,
          releaseId: soldOutReleaseId,
          title: "Sold Out Track",
        },
      ],
    });
    await prisma.stem.createMany({
      data: [
        {
          id: expiredStemId,
          trackId: expiredTrackId,
          type: "vocals",
          uri: "expired-vocals.wav",
        },
        {
          id: soldOutStemId,
          trackId: soldOutTrackId,
          type: "vocals",
          uri: "soldout-vocals.wav",
        },
      ],
    });
    await prisma.stemListing.createMany({
      data: [
        {
          id: `${TEST_PREFIX}expired_listing`,
          listingId: 2n,
          stemId: expiredStemId,
          tokenId: 2n,
          chainId: 31337,
          contractAddress: `0x${"6".repeat(40)}`,
          sellerAddress: `0x${"7".repeat(40)}`,
          pricePerUnit: "100000",
          amount: 1n,
          paymentToken: `0x${"8".repeat(40)}`,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          transactionHash: `0x${"9".repeat(64)}`,
          blockNumber: 2n,
          status: "active",
          listedAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        {
          id: `${TEST_PREFIX}soldout_listing`,
          listingId: 3n,
          stemId: soldOutStemId,
          tokenId: 3n,
          chainId: 31337,
          contractAddress: `0x${"a".repeat(40)}`,
          sellerAddress: `0x${"b".repeat(40)}`,
          pricePerUnit: "100000",
          amount: 0n,
          paymentToken: `0x${"c".repeat(40)}`,
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          transactionHash: `0x${"d".repeat(64)}`,
          blockNumber: 3n,
          status: "active",
          listedAt: new Date("2026-04-22T00:00:00.000Z"),
        },
      ],
    });

    const result = await catalog.searchMcpCatalog("unavailable", 10);

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expiredReleaseId,
          licensable: false,
        }),
        expect.objectContaining({
          id: soldOutReleaseId,
          licensable: false,
        }),
      ]),
    );
  });
});
