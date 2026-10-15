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
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const P = `dmca_${Date.now()}_`;

describe("DmcaService (integration)", () => {
  let service: DmcaService;

  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const releaseId = `${P}release`;
  const trackId = `${P}track`;
  const outsiderId = `${P}outsider`;
  const owner = { userId, role: "artist" };
  const outsider = { userId: outsiderId, role: "listener" };
  const reviewer = { userId: `${P}admin`, role: "admin" };
  let reportId: string;
  let rejectedReportId: string;

  beforeAll(async () => {
    service = new DmcaService(new UploadRightsRoutingService());

    // Seed test data
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.user.create({ data: { id: outsiderId, email: `${P}outsider@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: "DMCA Test Artist", payoutAddress: "0x" + "D".repeat(40) },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: "DMCA Test Release",
        rightsRoute: "STANDARD_ESCROW",
        rightsSourceType: "direct_upload",
      },
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
    await prisma.user.delete({ where: { id: outsiderId } }).catch(() => {});
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
    expect(result).not.toHaveProperty("claimantName");
    expect(result).not.toHaveProperty("claimantEmail");
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

  it("rejects an incomplete report with BadRequestException", async () => {
    await expect(
      service.fileReport({
        trackId,
        claimantName: "",
        claimantEmail: "test@test.com",
        originalWorkUrl: "https://example.com",
        reason: "Test reason",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a counter-notification from a user who does not own or manage the release", async () => {
    await expect(
      service.fileCounter(reportId, "Not mine", outsider),
    ).rejects.toThrow(ForbiddenException);

    const report = await prisma.dmcaReport.findUnique({ where: { id: reportId } });
    expect(report!.status).toBe("pending");
    expect(report!.counterNotice).toBeNull();
  });

  it("throws NotFoundException for a counter-notification on an unknown report", async () => {
    await expect(
      service.fileCounter(`${P}missing`, "Proof", owner),
    ).rejects.toThrow(NotFoundException);
  });

  it("files a counter-notification", async () => {
    const result = await service.fileCounter(reportId, "I own this content, here is my proof", owner);

    expect(result.status).toBe("countered");
    expect(result.counterNotice).toBe("I own this content, here is my proof");
    expect(result).not.toHaveProperty("claimantName");
    expect(result).not.toHaveProperty("claimantEmail");
  });

  it("refuses a second counter-notification on an already countered report", async () => {
    await expect(
      service.fileCounter(reportId, "Again", owner),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an unknown resolve outcome", async () => {
    await expect(
      service.resolveReport(reportId, "maybe" as "upheld", reviewer),
    ).rejects.toThrow(BadRequestException);
  });

  it("resolves report as upheld — cascades to track and stems", async () => {
    // Reset report status to pending for this test
    await prisma.dmcaReport.update({
      where: { id: reportId },
      data: { status: "pending", counterNotice: null },
    });

    const result = await service.resolveReport(reportId, "upheld", reviewer);

    expect(result.outcome).toBe("upheld");
    expect(result.trackId).toBe(trackId);

    // Track should be dmca_removed
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    expect(track!.contentStatus).toBe("dmca_removed");
    expect(track!.rightsRoute).toBe("BLOCKED");

    // All stems should have empty URIs (delisted)
    const stems = await prisma.stem.findMany({ where: { trackId } });
    expect(stems.length).toBe(3);
    for (const stem of stems) {
      expect(stem.uri).toBe("");
    }

    const release = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(release!.rightsRoute).toBe("BLOCKED");
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

    const result = await service.resolveReport(report2.id, "rejected", reviewer);
    rejectedReportId = report2.id;

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

  it("refuses a counter-notification on a rejected report", async () => {
    await expect(
      service.fileCounter(rejectedReportId, "Proof", owner),
    ).rejects.toThrow(BadRequestException);
  });

  it("accepts a counter-notification from an admin on a pending report", async () => {
    const pending = await service.fileReport({
      trackId,
      claimantName: "Claimant",
      claimantEmail: "claimant@example.com",
      originalWorkUrl: "https://example.com/original",
      reason: "Pending claim",
    });

    const result = await service.fileCounter(pending.id, "Reviewed on behalf of the owner", reviewer);
    expect(result.status).toBe("countered");
  });

  it("accepts a counter-notification from a catalog manager of the release", async () => {
    const managerId = `${P}manager`;
    await prisma.user.create({ data: { id: managerId, email: `${P}manager@test.resonate` } });
    const grant = await prisma.managementGrant.create({
      data: {
        releaseId,
        granteeUserId: managerId,
        inviterUserId: userId,
        scopes: ["CATALOG_METADATA"],
        status: "active",
      },
    });
    try {
      const pending = await service.fileReport({
        trackId,
        claimantName: "Claimant",
        claimantEmail: "claimant@example.com",
        originalWorkUrl: "https://example.com/original",
        reason: "Pending claim",
      });

      const result = await service.fileCounter(
        pending.id,
        "Filed by the release manager",
        { userId: managerId, role: "listener" },
      );
      expect(result.status).toBe("countered");
    } finally {
      await prisma.managementGrant.delete({ where: { id: grant.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: managerId } }).catch(() => {});
    }
  });
});
