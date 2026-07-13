/**
 * Public moment share surfaces — Integration (#1477 slice 2)
 *
 * Real Prisma. Covers the two new public reads on PunchlineDropService:
 *   (a) getPublicMomentShare: published-drop moment → full card payload with
 *       credited artist + drop/track/release context;
 *   (b) draft-drop moment → 404 (never leaks an unpublished moment);
 *   (c) unknown moment id → 404;
 *   (d) getPublicCollectibleShare consent gate:
 *         - public profile + showOwnedItems ON  → 200 with edition pride block,
 *           and NEVER wallet or payment provenance;
 *         - public profile + showOwnedItems OFF → 404;
 *         - non-public profile + showOwnedItems ON → 404;
 *         - collector with no community profile → 404;
 *         - unknown collectible id → 404.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-share'
 */

import { NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { PunchlineClipService } from "../modules/punchline/punchline-clip.service";
import { PunchlineDropService } from "../modules/punchline/punchline-drop.service";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import { PunchlineUnlockService } from "../modules/punchline/punchline-unlock.service";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";

const TEST_PREFIX = `punchline_share_${Date.now()}_`;
const ARTIST_USER = `${TEST_PREFIX}artist_user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const DROP_PUB = `${TEST_PREFIX}drop_pub`;
const DROP_DRAFT = `${TEST_PREFIX}drop_draft`;
const MOMENT_PUB = `${TEST_PREFIX}m_pub`;
const MOMENT_DRAFT = `${TEST_PREFIX}m_draft`;

const WALLET = "0xdeadBEEFdeadBEEFdeadBEEFdeadBEEFdeadBEEF";

// collectors — one per consent scenario, distinct edition numbers on MOMENT_PUB.
const C_PUBLIC = `${TEST_PREFIX}c_public`; // profile public + showOwnedItems on
const C_HIDDEN = `${TEST_PREFIX}c_hidden`; // profile public + showOwnedItems off
const C_PRIVATE = `${TEST_PREFIX}c_private`; // profile community + showOwnedItems on
const C_NOPROFILE = `${TEST_PREFIX}c_noprofile`; // no community profile

const COL_PUBLIC = `${TEST_PREFIX}col_public`;
const COL_HIDDEN = `${TEST_PREFIX}col_hidden`;
const COL_PRIVATE = `${TEST_PREFIX}col_private`;
const COL_NOPROFILE = `${TEST_PREFIX}col_noprofile`;

describe("Punchline public share surfaces (integration, #1477)", () => {
  const eventBus = new EventBus();
  const clipService = new PunchlineClipService(
    new LocalStorageProvider(),
    { decryptForRender: jest.fn() } as unknown as EncryptionService,
    undefined,
  );
  const service = new PunchlineDropService(
    eventBus,
    new PunchlineEligibilityService(),
    clipService,
    new PunchlineUnlockService(eventBus, clipService, undefined),
    undefined,
  );

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: ARTIST_USER, email: `${ARTIST_USER}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: ARTIST_USER, displayName: "Manager Account" },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Share Release",
        status: "ready",
        // Credited artist distinct from the manager account displayName.
        primaryArtist: "Credited Artist",
        artworkMimeType: "image/png",
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Share Track", position: 1 },
    });

    await prisma.punchlineDrop.create({
      data: {
        id: DROP_PUB,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        title: "Public Drop",
        moments: {
          create: [
            {
              id: MOMENT_PUB,
              title: "The hook",
              lyricText: "everyone screams this line",
              startMs: 1000,
              endMs: 6000,
              editionSize: 100,
              priceCents: 0,
            },
          ],
        },
      },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_DRAFT,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "draft",
        moments: {
          create: [
            {
              id: MOMENT_DRAFT,
              title: "Draft moment",
              lyricText: "not public yet",
              startMs: 0,
              endMs: 4000,
              editionSize: 10,
              priceCents: 0,
            },
          ],
        },
      },
    });

    // Collectors + their community profile/visibility + a collectible each.
    const seedCollector = async (
      userId: string,
      collectibleId: string,
      editionNumber: number,
      profileVisibility: string | null,
      showOwnedItems: boolean | null,
    ) => {
      await prisma.user.create({
        data: { id: userId, email: `${userId}@test.resonate` },
      });
      if (profileVisibility) {
        await prisma.communityProfile.create({
          data: {
            userId,
            displayName: `Collector ${editionNumber}`,
            profileVisibility,
          },
        });
      }
      if (showOwnedItems !== null) {
        await prisma.communityVisibilitySettings.create({
          data: { userId, showOwnedItems },
        });
      }
      await prisma.punchlineCollectible.create({
        data: {
          id: collectibleId,
          momentId: MOMENT_PUB,
          collectorUserId: userId,
          collectorWallet: WALLET,
          editionNumber,
          status: "owned",
          paymentRail: "free_claim",
          pricePaidCents: 0,
          acquiredAt: new Date(),
        },
      });
    };

    await seedCollector(C_PUBLIC, COL_PUBLIC, 1, "public", true);
    await seedCollector(C_HIDDEN, COL_HIDDEN, 2, "public", false);
    await seedCollector(C_PRIVATE, COL_PRIVATE, 3, "community", true);
    await seedCollector(C_NOPROFILE, COL_NOPROFILE, 4, null, null);
  });

  afterAll(async () => {
    await prisma.punchlineCollectible.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityProfile.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineMoment.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineDrop.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  describe("getPublicMomentShare", () => {
    it("returns the public card payload for a published-drop moment", async () => {
      const result = await service.getPublicMomentShare(MOMENT_PUB);
      expect(result.moment).toMatchObject({
        id: MOMENT_PUB,
        title: "The hook",
        lyricText: "everyone screams this line",
        editionSize: 100,
        priceCents: 0,
        collectedCount: 4,
      });
      expect(result.drop).toEqual({ id: DROP_PUB, title: "Public Drop" });
      expect(result.track).toEqual({ id: TRACK_ID, title: "Share Track" });
      expect(result.release).toEqual({
        id: RELEASE_ID,
        title: "Share Release",
        artworkMimeType: "image/png",
      });
      // Credited artist, not the manager account label.
      expect(result.artistName).toBe("Credited Artist");
    });

    it("404s a draft-drop moment", async () => {
      await expect(service.getPublicMomentShare(MOMENT_DRAFT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404s an unknown moment id", async () => {
      await expect(
        service.getPublicMomentShare(`${TEST_PREFIX}missing`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getPublicCollectibleShare (consent-gated)", () => {
    it("returns the edition pride block when profile public + showOwnedItems on", async () => {
      const result = await service.getPublicCollectibleShare(COL_PUBLIC);
      expect(result.moment.id).toBe(MOMENT_PUB);
      expect(result.edition).toEqual({
        editionNumber: 1,
        collectorDisplayName: "Collector 1",
        acquiredAt: expect.anything(),
      });
    });

    it("NEVER exposes wallet or payment provenance in the pride payload", async () => {
      const result = await service.getPublicCollectibleShare(COL_PUBLIC);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(WALLET);
      expect(serialized).not.toContain("collectorWallet");
      expect(serialized).not.toContain("paymentRail");
      expect(serialized).not.toContain("pricePaidCents");
      expect(serialized).not.toContain("paymentRef");
    });

    it("404s when showOwnedItems is off (profile public)", async () => {
      await expect(service.getPublicCollectibleShare(COL_HIDDEN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404s when the profile is not public (showOwnedItems on)", async () => {
      await expect(service.getPublicCollectibleShare(COL_PRIVATE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("404s when the collector has no community profile", async () => {
      await expect(
        service.getPublicCollectibleShare(COL_NOPROFILE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s an unknown collectible id", async () => {
      await expect(
        service.getPublicCollectibleShare(`${TEST_PREFIX}missing`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
