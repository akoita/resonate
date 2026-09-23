/**
 * FingerprintService — Integration Test
 *
 * Tests fingerprint storage and duplicate detection with REAL Postgres.
 * NO MOCKS. Real Prisma + real FingerprintService.
 *
 * Run: npm run test:integration -- --testPathPattern fingerprint
 */

import { prisma } from "../db/prisma";
import { FingerprintService } from "../modules/fingerprint/fingerprint.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const P = `fp_${Date.now()}_`;

describe("FingerprintService (integration)", () => {
  let service: FingerprintService;

  const userId = `${P}user`;
  const artistId1 = `${P}artist1`;
  const artistId2 = `${P}artist2`;
  const releaseId1 = `${P}release1`;
  const releaseId2 = `${P}release2`;
  const trackId1 = `${P}track1`;
  const trackId2 = `${P}track2`;
  const trackId3 = `${P}track3`;

  beforeAll(async () => {
    service = new FingerprintService(new UploadRightsRoutingService());

    // Seed: Two artists, each with a release and track
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.user.create({ data: { id: `${P}user2`, email: `${P}2@test.resonate` } });

    await prisma.artist.create({
      data: { id: artistId1, userId, displayName: "Artist One", payoutAddress: "0x" + "A".repeat(40) },
    });
    await prisma.artist.create({
      data: { id: artistId2, userId: `${P}user2`, displayName: "Artist Two", payoutAddress: "0x" + "B".repeat(40) },
    });

    await prisma.release.create({
      data: {
        id: releaseId1,
        artistId: artistId1,
        title: "Release One",
        rightsRoute: "LIMITED_MONITORING",
        rightsSourceType: "direct_upload",
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId2,
        artistId: artistId2,
        title: "Release Two",
        rightsRoute: "LIMITED_MONITORING",
        rightsSourceType: "direct_upload",
      },
    });

    await prisma.track.create({
      data: { id: trackId1, title: "Track One", releaseId: releaseId1 },
    });
    await prisma.track.create({
      data: { id: trackId2, title: "Track Two (same artist)", releaseId: releaseId1 },
    });
    await prisma.track.create({
      data: { id: trackId3, title: "Track Three (different artist)", releaseId: releaseId2 },
    });
  });

  afterAll(async () => {
    // Clean up in reverse order of creation
    await prisma.audioFingerprint.deleteMany({ where: { trackId: { in: [trackId1, trackId2, trackId3] } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { in: [trackId1, trackId2, trackId3] } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { in: [releaseId1, releaseId2] } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { in: [artistId1, artistId2] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, `${P}user2`] } } }).catch(() => {});
  });

  it("stores fingerprint and returns quarantined=false for new content", async () => {
    const result = await service.registerFingerprint({
      trackId: trackId1,
      releaseId: releaseId1,
      fingerprint: "111,222,333,444",
      fingerprintHash: `${P}hash_unique`,
      duration: 180.5,
    });

    expect(result.quarantined).toBe(false);

    // Verify stored in DB
    const fp = await prisma.audioFingerprint.findUnique({ where: { trackId: trackId1 } });
    expect(fp).not.toBeNull();
    expect(fp!.fingerprintHash).toBe(`${P}hash_unique`);
    expect(fp!.duration).toBe(180.5);
  });

  it("warns but does NOT quarantine for same-wallet duplicate", async () => {
    // Track 2 belongs to the same artist as Track 1 — reuse the fingerprint hash
    const result = await service.registerFingerprint({
      trackId: trackId2,
      releaseId: releaseId1,
      fingerprint: "111,222,333,444",
      fingerprintHash: `${P}hash_unique`,  // same hash as track1
      duration: 180.5,
    });

    expect(result.quarantined).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.sameWallet).toBe(true);

    // Track should still be "clean"
    const track = await prisma.track.findUnique({ where: { id: trackId2 } });
    expect(track!.contentStatus).toBe("clean");
  });

  it("quarantines for cross-wallet duplicate", async () => {
    // Track 3 belongs to a DIFFERENT artist — same fingerprint hash should quarantine
    const result = await service.registerFingerprint({
      trackId: trackId3,
      releaseId: releaseId2,
      fingerprint: "111,222,333,444",
      fingerprintHash: `${P}hash_unique`,  // same hash, different artist
      duration: 180.5,
    });

    expect(result.quarantined).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.sameWallet).toBe(false);
    expect(result.reason).toContain("Artist One");

    // Track should be quarantined
    const track = await prisma.track.findUnique({ where: { id: trackId3 } });
    expect(track!.contentStatus).toBe("quarantined");
    expect(track!.rightsRoute).toBe("QUARANTINED_REVIEW");

    const release = await prisma.release.findUnique({ where: { id: releaseId2 } });
    expect(release!.rightsRoute).toBe("QUARANTINED_REVIEW");
  });

  it("stages a replacement fingerprint without changing active audio or accepting stale callbacks", async () => {
    const revision = "11111111-1111-4111-8111-111111111111";
    await prisma.release.update({ where: { id: releaseId1 }, data: { status: "ready" } });
    await prisma.track.update({
      where: { id: trackId1 },
      data: { pendingAudioRevision: revision, audioReplacementStatus: "processing" },
    });

    const staged = await service.registerFingerprint({
      trackId: trackId1,
      releaseId: releaseId1,
      audioRevision: revision,
      fingerprint: "999,888,777",
      fingerprintHash: `${P}replacement_hash`,
      duration: 200,
    });
    expect(staged.quarantined).toBe(false);
    const track = await prisma.track.findUnique({ where: { id: trackId1 } });
    expect(track?.pendingAudioFingerprintHash).toBe(`${P}replacement_hash`);
    expect((await prisma.audioFingerprint.findUnique({ where: { trackId: trackId1 } }))?.fingerprintHash).toBe(`${P}hash_unique`);

    const stale = await service.registerFingerprint({
      trackId: trackId1,
      releaseId: releaseId1,
      audioRevision: "22222222-2222-4222-8222-222222222222",
      fingerprint: "123",
      fingerprintHash: `${P}stale_hash`,
      duration: 1,
    });
    expect(stale.quarantined).toBe(true);

    const crossWallet = await service.registerFingerprint({
      trackId: trackId1,
      releaseId: releaseId1,
      audioRevision: revision,
      fingerprint: "111,222,333,444",
      fingerprintHash: `${P}hash_unique`,
      duration: 180,
    });
    expect(crossWallet.quarantined).toBe(true);
    expect((await prisma.track.findUnique({ where: { id: trackId1 } }))?.contentStatus).toBe("clean");

    const legacy = await service.registerFingerprint({
      trackId: trackId1,
      releaseId: releaseId1,
      fingerprint: "123",
      fingerprintHash: `${P}legacy_hash`,
      duration: 1,
    });
    expect(legacy.quarantined).toBe(true);
    expect((await prisma.track.findUnique({ where: { id: trackId1 } }))?.pendingAudioFingerprintHash).toBe(`${P}replacement_hash`);
    expect((await prisma.audioFingerprint.findUnique({ where: { trackId: trackId1 } }))?.fingerprintHash).toBe(`${P}hash_unique`);
  });

  it("serializes competing cross-wallet replacement fingerprints", async () => {
    const firstRevision = "33333333-3333-4333-8333-333333333333";
    const secondRevision = "44444444-4444-4444-8444-444444444444";
    await prisma.release.updateMany({
      where: { id: { in: [releaseId1, releaseId2] } },
      data: { status: "ready" },
    });
    await prisma.track.update({
      where: { id: trackId1 },
      data: { pendingAudioRevision: firstRevision, pendingAudioFingerprintHash: null },
    });
    await prisma.track.update({
      where: { id: trackId3 },
      data: { pendingAudioRevision: secondRevision, pendingAudioFingerprintHash: null },
    });

    const hash = `${P}simultaneous_replacement`;
    const results = await Promise.all([
      service.registerFingerprint({
        trackId: trackId1, releaseId: releaseId1, audioRevision: firstRevision,
        fingerprint: "111,222", fingerprintHash: hash, duration: 120,
      }),
      service.registerFingerprint({
        trackId: trackId3, releaseId: releaseId2, audioRevision: secondRevision,
        fingerprint: "111,222", fingerprintHash: hash, duration: 120,
      }),
    ]);
    expect(results.map((result) => result.quarantined).sort()).toEqual([false, true]);
    const tracks = await prisma.track.findMany({
      where: { id: { in: [trackId1, trackId3] } },
      select: { pendingAudioFingerprintHash: true },
    });
    expect(tracks.filter((track) => track.pendingAudioFingerprintHash === hash)).toHaveLength(1);
  });
});
