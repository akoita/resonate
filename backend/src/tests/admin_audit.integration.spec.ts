/**
 * The one admin audit log (#2173) against a real Postgres: the writer, the
 * newest-first filtered listing, and that the admin actions that used to leave
 * only a console line (notices) now leave a durable record.
 */
import { prisma } from "../db/prisma";
import { ADMIN_AUDIT_ACTIONS, writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { AdminAuditService } from "../modules/admin_audit/admin_audit.service";
import { AuditService } from "../modules/audit/audit.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `admin_audit_${Date.now()}_`;
const ADMIN = `${TEST_PREFIX}admin`;
const OPERATOR = `${TEST_PREFIX}operator`;
const PERSON = `${TEST_PREFIX}person`;
const PERSON_TWO = `${TEST_PREFIX}person_two`;
const USER_IDS = [PERSON, PERSON_TWO];
const ACTORS = [ADMIN, OPERATOR, "system:test-source"];

const list = new AdminAuditService();
const notices = new NoticeService(new EventBus(), new AuditService());
const T0 = Date.parse("2026-10-24T12:00:00.000Z");

const forActor = (actor: string) => prisma.adminAuditEvent.findMany({ where: { actorUserId: actor }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  for (const id of USER_IDS) {
    await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  }
});

afterEach(async () => {
  await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: ACTORS } } });
  await prisma.notice.deleteMany({ where: { createdBy: { in: ACTORS } } });
});

afterAll(async () => {
  await prisma.notice.deleteMany({ where: { recipientUserId: { in: USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

describe("admin audit log (integration)", () => {
  describe("writer", () => {
    it("records a success by default and a denial when asked, with no free text", async () => {
      await writeAdminAuditEvent({ actorUserId: ADMIN, action: "user.detail_viewed", targetUserId: PERSON });
      await writeAdminAuditEvent({
        actorUserId: ADMIN,
        action: "admin.step_up_refused",
        outcome: "denied",
        detail: { reason: "signature_mismatch" },
      });
      const rows = await forActor(ADMIN);
      expect(rows.map((r) => [r.action, r.outcome])).toEqual([
        ["user.detail_viewed", "success"],
        ["admin.step_up_refused", "denied"],
      ]);
    });

    it("covers the actions written by services and names every other one in the same shape (#2362)", () => {
      expect([...ADMIN_AUDIT_ACTIONS]).toEqual(
        expect.arrayContaining([
          "account.closed",
          "account.suspended",
          "account.unsuspended",
          "admin.step_up_refused",
          "admin.step_up_verified",
          "agent_session.events_viewed",
          "notice.broadcast_sent",
          "notice.targeted_sent",
          "user.detail_viewed",
        ]),
      );
      expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
      for (const action of ADMIN_AUDIT_ACTIONS) expect(action).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
    });
  });

  describe("listing", () => {
    async function seed() {
      const rows = [
        { actorUserId: ADMIN, action: "account.suspended", targetUserId: PERSON, outcome: "success", offset: 0 },
        { actorUserId: ADMIN, action: "account.closed", targetUserId: PERSON_TWO, outcome: "success", offset: 1000 },
        { actorUserId: OPERATOR, action: "user.detail_viewed", targetUserId: PERSON, outcome: "success", offset: 2000 },
        { actorUserId: OPERATOR, action: "admin.step_up_refused", targetUserId: null, outcome: "denied", offset: 3000 },
      ];
      for (const { offset, ...row } of rows) {
        await prisma.adminAuditEvent.create({ data: { ...row, createdAt: new Date(T0 + offset) } });
      }
    }

    it("lists newest first with a total, and filters by actor, target, action, outcome and time", async () => {
      await seed();
      const all = await list.list({ actor: undefined } as any);
      const mine = all.items.filter((e) => ACTORS.includes(e.actorUserId));
      expect(mine.map((e) => e.action)).toEqual([
        "admin.step_up_refused",
        "user.detail_viewed",
        "account.closed",
        "account.suspended",
      ]);

      const byActor = await list.list({ actor: ADMIN });
      expect(byActor.total).toBe(2);
      expect(byActor.items.map((e) => e.action)).toEqual(["account.closed", "account.suspended"]);

      const byTarget = await list.list({ target: PERSON });
      expect(byTarget.items.map((e) => e.action)).toEqual(["user.detail_viewed", "account.suspended"]);

      const byAction = await list.list({ action: "account.closed", actor: ADMIN });
      expect(byAction.items).toHaveLength(1);

      const denied = await list.list({ outcome: "denied", actor: OPERATOR });
      expect(denied.items.map((e) => e.action)).toEqual(["admin.step_up_refused"]);
      expect(denied.items[0]).toMatchObject({ outcome: "denied", targetUserId: null, actorUserId: OPERATOR });

      const window = await list.list({
        actor: ADMIN,
        from: new Date(T0 + 500).toISOString(),
        to: new Date(T0 + 1500).toISOString(),
      });
      expect(window.items.map((e) => e.action)).toEqual(["account.closed"]);
    });

    it("pages, and caps the page size", async () => {
      await seed();
      const first = await list.list({ actor: OPERATOR, pageSize: 1 });
      const second = await list.list({ actor: OPERATOR, pageSize: 1, page: 2 });
      expect(first.total).toBe(2);
      expect(first.items.map((e) => e.action)).toEqual(["admin.step_up_refused"]);
      expect(second.items.map((e) => e.action)).toEqual(["user.detail_viewed"]);
      expect((await list.list({ pageSize: 5000 })).pageSize).toBe(100);
    });
  });

  describe("notices", () => {
    it("records a broadcast by identifiers only, never its words", async () => {
      const sent = await notices.sendBroadcast(
        { audience: "all", category: "policy", title: "A secret title", body: "A secret body" },
        { userId: ADMIN, role: "admin" },
      );
      const rows = await forActor(ADMIN);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "notice.broadcast_sent",
        outcome: "success",
        targetUserId: null,
        detail: { noticeId: sent.id, category: "policy", audience: "all" },
      });
      expect(JSON.stringify(rows[0].detail)).not.toContain("secret");
    });

    it("records a targeted send with the person when it is to one, and counts only", async () => {
      await notices.sendTargeted(
        { userIds: [PERSON], category: "account", title: "About you", body: "Private details" },
        { userId: OPERATOR, role: "operator" },
      );
      await notices.sendTargeted(
        { userIds: [PERSON, PERSON_TWO], category: "account", title: "About you two", body: "More details" },
        { userId: OPERATOR, role: "operator" },
      );
      const rows = await forActor(OPERATOR);
      expect(rows.map((r) => [r.action, r.targetUserId])).toEqual([
        ["notice.targeted_sent", PERSON],
        ["notice.targeted_sent", null],
      ]);
      expect(rows[1].detail).toEqual({ category: "account", recipientCount: 2, created: 2 });
      expect(JSON.stringify(rows)).not.toContain("details");
    });

    it("does not log notices the platform sends on its own as admin actions", async () => {
      await notices.sendTargeted(
        { userIds: [PERSON], category: "account", title: "Automatic", body: "From the system" },
        { userId: "system:test-source" },
      );
      expect(await forActor("system:test-source")).toHaveLength(0);
    });
  });
});
