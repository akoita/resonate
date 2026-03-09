/**
 * DmcaService — Integration Test
 *
 * Tests DMCA report lifecycle with REAL Postgres.
 * NO MOCKS. Real Prisma + real DmcaService.
 *
 * Run: npm run test:integration -- --testPathPattern dmca
 */

import { prisma } from "../db/prisma";
import { DmcaService } from "../modules/dmca/dmca.service";
import { NotFoundException } from "@nestjs/common";

const P = `dmca_${Date.now()}_`;

describe("DmcaService (integration)", () => {
  let service: DmcaService;

  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  let reportId: string;

  beforeAll(async () => {
    service = new DmcaService();

    // Seed test data
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: "DMCA Test Artist", payoutAddress: "0x" + "D".repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "DMCA Test Release" },
    });
    await prisma.track.create({
      data: { id: trackId, title: "DMCA Test Track", releaseId },
    });

    // Create some stems for cascade testing
    await prisma.stem.createMany({
      data: [
        { id: `${P}stem_vocals`, trackId, type: "vocals", uri: "/stems/vocals.mp3" },
        { id: `${P}stem_drums`, trackId, type: "drums", uri: "/stems/drums.mp3" },
        { id: `${P}stem_bass`, trackId, type: "bass", uri: "/stems/bass.mp3" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.dmcaReport.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("creates a pending DMCA report", async () => {
    const result = await service.fileReport({
      trackId,
      claimantName: "Original Artist",
      claimantEmail: "artist@example.com",
      originalWorkUrl: "https://youtube.com/watch?v=xxx",
      reason: "This is my song uploaded without permission",
    });

    expect(result.status).toBe("pending");
    expect(result.trackId).toBe(trackId);
    reportId = result.id;

    // Verify in DB
    const report = await prisma.dmcaReport.findUnique({ where: { id: reportId } });
    expect(report).not.toBeNull();
    expect(report!.claimantName).toBe("Original Artist");
  });

  it("throws NotFoundException for non-existent track", async () => {
    await expect(
      service.fileReport({
        trackId: "nonexistent-track-id",
        claimantName: "Test",
        claimantEmail: "test@test.com",
        originalWorkUrl: "https://example.com",
        reason: "Test reason",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("files a counter-notification", async () => {
    const result = await service.fileCounter(reportId, "I own this content, here is my proof");

    expect(result.status).toBe("countered");
    expect(result.counterNotice).toBe("I own this content, here is my proof");
  });

  it("resolves report as upheld — cascades to track and stems", async () => {
    // Reset report status to pending for this test
    await prisma.dmcaReport.update({
      where: { id: reportId },
      data: { status: "pending", counterNotice: null },
    });

    const result = await service.resolveReport(reportId, "upheld");

    expect(result.outcome).toBe("upheld");
    expect(result.trackId).toBe(trackId);

    // Track should be dmca_removed
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    expect(track!.contentStatus).toBe("dmca_removed");

    // All stems should have empty URIs (delisted)
    const stems = await prisma.stem.findMany({ where: { trackId } });
    expect(stems.length).toBe(3);
    for (const stem of stems) {
      expect(stem.uri).toBe("");
    }
  });

  it("resolves report as rejected — no cascade", async () => {
    // Create a second report to test rejection
    const report2 = await service.fileReport({
      trackId,
      claimantName: "Troll",
      claimantEmail: "troll@example.com",
      originalWorkUrl: "https://example.com",
      reason: "False claim",
    });

    // Reset track status for this test
    await prisma.track.update({
      where: { id: trackId },
      data: { contentStatus: "clean" },
    });
    await prisma.stem.updateMany({
      where: { trackId },
      data: { uri: "/stems/restored.mp3" },
    });

    const result = await service.resolveReport(report2.id, "rejected");

    expect(result.outcome).toBe("rejected");

    // Track should still be clean
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    expect(track!.contentStatus).toBe("clean");

    // Stems should still have URIs
    const stems = await prisma.stem.findMany({ where: { trackId } });
    for (const stem of stems) {
      expect(stem.uri).not.toBe("");
    }
  });
});
