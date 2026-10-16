/**
 * Email notices (#2169) against real Postgres with the development log
 * transport: double opt-in, fan-out audiences, exactly-once sending, retry and
 * bounce handling, unsubscribe, and retention.
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import {
  CONFIRMATION_MAX_PER_WINDOW,
  CONFIRMATION_WINDOW_MS,
  ContactEmailService,
} from "../modules/email/contact_email.service";
import { EmailConfig } from "../modules/email/email_config";
import {
  EMAIL_DELIVERY_RETENTION_DAYS,
  EMAIL_MAX_ATTEMPTS,
  EmailDeliveryService,
} from "../modules/email/email_delivery.service";
import { signUnsubscribeToken } from "../modules/email/email_tokens";
import { LogEmailTransport, PermanentEmailError } from "../modules/email/email_transport";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `email_notices_${Date.now()}_`;
const SECRET = "integration-signing-secret";
const DAY_MS = 86_400_000;

const name = (n: string) => `${TEST_PREFIX}${n}`;
const addressOf = (n: string) => `${TEST_PREFIX}${n}@mail.example`;

const U = {
  listener: name("listener"),
  artist: name("artist_user"),
  operator: name("operator"),
  operatorWallet: name("operator_wallet"),
  admin: name("admin"),
  pending: name("pending"),
  optout: name("optout"),
  bare: name("bare"),
  erased: name("erased"),
  flow: name("flow"),
  retry: name("retry"),
  bounce: name("bounce"),
  hook: name("hook"),
  hookPending: name("hook_pending"),
  complaint: name("complaint"),
  soft: name("soft"),
  unsub: name("unsub"),
  rate: name("rate"),
};
const OPERATOR_WALLET = "0x" + "0e".repeat(20);

const config = new EmailConfig({
  NODE_ENV: "test",
  FRONTEND_URL: "https://app.example.test",
  PUBLIC_API_URL: "https://api.example.test",
  EMAIL_LINK_SIGNING_SECRET: SECRET,
});
const transport = new LogEmailTransport();
const notices = new NoticeService(new EventBus(), new AuditService());
const contacts = new ContactEmailService(config, transport, notices);
const delivery = new EmailDeliveryService(config, transport, contacts);
// The confirmation limiter reads this clock. By default every read is a day later than the last, so
// tests that set addresses repeatedly never meet the cooldown; the rate-limit tests pin it.
const DEFAULT_CLOCK = () => new Date((defaultClockMs += 25 * 3_600_000));
let defaultClockMs = Date.now();
contacts.clock = DEFAULT_CLOCK;
const actor = { userId: name("operator_actor"), role: "operator" };

const trackedNoticeIds: string[] = [];
let counter = 0;

async function targeted(userId: string, category: string, title = `Targeted ${++counter}`) {
  await notices.sendTargeted({ userIds: [userId], category: category as never, title, body: `Body of ${title}` }, actor);
  const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: userId, title } });
  trackedNoticeIds.push(notice.id);
  return notice.id;
}

async function broadcast(audience: string, category: string) {
  const result = await notices.sendBroadcast(
    { audience: audience as never, category: category as never, title: `Broadcast ${++counter}`, body: "Broadcast body" },
    actor,
  );
  trackedNoticeIds.push(result.id);
  return result.id;
}

async function recipientsOf(noticeId: string): Promise<string[]> {
  const rows = await prisma.emailDelivery.findMany({ where: { noticeId }, select: { userId: true } });
  return rows.map((r) => r.userId).sort();
}

function lastTokenIn(message: { text: string }, path: string): string {
  const match = new RegExp(`${path}\\?token=([^\\s]+)`).exec(message.text);
  if (!match) throw new Error(`no ${path} link in the message`);
  return decodeURIComponent(match[1]);
}

/** Set an address and confirm it from the emailed link, the way a person would. */
async function confirmed(userId: string) {
  await contacts.setAddress(userId, addressOf(userId.slice(TEST_PREFIX.length)));
  const mail = transport.sent[transport.sent.length - 1];
  await contacts.confirm(lastTokenIn(mail, "email/confirm"));
}

async function expectRejects(promise: Promise<unknown>, type: new (...a: never[]) => Error) {
  await expect(promise).rejects.toBeInstanceOf(type);
}

const savedEnv = { admin: process.env.ADMIN_ADDRESSES, operator: process.env.OPERATOR_ADDRESSES };

describe("email notices integration", () => {
  beforeAll(async () => {
    // Structured logs and audit lines are noise here; log content is asserted in unit specs.
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.ADMIN_ADDRESSES = U.admin;
    process.env.OPERATOR_ADDRESSES = `${U.operator},${OPERATOR_WALLET}`;

    await prisma.user.createMany({
      data: Object.values(U).map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.user.update({ where: { id: U.erased }, data: { erasedAt: new Date() } });
    await prisma.artist.create({
      data: { id: name("artist"), userId: U.artist, displayName: "Email Artist", payoutAddress: "0x" + "3".repeat(40) },
    });
    await prisma.wallet.create({
      data: { id: name("wallet"), userId: U.operatorWallet, address: OPERATOR_WALLET, chainId: 11155111, salt: name("salt") },
    });
    // Other specs' notices must not compete with this spec's fan-out.
    await prisma.notice.updateMany({ where: { emailFannedOutAt: null }, data: { emailFannedOutAt: new Date() } });

    for (const id of [U.listener, U.artist, U.operator, U.operatorWallet, U.admin, U.optout, U.flow, U.retry]) {
      await confirmed(id);
    }
    // The erased account's address row exists only to prove it is never mailed.
    await prisma.contactEmail.create({
      data: { userId: U.erased, address: addressOf("erased"), addressNormalized: addressOf("erased"), status: "confirmed" },
    });
    await contacts.setPreferences(U.optout, ["policy"]);
    // `pending` has an address that was never confirmed.
    await contacts.setAddress(U.pending, addressOf("pending"));
  }, 60000);

  afterAll(async () => {
    process.env.ADMIN_ADDRESSES = savedEnv.admin;
    process.env.OPERATOR_ADDRESSES = savedEnv.operator;
    if (savedEnv.admin === undefined) delete process.env.ADMIN_ADDRESSES;
    if (savedEnv.operator === undefined) delete process.env.OPERATOR_ADDRESSES;
    await prisma.notice.deleteMany({ where: { OR: [{ id: { in: trackedNoticeIds } }, { createdBy: { startsWith: "system:email-delivery" }, recipientUserId: { startsWith: TEST_PREFIX } }] } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    transport.sent.length = 0;
    transport.failWith = null;
  });

  describe("double opt-in", () => {
    it("never emails an address that is still pending", async () => {
      expect((await contacts.getState(U.pending)).status).toBe("pending");
      const id = await targeted(U.pending, "account");
      await delivery.run();
      expect(await recipientsOf(id)).toEqual([]);
      expect(transport.sent.find((m) => m.to === addressOf("pending"))).toBeUndefined();
    });

    it("sent the confirmation to the address with a link and no unsubscribe", async () => {
      await contacts.setAddress(U.bare, addressOf("bare"));
      expect(transport.sent).toHaveLength(1);
      expect(transport.sent[0].to).toBe(addressOf("bare"));
      expect(transport.sent[0].text).toContain("https://app.example.test/email/confirm?token=");
      expect(transport.sent[0].headers).toBeUndefined();
      const state = await contacts.getState(U.bare);
      expect(state).toMatchObject({ available: true, status: "pending", address: addressOf("bare") });
      expect(state.confirmationSentAt).not.toBeNull();
      const row = await prisma.contactEmail.findUniqueOrThrow({ where: { userId: U.bare } });
      // Only a hash is stored; the raw token exists only in the email.
      expect(row.confirmTokenHash).not.toBeNull();
      expect(JSON.stringify(row)).not.toContain(lastTokenIn(transport.sent[0], "email/confirm"));
    });

    it("confirms with a valid token once; a used token is rejected", async () => {
      const token = lastTokenIn(
        (await contacts.resend(U.bare), transport.sent[transport.sent.length - 1]),
        "email/confirm",
      );
      await expect(contacts.confirm(token)).resolves.toEqual({ status: "confirmed" });
      expect(await contacts.getState(U.bare)).toMatchObject({ status: "confirmed" });
      await expectRejects(contacts.confirm(token), BadRequestException);
      await expect(contacts.confirm(token)).rejects.toMatchObject({ response: { code: "invalid_or_expired" } });
    });

    it("rejects an expired or unknown token", async () => {
      await contacts.setAddress(U.bare, addressOf("bare_2"));
      const token = lastTokenIn(transport.sent[transport.sent.length - 1], "email/confirm");
      await prisma.contactEmail.update({ where: { userId: U.bare }, data: { confirmTokenExpiresAt: new Date(Date.now() - 1000) } });
      await expectRejects(contacts.confirm(token), BadRequestException);
      await expectRejects(contacts.confirm("x".repeat(43)), BadRequestException);
      await expectRejects(contacts.confirm(undefined), BadRequestException);
      expect((await contacts.getState(U.bare)).status).toBe("pending");
    });

    it("an address change invalidates the old token and keeps the opt-outs", async () => {
      await contacts.setAddress(U.bare, addressOf("bare_3"));
      const oldToken = lastTokenIn(transport.sent[transport.sent.length - 1], "email/confirm");
      await contacts.setPreferences(U.bare, ["refund"]);
      await contacts.setAddress(U.bare, addressOf("bare_4"));
      const newToken = lastTokenIn(transport.sent[transport.sent.length - 1], "email/confirm");
      expect(transport.sent[transport.sent.length - 1].to).toBe(addressOf("bare_4"));
      await expectRejects(contacts.confirm(oldToken), BadRequestException);
      await expect(contacts.confirm(newToken)).resolves.toEqual({ status: "confirmed" });
      const state = await contacts.getState(U.bare);
      expect(state.categories.find((c) => c.category === "refund")?.enabled).toBe(false);
    });

    it("setting the same confirmed address again is a no-op that sends nothing", async () => {
      transport.sent.length = 0;
      const state = await contacts.setAddress(U.bare, addressOf("bare_4").toUpperCase());
      expect(state.status).toBe("confirmed");
      expect(transport.sent).toHaveLength(0);
    });

    it("resend is a conflict unless the address is pending", async () => {
      await expect(contacts.resend(U.bare)).rejects.toBeInstanceOf(ConflictException);
      await expect(contacts.resend(name("nobody"))).rejects.toBeInstanceOf(ConflictException);
    });

    it("keeps a pending row and answers 502 when the confirmation cannot be sent, then resend works", async () => {
      transport.failWith = new Error("smtp down");
      await expectRejects(contacts.setAddress(U.hook, addressOf("hook")), BadGatewayException);
      expect(await contacts.getState(U.hook)).toMatchObject({ status: "pending", confirmationSentAt: null });
      transport.failWith = null;
      const state = await contacts.resend(U.hook);
      expect(state.confirmationSentAt).not.toBeNull();
      await contacts.remove(U.hook);
    });

    it("answers 503 for set and resend when email is unavailable, but removal still works", async () => {
      const off = new ContactEmailService(new EmailConfig({ NODE_ENV: "production" }), null, notices);
      expect((await off.getState(U.listener)).available).toBe(false);
      await expectRejects(off.setAddress(U.listener, "x@y.example"), ServiceUnavailableException);
      await expect(off.resend(U.pending)).rejects.toMatchObject({ response: { code: "email_unavailable" } });
      await off.remove(name("never_existed"));
    });

    it("removes the address and its preferences", async () => {
      await contacts.remove(U.bare);
      expect(await contacts.getState(U.bare)).toMatchObject({ status: "none", address: null });
      expect(await prisma.contactEmail.count({ where: { userId: U.bare } })).toBe(0);
    });

    it("rejects opting out of a required category and unknown categories", async () => {
      for (const optOuts of [["terms"], ["account"], ["policy", "terms"]]) {
        await expect(contacts.setPreferences(U.listener, optOuts)).rejects.toMatchObject({
          response: { code: "required_category" },
        });
      }
      await expectRejects(contacts.setPreferences(U.listener, ["bogus"]), BadRequestException);
      await expectRejects(contacts.setPreferences(U.listener, "policy"), BadRequestException);
      expect((await contacts.getState(U.listener)).categories.filter((c) => c.required).map((c) => c.category)).toEqual(["terms", "account"]);
    });
  });

  describe("fan-out audiences", () => {
    it("emails a targeted notice to its confirmed recipient exactly once, and a replay sends nothing", async () => {
      const id = await targeted(U.listener, "refund");
      const first = await delivery.run();
      expect(first).toMatchObject({ enabled: true, fannedOutNotices: 1, queued: 1, sent: 1, failed: 0 });
      expect(await recipientsOf(id)).toEqual([U.listener]);
      const mail = transport.sent.filter((m) => m.to === addressOf("listener"));
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toMatch(/^Targeted /);
      expect(mail[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const row = await prisma.emailDelivery.findFirstOrThrow({ where: { noticeId: id } });
      expect(row).toMatchObject({ status: "sent", attempts: 1, category: "refund" });
      expect(row.sentAt).not.toBeNull();
      expect(row.providerMessageId).toMatch(/^log-/);

      transport.sent.length = 0;
      const second = await delivery.run();
      expect(second).toMatchObject({ fannedOutNotices: 0, queued: 0, sent: 0 });
      expect(transport.sent).toHaveLength(0);
      // Even if the marker were lost, the unique key keeps it to one row.
      await prisma.notice.update({ where: { id }, data: { emailFannedOutAt: null } });
      const third = await delivery.run();
      expect(third).toMatchObject({ fannedOutNotices: 1, queued: 0, sent: 0 });
      expect(await prisma.emailDelivery.count({ where: { noticeId: id } })).toBe(1);
    });

    it("sends an all-audience broadcast to every confirmed address, not pending, bare or erased accounts", async () => {
      const id = await broadcast("all", "incident");
      await delivery.run();
      const recipients = await recipientsOf(id);
      for (const u of [U.listener, U.artist, U.operator, U.operatorWallet, U.admin, U.optout, U.flow, U.retry]) {
        expect(recipients).toContain(u);
      }
      for (const u of [U.pending, U.bare, U.erased, U.bounce]) expect(recipients).not.toContain(u);
    });

    it("limits role:artist to people with an artist profile", async () => {
      const id = await broadcast("role:artist", "policy");
      await delivery.run();
      expect(await recipientsOf(id)).toEqual([U.artist]);
    });

    it("limits role:operator and role:admin to allowlisted accounts, by user id or wallet address", async () => {
      const operatorNotice = await broadcast("role:operator", "incident");
      const adminNotice = await broadcast("role:admin", "incident");
      await delivery.run();
      expect(await recipientsOf(operatorNotice)).toEqual([U.operator, U.operatorWallet].sort());
      expect(await recipientsOf(adminNotice)).toEqual([U.admin]);
    });

    it("sends role:listener to accounts that are not allowlisted operators or admins", async () => {
      const id = await broadcast("role:listener", "incident");
      await delivery.run();
      const recipients = await recipientsOf(id);
      expect(recipients).toEqual(expect.arrayContaining([U.listener, U.artist, U.optout]));
      for (const u of [U.operator, U.operatorWallet, U.admin]) expect(recipients).not.toContain(u);
    });

    it("skips an expired broadcast but marks it done", async () => {
      const created = await prisma.notice.create({
        data: {
          category: "incident",
          title: "Expired",
          body: "Expired",
          audience: "all",
          expiresAt: new Date(Date.now() - 1000),
          createdBy: actor.userId,
        },
      });
      trackedNoticeIds.push(created.id);
      const result = await delivery.run();
      expect(result.fannedOutNotices).toBeGreaterThanOrEqual(1);
      expect(await recipientsOf(created.id)).toEqual([]);
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: created.id } })).emailFannedOutAt).not.toBeNull();
    });

    it("never emails history: a notice already stamped as fanned out has no deliveries", async () => {
      const created = await prisma.notice.create({
        data: {
          category: "terms",
          title: "Old terms",
          body: "Old",
          audience: "all",
          createdBy: actor.userId,
          emailFannedOutAt: new Date(),
        },
      });
      trackedNoticeIds.push(created.id);
      await delivery.run();
      expect(await recipientsOf(created.id)).toEqual([]);
    });

    it("does not queue anything in a dry run", async () => {
      const id = await broadcast("role:artist", "policy");
      const result = await delivery.run({ dryRun: true });
      expect(result).toMatchObject({ dryRun: true, fannedOutNotices: 1, queued: 1, sent: 0 });
      expect(await recipientsOf(id)).toEqual([]);
      expect((await prisma.notice.findUniqueOrThrow({ where: { id } })).emailFannedOutAt).toBeNull();
      expect(transport.sent).toHaveLength(0);
      await delivery.run();
      expect(await recipientsOf(id)).toEqual([U.artist]);
    });

    it("does nothing when email is not enabled", async () => {
      const off = new EmailDeliveryService(new EmailConfig({ NODE_ENV: "production" }), null, contacts);
      const id = await broadcast("role:artist", "policy");
      expect(await off.run()).toMatchObject({ enabled: false, fannedOutNotices: 0, sent: 0 });
      expect((await prisma.notice.findUniqueOrThrow({ where: { id } })).emailFannedOutAt).toBeNull();
      await delivery.run();
    });
  });

  describe("preferences", () => {
    it("suppresses an opted-out category but always sends required ones", async () => {
      const policy = await broadcast("all", "policy");
      const terms = await broadcast("all", "terms");
      const account = await broadcast("all", "account");
      await delivery.run();
      expect(await recipientsOf(policy)).not.toContain(U.optout);
      expect(await recipientsOf(policy)).toContain(U.listener);
      expect(await recipientsOf(terms)).toContain(U.optout);
      expect(await recipientsOf(account)).toContain(U.optout);
      const required = transport.sent.find((m) => m.to === addressOf("optout") && m.subject.startsWith("Broadcast"));
      expect(required?.headers).toEqual({});
      expect(required?.text).not.toContain("/email/unsubscribe");
    });

    it("re-checks at send time and suppresses after an opt-out or removal", async () => {
      const id = await targeted(U.flow, "moderation");
      const other = await targeted(U.retry, "moderation");
      await delivery.fanOut();
      expect(await recipientsOf(id)).toEqual([U.flow]);
      await contacts.setPreferences(U.flow, ["moderation"]);
      await contacts.remove(U.retry);
      const sent = await delivery.sendDue();
      expect(sent).toMatchObject({ sent: 0, suppressed: 2 });
      expect(transport.sent).toHaveLength(0);
      const rows = await prisma.emailDelivery.findMany({ where: { noticeId: { in: [id, other] } } });
      expect(rows.map((r) => r.status)).toEqual(["suppressed", "suppressed"]);
      await confirmed(U.retry);
    });
  });

  describe("sending failures", () => {
    it("backs off a transient failure and sends on a later run", async () => {
      const id = await targeted(U.retry, "refund");
      transport.failWith = new Error("temporary");
      const failed = await delivery.run();
      expect(failed).toMatchObject({ sent: 0, failed: 0 });
      let row = await prisma.emailDelivery.findFirstOrThrow({ where: { noticeId: id } });
      expect(row).toMatchObject({ status: "queued", attempts: 1, lastErrorClass: "Error" });
      const waitMs = row.nextAttemptAt.getTime() - Date.now();
      expect(waitMs).toBeGreaterThan(4 * 60_000);
      expect(waitMs).toBeLessThanOrEqual(5 * 60_000);

      // Not due yet: another run leaves it alone.
      transport.failWith = null;
      expect(await delivery.run()).toMatchObject({ due: 0, sent: 0 });

      await prisma.emailDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      expect(await delivery.run()).toMatchObject({ sent: 1 });
      row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
      expect(row).toMatchObject({ status: "sent", attempts: 2, lastErrorClass: null });
    });

    it("gives up after five attempts with growing backoff", async () => {
      const id = await targeted(U.retry, "refund");
      transport.failWith = new Error("still down");
      const expectedWaits = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
      for (let attempt = 1; attempt < EMAIL_MAX_ATTEMPTS; attempt++) {
        await delivery.run();
        const row = await prisma.emailDelivery.findFirstOrThrow({ where: { noticeId: id } });
        expect(row).toMatchObject({ status: "queued", attempts: attempt });
        const wait = row.nextAttemptAt.getTime() - Date.now();
        expect(wait).toBeGreaterThan(expectedWaits[attempt - 1] - 60_000);
        expect(wait).toBeLessThanOrEqual(expectedWaits[attempt - 1]);
        await prisma.emailDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      }
      const final = await delivery.run();
      expect(final).toMatchObject({ failed: 1 });
      expect(await prisma.emailDelivery.findFirstOrThrow({ where: { noticeId: id } })).toMatchObject({
        status: "failed",
        attempts: EMAIL_MAX_ATTEMPTS,
      });
      // The address stays usable: a transient failure is not a bounce.
      expect((await contacts.getState(U.retry)).status).toBe("confirmed");
    });

    it("treats a permanent rejection as a hard bounce: disables the address and tells the person once in-app", async () => {
      await confirmed(U.bounce);
      const id = await targeted(U.bounce, "refund");
      transport.failWith = new PermanentEmailError("rejected", "smtp_550");
      const result = await delivery.run();
      expect(result).toMatchObject({ failed: 1, bounced: 1 });
      expect(await prisma.emailDelivery.findFirstOrThrow({ where: { noticeId: id } })).toMatchObject({
        status: "failed",
        lastErrorClass: "smtp_550",
      });
      const state = await contacts.getState(U.bounce);
      expect(state).toMatchObject({ status: "disabled", disabledReason: "hard_bounce" });
      const inApp = await prisma.notice.findMany({ where: { recipientUserId: U.bounce, category: "account" } });
      expect(inApp).toHaveLength(1);
      expect(inApp[0].dedupeKey).toMatch(/^email_disabled:/);
      expect(inApp[0].body).not.toContain(addressOf("bounce"));
      expect(inApp[0].link).toBe("/settings");

      // The follow-up account notice itself is not emailed to the disabled address.
      transport.failWith = null;
      transport.sent.length = 0;
      await delivery.run();
      expect(transport.sent.find((m) => m.to === addressOf("bounce"))).toBeUndefined();
    });
  });

  describe("provider webhook events", () => {
    it("disables on a hard bounce (case-insensitive) and on a complaint, and notifies once each", async () => {
      await confirmed(U.hook);
      await confirmed(U.complaint);
      const result = await delivery.handleProviderEvents([
        { type: "bounce", email: addressOf("hook").toUpperCase(), bounceType: "hard" },
        { type: "complaint", email: addressOf("complaint") },
        { type: "bounce", email: addressOf("hook"), bounceType: "hard" },
        { type: "bounce", email: addressOf("unknown_person"), bounceType: "hard" },
      ]);
      expect(result).toEqual({ received: 4, disabled: 2, ignored: 0 });
      expect(await contacts.getState(U.hook)).toMatchObject({ status: "disabled", disabledReason: "hard_bounce" });
      expect(await contacts.getState(U.complaint)).toMatchObject({ status: "disabled", disabledReason: "complaint" });
      for (const u of [U.hook, U.complaint]) {
        expect(await prisma.notice.count({ where: { recipientUserId: u, category: "account" } })).toBe(1);
      }
    });

    it("disables a pending address too, and ignores soft or untyped bounces", async () => {
      await contacts.setAddress(U.hookPending, addressOf("hook_pending"));
      await confirmed(U.soft);
      const result = await delivery.handleProviderEvents([
        { type: "bounce", email: addressOf("hook_pending"), bounceType: "hard" },
        { type: "bounce", email: addressOf("soft"), bounceType: "soft" },
        { type: "bounce", email: addressOf("soft") },
      ]);
      expect(result).toEqual({ received: 3, disabled: 1, ignored: 2 });
      expect((await contacts.getState(U.hookPending)).status).toBe("disabled");
      expect((await contacts.getState(U.soft)).status).toBe("confirmed");
      expect(await prisma.notice.count({ where: { recipientUserId: U.soft } })).toBe(0);
    });

    it("lets a disabled person set a new address and start over", async () => {
      await contacts.setAddress(U.hook, addressOf("hook_new"));
      expect(await contacts.getState(U.hook)).toMatchObject({ status: "pending", disabledReason: null });
    });
  });

  describe("unsubscribe", () => {
    it("turns one optional category off from the emailed link and is idempotent", async () => {
      await confirmed(U.unsub);
      await targeted(U.unsub, "policy");
      await delivery.run();
      const mail = transport.sent.find((m) => m.to === addressOf("unsub") && m.subject.startsWith("Targeted"));
      expect(mail).toBeDefined();
      const token = lastTokenIn(mail!, "email/unsubscribe");
      await expect(contacts.unsubscribe(token)).resolves.toEqual({ category: "policy", status: "unsubscribed" });
      await expect(contacts.unsubscribe(token)).resolves.toEqual({ category: "policy", status: "unsubscribed" });
      const state = await contacts.getState(U.unsub);
      expect(state.categories.find((c) => c.category === "policy")?.enabled).toBe(false);
      expect(state.categories.filter((c) => !c.enabled)).toHaveLength(1);
      expect((await prisma.contactEmail.findUniqueOrThrow({ where: { userId: U.unsub } })).emailOptOuts).toEqual(["policy"]);

      // The one-click header carries the same kind of token.
      const oneClick = /one-click\?token=([^>]+)>/.exec(mail!.headers?.["List-Unsubscribe"] ?? "");
      expect(oneClick).not.toBeNull();
      await expect(contacts.unsubscribe(decodeURIComponent(oneClick![1]))).resolves.toMatchObject({ status: "unsubscribed" });

      // And now policy notices are not emailed to this person.
      const later = await targeted(U.unsub, "policy");
      await delivery.run();
      expect(await recipientsOf(later)).toEqual([]);
    });

    it("rejects tampered, foreign, required-category and unsigned tokens", async () => {
      const good = signUnsubscribeToken(U.unsub, "refund", SECRET);
      const [payload, mac] = good.split(".");
      const forged = Buffer.from(JSON.stringify({ userId: U.listener, category: "refund", v: 1 })).toString("base64url");
      for (const bad of [
        `${forged}.${mac}`,
        `${payload}.${mac}x`,
        signUnsubscribeToken(U.unsub, "refund", "another-secret"),
        signUnsubscribeToken(U.unsub, "terms", SECRET),
        signUnsubscribeToken(U.unsub, "account", SECRET),
        signUnsubscribeToken(U.unsub, "not_a_category", SECRET),
        "garbage",
        undefined,
      ]) {
        await expect(contacts.unsubscribe(bad)).rejects.toMatchObject({ response: { code: "invalid" } });
      }
      expect((await contacts.getState(U.listener)).categories.find((c) => c.category === "refund")?.enabled).toBe(true);
    });

    it("succeeds harmlessly for a person who has since removed their address", async () => {
      await expect(contacts.unsubscribe(signUnsubscribeToken(name("gone"), "refund", SECRET))).resolves.toMatchObject({
        status: "unsubscribed",
      });
    });
  });

  describe("confirmation rate limit", () => {
    const T0 = new Date("2026-10-16T12:00:00.000Z").getTime();
    const at = (offsetMs: number) => {
      contacts.clock = () => new Date(T0 + offsetMs);
    };
    const expectLimited = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => null,
        (e) => e,
      );
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(429);
      expect(error.getResponse()).toMatchObject({ code: "email_rate_limited" });
      expect(error.getResponse().retryAfterSeconds).toBeGreaterThan(0);
      return error.getResponse().retryAfterSeconds as number;
    };

    afterAll(() => {
      contacts.clock = DEFAULT_CLOCK;
    });

    it("refuses a second send within 60 seconds, for set and for resend, and changes nothing", async () => {
      await prisma.user.update({
        where: { id: U.rate },
        data: { confirmationSendCount: 0, confirmationWindowStartedAt: null, lastConfirmationSentAt: null },
      });
      at(0);
      await contacts.setAddress(U.rate, addressOf("rate_1"));
      transport.sent.length = 0;

      at(30_000);
      expect(await expectLimited(contacts.setAddress(U.rate, addressOf("rate_2")))).toBe(30);
      expect(await expectLimited(contacts.resend(U.rate))).toBe(30);
      expect(transport.sent).toHaveLength(0);
      expect((await contacts.getState(U.rate)).address).toBe(addressOf("rate_1"));

      at(61_000);
      await contacts.resend(U.rate);
      expect(transport.sent).toHaveLength(1);
    });

    it("caps confirmations at 5 per rolling 24 hours, even across DELETE and PUT", async () => {
      // Two sends so far (set at 0 s, resend at 61 s). Three more fit; each removal in between must not reset the count.
      for (let i = 0; i < CONFIRMATION_MAX_PER_WINDOW - 2; i++) {
        at(130_000 + i * 70_000);
        await contacts.remove(U.rate);
        await contacts.setAddress(U.rate, addressOf(`rate_cap_${i}`));
      }
      transport.sent.length = 0;
      at(130_000 + 3 * 70_000);
      await contacts.remove(U.rate);
      const retry = await expectLimited(contacts.setAddress(U.rate, addressOf("rate_6")));
      expect(retry).toBeGreaterThan(23 * 3600);
      expect(retry).toBeLessThanOrEqual(24 * 3600);
      expect(transport.sent).toHaveLength(0);
      expect(await prisma.contactEmail.count({ where: { userId: U.rate } })).toBe(0);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: U.rate } });
      expect(user.confirmationSendCount).toBe(CONFIRMATION_MAX_PER_WINDOW);
    });

    it("opens a new window after 24 hours", async () => {
      at(CONFIRMATION_WINDOW_MS + 1_000);
      await contacts.setAddress(U.rate, addressOf("rate_7"));
      expect(transport.sent).toHaveLength(1);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: U.rate } });
      expect(user.confirmationSendCount).toBe(1);
      expect(user.confirmationWindowStartedAt?.getTime()).toBe(T0 + CONFIRMATION_WINDOW_MS + 1_000);
    });

    it("does not count a no-op for an already confirmed address", async () => {
      at(CONFIRMATION_WINDOW_MS + 200_000);
      await contacts.resend(U.rate);
      await contacts.confirm(lastTokenIn(transport.sent[transport.sent.length - 1], "email/confirm"));
      const before = await prisma.user.findUniqueOrThrow({ where: { id: U.rate } });
      expect(before.confirmationSendCount).toBe(2);
      await contacts.setAddress(U.rate, addressOf("rate_7"));
      const after = await prisma.user.findUniqueOrThrow({ where: { id: U.rate } });
      expect(after.confirmationSendCount).toBe(2);
    });
  });

  describe("retention", () => {
    it("prunes delivery rows older than 180 days and keeps recent ones", async () => {
      const oldNotice = await targeted(U.listener, "refund");
      const recentNotice = await targeted(U.listener, "refund");
      await delivery.run();
      const old = new Date(Date.now() - (EMAIL_DELIVERY_RETENTION_DAYS + 1) * DAY_MS);
      await prisma.emailDelivery.updateMany({ where: { noticeId: oldNotice }, data: { createdAt: old } });

      expect((await delivery.prune({ dryRun: true }))).toBeGreaterThanOrEqual(1);
      expect(await prisma.emailDelivery.count({ where: { noticeId: oldNotice } })).toBe(1);
      const pruned = await delivery.prune();
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(await prisma.emailDelivery.count({ where: { noticeId: oldNotice } })).toBe(0);
      expect(await prisma.emailDelivery.count({ where: { noticeId: recentNotice } })).toBe(1);
    });
  });
});
