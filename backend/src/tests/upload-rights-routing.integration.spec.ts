import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { CatalogService } from "../modules/catalog/catalog.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const P = `rights_${Date.now()}_`;

describe("UploadRightsRoutingService (integration)", () => {
  const routing = new UploadRightsRoutingService();
  const catalog = new CatalogService(
    new EventBus(),
    {} as any,
    {} as any,
    routing,
  );

  const newUserId = `${P}user_new`;
  const verifiedUserId = `${P}user_verified`;
  const trustedSourceUserId = `${P}user_trusted_source`;
  const catalogUserId = `${P}user_catalog`;

  const newArtistId = `${P}artist_new`;
  const verifiedArtistId = `${P}artist_verified`;
  const trustedSourceArtistId = `${P}artist_trusted_source`;
  const catalogArtistId = `${P}artist_catalog`;

  const limitedReleaseId = `${P}release_limited`;
  const standardReleaseId = `${P}release_standard`;
  const trustedReleaseId = `${P}release_trusted`;
  const conflictExistingReleaseId = `${P}release_conflict_existing`;
  const conflictIncomingReleaseId = `${P}release_conflict_incoming`;
  const blockedReleaseId = `${P}release_blocked`;
  const blockedSiblingTrackId = `${P}track_blocked_sibling`;
  const blockedSiblingStemId = `${P}stem_blocked_sibling`;

  const trackIds = {
    limited: `${P}track_limited`,
    standard: `${P}track_standard`,
    trusted: `${P}track_trusted`,
    conflictExisting: `${P}track_conflict_existing`,
    conflictIncoming: `${P}track_conflict_incoming`,
    blocked: `${P}track_blocked`,
  };

  const originalTrustedUploadSources = process.env.TRUSTED_UPLOAD_SOURCES;

  beforeAll(async () => {
    process.env.TRUSTED_UPLOAD_SOURCES = "trusted_distributor";

    await prisma.user.createMany({
      data: [
        { id: newUserId, email: `${P}new@test.resonate` },
        { id: verifiedUserId, email: `${P}verified@test.resonate` },
        { id: trustedSourceUserId, email: `${P}trusted@test.resonate` },
        { id: catalogUserId, email: `${P}catalog@test.resonate` },
      ],
    });

    await prisma.artist.createMany({
      data: [
        {
          id: newArtistId,
          userId: newUserId,
          displayName: "New Artist",
          payoutAddress: "0x" + "1".repeat(40),
        },
        {
          id: verifiedArtistId,
          userId: verifiedUserId,
          displayName: "Verified Artist",
          payoutAddress: "0x" + "2".repeat(40),
        },
        {
          id: trustedSourceArtistId,
          userId: trustedSourceUserId,
          displayName: "Trusted Source Artist",
          payoutAddress: "0x" + "3".repeat(40),
        },
        {
          id: catalogArtistId,
          userId: catalogUserId,
          displayName: "Major Catalog Artist",
          payoutAddress: "0x" + "4".repeat(40),
        },
      ],
    });

    await prisma.creatorTrust.create({
      data: {
        artistId: verifiedArtistId,
        tier: "verified",
      },
    });

    await prisma.release.createMany({
      data: [
        {
          id: limitedReleaseId,
          artistId: newArtistId,
          title: "Fresh Upload",
          status: "ready",
          rightsSourceType: "direct_upload",
        },
        {
          id: standardReleaseId,
          artistId: verifiedArtistId,
          title: "Verified Upload",
          status: "ready",
          rightsSourceType: "direct_upload",
        },
        {
          id: trustedReleaseId,
          artistId: trustedSourceArtistId,
          title: "Distributor Upload",
          status: "ready",
          rightsSourceType: "trusted_distributor",
        },
        {
          id: conflictExistingReleaseId,
          artistId: catalogArtistId,
          title: "In Da Club",
          primaryArtist: "50 Cent",
          status: "published",
          rightsRoute: "TRUSTED_FAST_PATH",
          rightsSourceType: "trusted_distributor",
        },
        {
          id: conflictIncomingReleaseId,
          artistId: newArtistId,
          title: "In Da Club",
          primaryArtist: "50 Cent",
          status: "ready",
          rightsSourceType: "direct_upload",
        },
        {
          id: blockedReleaseId,
          artistId: newArtistId,
          title: "Blocked Upload",
          status: "published",
          rightsRoute: "BLOCKED",
          rightsSourceType: "direct_upload",
        },
      ],
    });

    await prisma.track.createMany({
      data: [
        { id: trackIds.limited, releaseId: limitedReleaseId, title: "Fresh Upload" },
        { id: trackIds.standard, releaseId: standardReleaseId, title: "Verified Upload" },
        { id: trackIds.trusted, releaseId: trustedReleaseId, title: "Distributor Upload" },
        { id: trackIds.conflictExisting, releaseId: conflictExistingReleaseId, title: "In Da Club" },
        { id: trackIds.conflictIncoming, releaseId: conflictIncomingReleaseId, title: "In Da Club" },
        {
          id: trackIds.blocked,
          releaseId: blockedReleaseId,
          title: "Blocked Upload",
          rightsRoute: "BLOCKED",
        },
        {
          id: blockedSiblingTrackId,
          releaseId: blockedReleaseId,
          title: "Blocked Upload Sibling",
          rightsRoute: "STANDARD_ESCROW",
        },
      ],
    });

    await prisma.stem.create({
      data: {
        id: blockedSiblingStemId,
        trackId: blockedSiblingTrackId,
        type: "vocals",
        uri: "/blocked-sibling.wav",
      },
    });
  });

  afterAll(async () => {
    process.env.TRUSTED_UPLOAD_SOURCES = originalTrustedUploadSources;

    await prisma.creatorTrust.deleteMany({
      where: { artistId: { in: [verifiedArtistId] } },
    }).catch(() => {});
    await prisma.stem.deleteMany({
      where: { id: { in: [blockedSiblingStemId] } },
    }).catch(() => {});
    await prisma.track.deleteMany({
      where: { id: { in: [...Object.values(trackIds), blockedSiblingTrackId] } },
    }).catch(() => {});
    await prisma.release.deleteMany({
      where: {
        id: {
          in: [
            limitedReleaseId,
            standardReleaseId,
            trustedReleaseId,
            conflictExistingReleaseId,
            conflictIncomingReleaseId,
            blockedReleaseId,
          ],
        },
      },
    }).catch(() => {});
    await prisma.artist.deleteMany({
      where: {
        id: {
          in: [
            newArtistId,
            verifiedArtistId,
            trustedSourceArtistId,
            catalogArtistId,
          ],
        },
      },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [newUserId, verifiedUserId, trustedSourceUserId, catalogUserId],
        },
      },
    }).catch(() => {});
  });

  it("persists limited monitoring for new uploaders and syncs the track route", async () => {
    await routing.evaluateAndPersistInitialDecision({
      releaseId: limitedReleaseId,
      artistId: newArtistId,
      title: "Fresh Upload",
      sourceType: "direct_upload",
    });

    const release = await prisma.release.findUnique({ where: { id: limitedReleaseId } });
    const track = await prisma.track.findUnique({ where: { id: trackIds.limited } });

    expect(release?.rightsRoute).toBe("LIMITED_MONITORING");
    expect(track?.rightsRoute).toBe("LIMITED_MONITORING");
  });

  it("persists standard escrow for verified uploaders", async () => {
    await routing.evaluateAndPersistInitialDecision({
      releaseId: standardReleaseId,
      artistId: verifiedArtistId,
      title: "Verified Upload",
      sourceType: "direct_upload",
    });

    const release = await prisma.release.findUnique({ where: { id: standardReleaseId } });
    expect(release?.rightsRoute).toBe("STANDARD_ESCROW");
  });

  it("persists trusted fast path for approved sources", async () => {
    await routing.evaluateAndPersistInitialDecision({
      releaseId: trustedReleaseId,
      artistId: trustedSourceArtistId,
      title: "Distributor Upload",
      sourceType: "trusted_distributor",
    });

    const release = await prisma.release.findUnique({ where: { id: trustedReleaseId } });
    expect(release?.rightsRoute).toBe("TRUSTED_FAST_PATH");
  });

  it("quarantines major catalog conflicts and records review flags", async () => {
    await routing.evaluateAndPersistInitialDecision({
      releaseId: conflictIncomingReleaseId,
      artistId: newArtistId,
      title: "In Da Club",
      primaryArtist: "50 Cent",
      sourceType: "direct_upload",
    });

    const release = await prisma.release.findUnique({ where: { id: conflictIncomingReleaseId } });
    const track = await prisma.track.findUnique({ where: { id: trackIds.conflictIncoming } });

    expect(release?.rightsRoute).toBe("QUARANTINED_REVIEW");
    expect(track?.rightsRoute).toBe("QUARANTINED_REVIEW");
    expect(release?.rightsFlags).toEqual(
      expect.arrayContaining(["MAJOR_CATALOG_RISK", "NEEDS_HUMAN_REVIEW"]),
    );
  });

  it("filters blocked and quarantined releases out of the published catalog", async () => {
    const releases = await catalog.listPublished(20);
    const releaseIds = releases.map((release) => release.id);

    expect(releaseIds).toContain(limitedReleaseId);
    expect(releaseIds).toContain(standardReleaseId);
    expect(releaseIds).toContain(trustedReleaseId);
    expect(releaseIds).not.toContain(conflictIncomingReleaseId);
    expect(releaseIds).not.toContain(blockedReleaseId);
  });

  it("uses the stricter release route when deciding marketplace access for a stem", async () => {
    await expect(
      routing.assertMarketplaceAllowedForStem(blockedSiblingStemId),
    ).rejects.toThrow("Marketplace minting is disabled");
  });
});
