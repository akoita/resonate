/**
 * #2146: an upheld takedown sends the creator exactly one `moderation` notice;
 * a re-resolve or replay sends nothing new; a rejected report sends nothing.
 * Real Postgres, real DmcaService + NoticeService.
 */
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { DmcaService } from "../modules/dmca/dmca.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `dmca_notice_${Date.now()}_`;
const artistUser = `${P}artist_user`;
const managerUser = `${P}manager`;
const artistId = `${P}artist`;
const ownRelease = `${P}own_release`;
const managedRelease = `${P}managed_release`;
const ownTrack = `${P}own_track`;
const managedTrack = `${P}managed_track`;
const rejectedTrack = `${P}rejected_track`;

const notices = new NoticeService(new EventBus(), new AuditService());
const dmca = new DmcaService(new UploadRightsRoutingService(), notices);

async function fileReport(trackId: string) {
  return dmca.fileReport({
    trackId,
    claimantName: "Complainant Person",
    claimantEmail: "complainant@example.com",
    originalWorkUrl: "https://example.com/original",
    reason: "complainant's private explanation",
  });
}

describe("DMCA takedown notice (integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [artistUser, managerUser].map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.artist.create({
      data: { id: artistId, userId: artistUser, displayName: "Takedown Artist", payoutAddress: "0x" + "e".repeat(40) },
    });
    await prisma.release.createMany({
      data: [
        { id: ownRelease, artistId, title: "Own Release", rightsRoute: "STANDARD_ESCROW", rightsSourceType: "direct_upload" },
        {
          id: managedRelease,
          artistId,
          title: "Managed Release",
          rightsRoute: "STANDARD_ESCROW",
          rightsSourceType: "direct_upload",
          managementOwnerUserId: managerUser,
        },
      ],
    });
    await prisma.track.createMany({
      data: [
        { id: ownTrack, title: "Own Track", releaseId: ownRelease },
        { id: managedTrack, title: "Managed Track", releaseId: managedRelease },
        { id: rejectedTrack, title: "Fine Track", releaseId: ownRelease },
      ],
    });
  });

  afterAll(async () => {
    const tracks = [ownTrack, managedTrack, rejectedTrack];
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: [artistUser, managerUser] } } });
    await prisma.dmcaReport.deleteMany({ where: { trackId: { in: tracks } } });
    await prisma.track.deleteMany({ where: { id: { in: tracks } } });
    await prisma.release.deleteMany({ where: { id: { in: [ownRelease, managedRelease] } } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [artistUser, managerUser] } } });
  });

  it("sends the artist exactly one notice when a report is upheld, even when resolved or replayed again", async () => {
    const report = await fileReport(ownTrack);
    await dmca.resolveReport(report.id, "upheld");

    const rows = await prisma.notice.findMany({ where: { dedupeKey: `dmca_report:${report.id}` } });
    expect(rows).toHaveLength(1);
    const [notice] = rows;
    expect(notice).toMatchObject({
      recipientUserId: artistUser,
      category: "moderation",
      audience: "user",
      createdBy: "system:dmca",
      link: "/help/platform-notices",
      title: "Your track was removed after a copyright complaint",
    });
    expect(notice.body).toContain('"Own Track"');
    expect(notice.body).toContain('"Own Release"');
    expect(notice.body).toContain("copyright complaint");
    // Never the complainant's identity, contact or words.
    expect(notice.body).not.toContain("Complainant Person");
    expect(notice.body).not.toContain("complainant@example.com");
    expect(notice.body).not.toContain("private explanation");

    await dmca.resolveReport(report.id, "upheld");
    await expect(notices.notifyDmcaTakedown(report.id)).resolves.toEqual({ recipientCount: 1, created: 0 });
    expect(await prisma.notice.count({ where: { dedupeKey: `dmca_report:${report.id}` } })).toBe(1);

    const listed = await notices.listForUser(artistUser, "listener");
    expect(listed.notices.map((n) => n.id)).toContain(notice.id);
  });

  it("notifies the management owner of a managed release, not the artist account", async () => {
    const report = await fileReport(managedTrack);
    await dmca.resolveReport(report.id, "upheld");
    const rows = await prisma.notice.findMany({ where: { dedupeKey: `dmca_report:${report.id}` } });
    expect(rows.map((row) => row.recipientUserId)).toEqual([managerUser]);
  });

  it("sends nothing when a report is rejected", async () => {
    const report = await fileReport(rejectedTrack);
    await dmca.resolveReport(report.id, "rejected");
    expect(await prisma.notice.count({ where: { dedupeKey: `dmca_report:${report.id}` } })).toBe(0);
    await expect(notices.notifyDmcaTakedown(report.id)).resolves.toBeNull();
  });
});
