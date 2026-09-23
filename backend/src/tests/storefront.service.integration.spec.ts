import { prisma } from "../db/prisma";
import { StorefrontService } from "../modules/storefront/storefront.service";
import { X402Config } from "../modules/x402/x402.config";

const TEST_PREFIX = `storefrontcurrent_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const CURRENT_STEM_ID = `${TEST_PREFIX}current`;
const HISTORICAL_STEM_ID = `${TEST_PREFIX}historical`;

const x402Config = {
  network: "eip155:84532",
  payoutAddress: `0x${"a1".repeat(20)}`,
  licensePricing: {
    personal: { amountUsd: 0.05, feeBps: 1500 },
    remix: { amountUsd: 5, feeBps: 1000 },
    commercial: { amountUsd: 25, feeBps: 1000 },
  },
} as X402Config;

describe("StorefrontService current stems (integration)", () => {
  let service: StorefrontService;

  beforeAll(async () => {
    service = new StorefrontService(x402Config);
    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: "Current Stem Storefront Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: `${TEST_PREFIX}release`,
        status: "published",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: `${TEST_PREFIX}track`,
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: CURRENT_STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          title: `${TEST_PREFIX}current melody`,
          uri: "/test/current-melody.mp3",
          isCurrent: true,
        },
        {
          id: HISTORICAL_STEM_ID,
          trackId: TRACK_ID,
          type: "archived-keys",
          title: `${TEST_PREFIX}historical melody`,
          uri: "/test/historical-melody.mp3",
          isCurrent: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stemPricing.deleteMany({
      where: { stemId: { in: [CURRENT_STEM_ID, HISTORICAL_STEM_ID] } },
    });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  it("discovers current stems and keeps exact historical detail lookups", async () => {
    const search = await service.searchStems({
      q: `${TEST_PREFIX}current melody`,
      limit: 10,
    });

    expect(search.items.map((item) => item.id)).toEqual([CURRENT_STEM_ID]);
    expect(search.items[0].stemTypes).toEqual(["vocals"]);

    const historicalDetail = await service.getStemDetail(HISTORICAL_STEM_ID);
    expect(historicalDetail.id).toBe(HISTORICAL_STEM_ID);
    expect(historicalDetail.stemTypes).toEqual(["vocals"]);
  });
});
