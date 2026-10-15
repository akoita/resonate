/**
 * Platform notices (#2146) against real Postgres: broadcast resolution at read
 * time, role audiences, targeted privacy, per-user read state, expiry, and the
 * community moderation hook (exactly one notice per action, replay-safe).
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityModerationAssistService } from "../modules/community/community_moderation_assist.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `notices_${Date.now()}_`;
const earlyUser = `${TEST_PREFIX}early`;
const otherUser = `${TEST_PREFIX}other`;
const artistUser = `${TEST_PREFIX}artist_user`;
const authorUser = `${TEST_PREFIX}author`;
const reporterUser = `${TEST_PREFIX}reporter`;
const lateUser = `${TEST_PREFIX}late`;
const artistId = `${TEST_PREFIX}artist`;
const roomId = `${TEST_PREFIX}room`;
const operator = { userId: `${TEST_PREFIX}operator`, role: "operator" };

const eventBus = new EventBus();
const audit = new AuditService();
const notices = new NoticeService(eventBus, audit);
const rooms = new CommunityRoomsService(
  new CommunityEligibilityService(eventBus),
  eventBus,
  new CommunityModerationAssistService(),
);

async function waitFor<T>(probe: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const createdNoticeIds: string[] = [];

describe("NoticeService integration", () => {
  beforeAll(async () => {
    notices.onModuleInit();
    await prisma.user.createMany({
      data: [earlyUser, otherUser, artistUser, authorUser, reporterUser].map((id) => ({
        id,
        email: `${id}@test.resonate`,
      })),
    });
    await prisma.artist.create({
      data: { id: artistId, userId: artistUser, displayName: "Notice Artist", payoutAddress: "0x" + "3".repeat(40) },
    });
    await prisma.communityRoom.create({
      data: { id: roomId, roomType: "artist_holder", ownerType: "artist", ownerId: artistId, artistId, title: "Night Owls" },
    });
    await prisma.communityMembership.createMany({
      data: [
        { roomId, userId: authorUser },
        { roomId, userId: reporterUser },
      ],
    });
  });

  afterAll(async () => {
    notices.onModuleDestroy();
    const users = [earlyUser, otherUser, artistUser, authorUser, reporterUser, lateUser];
    await prisma.noticeRead.deleteMany({ where: { userId: { in: users } } });
    await prisma.notice.deleteMany({
      where: { OR: [{ id: { in: createdNoticeIds } }, { recipientUserId: { in: users } }, { createdBy: operator.userId }] },
    });
    await prisma.communityModerationReport.deleteMany({ where: { roomId } });
    await prisma.communityMessage.deleteMany({ where: { roomId } });
    await prisma.communityMembership.deleteMany({ where: { roomId } });
    await prisma.communityRoom.deleteMany({ where: { id: roomId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  it("shows an operator broadcast to an existing user and to a user created after it, with per-user read state", async () => {
    const broadcast = await notices.sendBroadcast(
      { audience: "all", category: "policy", title: `${TEST_PREFIX} Policy update`, body: "We updated the policy." },
      operator,
    );
    createdNoticeIds.push(broadcast.id);

    await prisma.user.create({ data: { id: lateUser, email: `${lateUser}@test.resonate` } });

    for (const userId of [earlyUser, lateUser]) {
      const list = await notices.listForUser(userId, "listener");
      const found = list.notices.find((n) => n.id === broadcast.id);
      expect(found).toMatchObject({ kind: "broadcast", category: "policy", readAt: null });
      expect(list.unreadCount).toBeGreaterThanOrEqual(1);
    }

    const before = (await notices.listForUser(earlyUser, "listener")).unreadCount;
    await notices.markRead(earlyUser, "listener", broadcast.id);
    await notices.markRead(earlyUser, "listener", broadcast.id); // idempotent
    const early = await notices.listForUser(earlyUser, "listener");
    expect(early.notices.find((n) => n.id === broadcast.id)?.readAt).toEqual(expect.any(String));
    expect(early.unreadCount).toBe(before - 1);

    // Read state is per user: the late user still has it unread.
    const late = await notices.listForUser(lateUser, "listener");
    expect(late.notices.find((n) => n.id === broadcast.id)?.readAt).toBeNull();
  });

  it("reaches only the targeted role audience", async () => {
    const forOperators = await notices.sendBroadcast(
      { audience: "role:operator", category: "incident", title: `${TEST_PREFIX} Ops incident`, body: "Ops only." },
      operator,
    );
    const forArtists = await notices.sendBroadcast(
      { audience: "role:artist", category: "terms", title: `${TEST_PREFIX} Artist terms`, body: "Artists only." },
      operator,
    );
    createdNoticeIds.push(forOperators.id, forArtists.id);

    const listenerIds = (await notices.listForUser(earlyUser, "listener")).notices.map((n) => n.id);
    expect(listenerIds).not.toContain(forOperators.id);
    expect(listenerIds).not.toContain(forArtists.id);

    const operatorIds = (await notices.listForUser(otherUser, "operator")).notices.map((n) => n.id);
    expect(operatorIds).toContain(forOperators.id);
    expect(operatorIds).not.toContain(forArtists.id);

    // An artist's session carries the listener role; the artist profile is the audience signal.
    const artistIds = (await notices.listForUser(artistUser, "listener")).notices.map((n) => n.id);
    expect(artistIds).toContain(forArtists.id);
    expect(artistIds).not.toContain(forOperators.id);

    await expect(notices.markRead(earlyUser, "listener", forOperators.id)).rejects.toThrow(NotFoundException);
  });

  it("hides an expired broadcast", async () => {
    const broadcast = await notices.sendBroadcast(
      {
        audience: "all",
        category: "incident",
        title: `${TEST_PREFIX} Short incident`,
        body: "Resolved soon.",
        expiresAt: new Date(Date.now() + 60_000),
      },
      operator,
    );
    createdNoticeIds.push(broadcast.id);
    expect((await notices.listForUser(earlyUser, "listener")).notices.map((n) => n.id)).toContain(broadcast.id);

    await prisma.notice.update({ where: { id: broadcast.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await notices.listForUser(earlyUser, "listener")).notices.map((n) => n.id)).not.toContain(broadcast.id);
    await expect(notices.markRead(earlyUser, "listener", broadcast.id)).rejects.toThrow(NotFoundException);
  });

  it("shows a targeted notice only to its recipient", async () => {
    const auditSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await notices.sendTargeted(
      { userIds: [earlyUser], category: "account", title: "Your account", body: "Private body for one person." },
      operator,
    );
    expect(result).toEqual({ recipientCount: 1, created: 1 });
    const logged = auditSpy.mock.calls.map((call) => String(call[0])).join("\n");
    auditSpy.mockRestore();
    expect(logged).toContain("notice.sent");
    expect(logged).not.toContain("Private body for one person.");

    const mine = (await notices.listForUser(earlyUser, "listener")).notices.find((n) => n.title === "Your account");
    expect(mine).toMatchObject({ kind: "targeted", category: "account", body: "Private body for one person." });

    const theirs = await notices.listForUser(otherUser, "admin");
    expect(theirs.notices.map((n) => n.id)).not.toContain(mine!.id);
    await expect(notices.markRead(otherUser, "admin", mine!.id)).rejects.toThrow(NotFoundException);
    expect(await prisma.noticeRead.count({ where: { noticeId: mine!.id } })).toBe(0);
  });

  it("rejects a targeted send naming a user that does not exist", async () => {
    await expect(
      notices.sendTargeted(
        { userIds: [earlyUser, `${TEST_PREFIX}ghost`], category: "account", title: "t", body: "b" },
        operator,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.notice.count({ where: { recipientUserId: earlyUser, title: "t" } })).toBe(0);
  });

  it("sends exactly one moderation notice to the author when a moderator removes their message, even on replay", async () => {
    const message = await prisma.communityMessage.create({
      data: { roomId, authorId: authorUser, body: "something reported" },
    });
    const report = await prisma.communityModerationReport.create({
      data: { roomId, messageId: message.id, reporterUserId: reporterUser, reason: "reporter's private words" },
    });

    await rooms.resolveModerationReport({ userId: operator.userId, role: "admin" }, report.id, {
      action: "delete_message",
      note: "internal operator note",
    });

    const authorNotices = await waitFor(
      () => prisma.notice.findMany({ where: { recipientUserId: authorUser, category: "moderation" } }),
      (rows) => rows.length > 0,
    );
    expect(authorNotices).toHaveLength(1);
    const [notice] = authorNotices;
    expect(notice.title).toBe("Your community message was removed");
    expect(notice.body).toContain('"Night Owls"');
    expect(notice.body).toContain("community guidelines");
    expect(notice.body).not.toContain("reporter's private words");
    expect(notice.body).not.toContain("internal operator note");
    expect(notice.createdBy).toBe("system:community-moderation");
    expect(notice.link).toBe("/help/platform-notices");

    // Nobody else is told.
    expect(await prisma.notice.count({ where: { dedupeKey: `community_moderation_report:${report.id}` } })).toBe(1);
    const reporterList = await notices.listForUser(reporterUser, "listener");
    expect(reporterList.notices.map((n) => n.id)).not.toContain(notice.id);

    // A replayed event (or a direct re-run) creates nothing new.
    eventBus.publish({
      eventName: "community.moderation_action_taken",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: operator.userId,
      reportId: report.id,
      roomId,
      messageId: message.id,
      action: "delete_message",
      outcome: "resolved",
      hasOperatorNote: true,
    });
    const replay = await notices.notifyCommunityModerationAction({ reportId: report.id, action: "delete_message" });
    expect(replay).toEqual({ recipientCount: 1, created: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await prisma.notice.count({ where: { recipientUserId: authorUser, category: "moderation" } })).toBe(1);
  });

  it("sends nothing for a no-action resolution", async () => {
    const message = await prisma.communityMessage.create({
      data: { roomId, authorId: authorUser, body: "fine message" },
    });
    const report = await prisma.communityModerationReport.create({
      data: { roomId, messageId: message.id, reporterUserId: reporterUser, reason: "not actually bad" },
    });
    await rooms.resolveModerationReport({ userId: operator.userId, role: "admin" }, report.id, { action: "no_action" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await prisma.notice.count({ where: { dedupeKey: `community_moderation_report:${report.id}` } })).toBe(0);
  });
});
