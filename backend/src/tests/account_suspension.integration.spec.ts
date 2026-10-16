/**
 * Operator account suspension and closure (#2147) against real Postgres,
 * through a Nest app wired like production: the global RolesGuard, the global
 * AccountStatusInterceptor, the real admin/account/notice controllers and the
 * real services. Only the probe routes are stand-ins for "some mutating route".
 */
import { Controller, Get, INestApplication, Post, Req, UseGuards } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule, AuthGuard } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { applyGlobalValidation } from "../config/validation";
import { prisma } from "../db/prisma";
import { AccountStatusInterceptor } from "../modules/accounts/account_status.interceptor";
import { AccountStandingService } from "../modules/accounts/account_standing.service";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { AccountController, AdminAccountsController } from "../modules/accounts/accounts.controller";
import { AllowWhileSuspended } from "../modules/accounts/allow_while_suspended.decorator";
import { AuditService } from "../modules/audit/audit.service";
import { JwtStrategy } from "../modules/auth/jwt.strategy";
import { RolesGuard } from "../modules/auth/roles.guard";
import { NoticeController } from "../modules/notifications/notice.controller";
import { NoticeService } from "../modules/notifications/notice.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { EventBus } from "../modules/shared/event_bus";
import { TEST_JWT_SECRET, authToken } from "./e2e-helpers";

const TEST_PREFIX = `acct_susp_${Date.now()}_`;
const admin = `${TEST_PREFIX}admin`;
const otherAdmin = `${TEST_PREFIX}admin2`;
const user = `${TEST_PREFIX}user`;
const user2 = `${TEST_PREFIX}user2`;
const walletUser = `0x${"ab".repeat(20)}`;
const NOTE = "SECRET operator note about the case";

@Controller("probe")
class ProbeController {
  @UseGuards(AuthGuard("jwt"))
  @Post("write")
  write() {
    return { ok: true };
  }

  @UseGuards(AuthGuard("jwt"))
  @AllowWhileSuspended()
  @Post("refund")
  refund() {
    return { refunded: true };
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("read")
  read(@Req() req: any) {
    return { userId: req.user.userId };
  }

  @Post("anonymous")
  anonymous() {
    return { ok: true };
  }
}

describe("account suspension (integration)", () => {
  let app: INestApplication;
  let accounts: AccountStatusService;
  const audit = new AuditService();
  const originalAdmins = process.env.ADMIN_ADDRESSES;

  const as = (id: string, role = "listener") => ({ Authorization: `Bearer ${authToken(id, role)}` });
  const server = () => app.getHttpServer();
  const suspend = (target: string, body: Record<string, unknown> = { reason: "terms_violation" }) =>
    request(server()).post(`/admin/accounts/${target}/suspend`).set(as(admin, "admin")).send(body);
  const targetedNotices = () =>
    prisma.notice.findMany({ where: { recipientUserId: user, category: "account" }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    process.env.ADMIN_ADDRESSES = otherAdmin;
    await prisma.user.createMany({
      data: [admin, otherAdmin, user, user2, walletUser].map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.wallet.create({
      data: { userId: walletUser, address: walletUser, chainId: 31337 },
    });

    const eventBus = new EventBus();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [() => ({ JWT_SECRET: TEST_JWT_SECRET })] }),
        PassportModule.register({ defaultStrategy: "jwt" }),
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { expiresIn: "1h" } }),
      ],
      controllers: [ProbeController, NoticeController, AdminAccountsController, AccountController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: AccountStatusInterceptor },
        AccountStatusService,
        AccountStandingService,
        NoticeService,
        AccountClosureService,
        { provide: AuditService, useValue: audit },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalValidation(app);
    await app.init();
    accounts = app.get(AccountStatusService);
  });

  afterAll(async () => {
    const ids = [admin, otherAdmin, user, user2, walletUser];
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.noticeRead.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: ids } } });
    await prisma.wallet.deleteMany({ where: { userId: walletUser } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (originalAdmins === undefined) delete process.env.ADMIN_ADDRESSES;
    else process.env.ADMIN_ADDRESSES = originalAdmins;
    await app.close();
  });

  beforeEach(async () => {
    await prisma.user.updateMany({
      where: { id: { in: [user, user2, walletUser] } },
      data: {
        accountStatus: "active",
        accountStatusReason: null,
        accountStatusUntil: null,
        accountStatusChangedAt: null,
        accountStatusChangedBy: null,
      },
    });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: [user, user2] } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: [user, user2, walletUser] } } });
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: admin } });
    accounts.clearCache();
  });

  it("lets an active account write", async () => {
    await request(server()).post("/probe/write").set(as(user)).expect(201);
  });

  describe("a suspended account", () => {
    beforeEach(async () => {
      await suspend(user).expect(200);
    });

    it("gets 403 account_suspended on a mutating route, but can still read (200)", async () => {
      const res = await request(server()).post("/probe/write").set(as(user)).expect(403);
      expect(res.body.code).toBe("account_suspended");
      expect(res.body.message).toMatch(/suspended/i);
      await request(server()).get("/probe/read").set(as(user)).expect(200);
    });

    it("is not blocked on routes marked @AllowWhileSuspended (refund-style)", async () => {
      await request(server()).post("/probe/refund").set(as(user)).expect(201);
    });

    it("can still read notices and mark them read", async () => {
      const list = await request(server()).get("/notices").set(as(user)).expect(200);
      expect(list.body.notices).toHaveLength(1);
      await request(server()).post(`/notices/${list.body.notices[0].id}/read`).set(as(user)).expect(200);
    });

    it("sees its own state at GET /account/status", async () => {
      const res = await request(server()).get("/account/status").set(as(user)).expect(200);
      expect(res.body).toMatchObject({ status: "suspended", reason: "terms_violation", until: null, erasureScheduledFor: null });
    });

    it("does not affect other accounts or unauthenticated routes", async () => {
      await request(server()).post("/probe/write").set(as(user2)).expect(201);
      await request(server()).post("/probe/anonymous").expect(201);
    });

    it("unsuspend restores access immediately", async () => {
      await request(server()).post(`/admin/accounts/${user}/unsuspend`).set(as(admin, "admin")).send({}).expect(200);
      await request(server()).post("/probe/write").set(as(user)).expect(201);
    });
  });

  it("a suspension past its end date counts as active", async () => {
    await suspend(user, {
      reason: "abuse",
      until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }).expect(200);
    await request(server()).post("/probe/write").set(as(user)).expect(403);

    // Lazy expiry: move the end into the past and drop the cache.
    await prisma.user.update({ where: { id: user }, data: { accountStatusUntil: new Date(Date.now() - 1000) } });
    accounts.clearCache();
    await request(server()).post("/probe/write").set(as(user)).expect(201);
    const status = await request(server()).get("/account/status").set(as(user)).expect(200);
    expect(status.body.status).toBe("active");
  });

  it("includes the end date in the 403 for a timed suspension", async () => {
    const until = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    await suspend(user, { reason: "abuse", until }).expect(200);
    const res = await request(server()).post("/probe/write").set(as(user)).expect(403);
    expect(res.body.until).toBe(until);
  });

  it("an out-of-process change is picked up once the cache is dropped", async () => {
    await request(server()).post("/probe/write").set(as(user)).expect(201);
    await prisma.user.update({ where: { id: user }, data: { accountStatus: "suspended" } });
    // Still cached as active for up to 30 s ...
    await request(server()).post("/probe/write").set(as(user)).expect(201);
    accounts.clearCache();
    await request(server()).post("/probe/write").set(as(user)).expect(403);
  });

  describe("notice and audit", () => {
    it("sends exactly one account notice per change, with the reason category and never the note", async () => {
      await suspend(user, { reason: "fraud", note: NOTE }).expect(200);
      let notices = await targetedNotices();
      expect(notices).toHaveLength(1);
      expect(notices[0].title).toMatch(/suspended/i);
      expect(notices[0].body).toMatch(/suspected fraud/);
      expect(notices[0].body).toMatch(/refund/);
      expect(notices[0].body).toMatch(/appeal/i);
      expect(JSON.stringify(notices)).not.toContain("SECRET");

      await request(server()).post(`/admin/accounts/${user}/unsuspend`).set(as(admin, "admin")).send({ note: NOTE }).expect(200);
      notices = await targetedNotices();
      expect(notices).toHaveLength(2);
      expect(notices[1].dedupeKey).toMatch(new RegExp(`^account_status:${user}:`));
      expect(notices[0].dedupeKey).not.toBe(notices[1].dedupeKey);
      expect(JSON.stringify(notices)).not.toContain("SECRET");
    });

    it("audits who, target, action and reason, keeping the note in the audit record only", async () => {
      await suspend(user, { reason: "abuse", note: NOTE }).expect(200);
      const entry = audit
        .list()
        .filter((e) => e.action === "account.suspended" && e.resource === `account:${user}`)
        .pop();
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        actorId: admin,
        metadata: { targetUserId: user, reason: "abuse", note: NOTE },
      });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user } });
      expect(row).toMatchObject({ accountStatus: "suspended", accountStatusReason: "abuse", accountStatusChangedBy: admin });
      expect(JSON.stringify(row)).not.toContain("SECRET");
    });
  });

  describe("durable admin audit trail (#2166)", () => {
    it("writes one AdminAuditEvent per status action, with the reason category and never the note", async () => {
      await suspend(user, { reason: "abuse", note: NOTE }).expect(200);
      await request(server()).post(`/admin/accounts/${user}/unsuspend`).set(as(admin, "admin")).send({ note: NOTE }).expect(200);
      await request(server())
        .post(`/admin/accounts/${user}/close`)
        .set(as(admin, "admin"))
        .send({ reason: "fraud", note: NOTE })
        .expect(200);

      const events = await prisma.adminAuditEvent.findMany({
        where: { targetUserId: user },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((e) => e.action)).toEqual(["account.suspended", "account.unsuspended", "account.closed"]);
      for (const event of events) expect(event.actorUserId).toBe(admin);
      expect(events[0].detail).toMatchObject({ reason: "abuse", until: null });
      expect(events[2].detail).toMatchObject({ reason: "fraud", scheduleErasure: false });
      expect(JSON.stringify(events)).not.toContain("SECRET");
    });

    it("writes nothing for a refused action", async () => {
      await suspend(admin).expect(403);
      await suspend(`${TEST_PREFIX}nobody`).expect(404);
      expect(await prisma.adminAuditEvent.count({ where: { actorUserId: admin } })).toBe(0);
    });
  });

  describe("closure", () => {
    it("closes an account (403 account_closed on writes, reads and refunds still work)", async () => {
      await request(server())
        .post(`/admin/accounts/${user}/close`)
        .set(as(admin, "admin"))
        .send({ reason: "terms_violation" })
        .expect(200);
      const res = await request(server()).post("/probe/write").set(as(user)).expect(403);
      expect(res.body.code).toBe("account_closed");
      await request(server()).get("/probe/read").set(as(user)).expect(200);
      await request(server()).post("/probe/refund").set(as(user)).expect(201);
      expect(await prisma.accountClosureRequest.count({ where: { userId: user } })).toBe(0);
    });

    it("close + scheduleErasure creates a pending erasure request the person cannot cancel", async () => {
      const res = await request(server())
        .post(`/admin/accounts/${user}/close`)
        .set(as(admin, "admin"))
        .send({ reason: "fraud", scheduleErasure: true, note: NOTE })
        .expect(200);
      expect(res.body.erasureScheduledFor).toEqual(expect.any(String));
      const pending = await prisma.accountClosureRequest.findFirst({ where: { userId: user, status: "pending" } });
      expect(pending).not.toBeNull();
      const own = await request(server()).get("/account/status").set(as(user)).expect(200);
      expect(own.body).toMatchObject({ status: "closed", erasureScheduledFor: pending!.dueAt.toISOString() });
      expect(pending!.reason).not.toContain("SECRET");
      const windowMs = pending!.dueAt.getTime() - pending!.requestedAt.getTime();
      expect(windowMs).toBe(30 * 24 * 3600 * 1000);

      // Neither a sign-in nor the cancel route may undo an operator closure.
      const closures = app.get(AccountClosureService);
      expect(await closures.cancel(user)).toBeNull();
      expect(await prisma.accountClosureRequest.count({ where: { userId: user, status: "pending" } })).toBe(1);

      const notices = await targetedNotices();
      expect(notices).toHaveLength(1);
      expect(notices[0].body).toMatch(/erased on/);
      expect(notices[0].body).not.toContain("SECRET");
    });

    it("cannot be suspended again once closed", async () => {
      await request(server()).post(`/admin/accounts/${user}/close`).set(as(admin, "admin")).send({ reason: "abuse" }).expect(200);
      await suspend(user).expect(409);
    });
  });

  describe("admin rules", () => {
    it("resolves a wallet address to its account", async () => {
      const res = await suspend(walletUser.toUpperCase().replace("0X", "0x")).expect(200);
      expect(res.body.userId).toBe(walletUser);
    });

    it("404s for an unknown account", async () => {
      await suspend(`${TEST_PREFIX}nobody`).expect(404);
    });

    it("refuses to suspend the acting admin or another admin (403)", async () => {
      await suspend(admin).expect(403);
      await suspend(otherAdmin).expect(403);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: otherAdmin } });
      expect(row.accountStatus).toBe("active");
    });

    it("unsuspend of an active account is a 409", async () => {
      await request(server()).post(`/admin/accounts/${user}/unsuspend`).set(as(admin, "admin")).send({}).expect(409);
    });

    it("reports an account's state to an admin", async () => {
      await suspend(user, { reason: "other" }).expect(200);
      const res = await request(server()).get(`/admin/accounts/${user}/status`).set(as(admin, "admin")).expect(200);
      expect(res.body).toMatchObject({ userId: user, status: "suspended", effectiveStatus: "suspended", reason: "other", changedBy: admin });
    });
  });
});
