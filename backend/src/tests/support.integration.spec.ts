/**
 * Support requests and the service status line (#2667), against real Postgres.
 */
import { prisma } from "../db/prisma";
import { SupportService, SUPPORT_REQUESTS_PER_DAY } from "../modules/support/support.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { EmailConfig } from "../modules/email/email_config";
import type { EmailMessage, EmailTransport } from "../modules/email/email_transport";

const TEST_PREFIX = `support_${Date.now()}_`;
const signedIn = `${TEST_PREFIX}user`;
const noContact = `${TEST_PREFIX}nocontact`;
const capped = `${TEST_PREFIX}capped`;
const visitorEmail = `${TEST_PREFIX}visitor@example.com`.toLowerCase();

class FakeTransport implements EmailTransport {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { messageId: `m-${this.sent.length}` };
  }
}

describe("support requests (#2667)", () => {
  const transport = new FakeTransport();
  const config = new EmailConfig({ FRONTEND_URL: "https://app.example.test" } as NodeJS.ProcessEnv);
  const service = new SupportService(transport, config);
  const noticeIds: string[] = [];

  beforeAll(async () => {
    for (const id of [signedIn, noContact, capped]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.contactEmail.create({
      data: {
        userId: signedIn,
        address: `${TEST_PREFIX}contact@example.com`,
        addressNormalized: `${TEST_PREFIX}contact@example.com`.toLowerCase(),
        status: "confirmed",
        confirmedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.supportRequest.deleteMany({
      where: { OR: [{ userId: { startsWith: TEST_PREFIX } }, { email: { startsWith: TEST_PREFIX, mode: "insensitive" } }] },
    });
    await prisma.notice.deleteMany({ where: { id: { in: noticeIds } } });
    await prisma.contactEmail.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  beforeEach(() => {
    transport.sent = [];
  });

  it("stores a signed-out request and sends the receipt to the address given", async () => {
    const result = await service.create(null, { topic: "uploads", message: "My upload is stuck.", email: visitorEmail });
    expect(result).toEqual(expect.objectContaining({ status: "new", receiptSent: true }));
    const row = await prisma.supportRequest.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toEqual(expect.objectContaining({ userId: null, email: visitorEmail, topic: "uploads" }));
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe(visitorEmail);
    expect(transport.sent[0].text).toContain(result.id);
    // The receipt never repeats the message.
    expect(transport.sent[0].text).not.toContain("My upload is stuck.");
  });

  it("links a signed-in request and sends the receipt to the confirmed contact address", async () => {
    const result = await service.create(signedIn, { topic: "account", message: "Please help with my account." });
    expect(result.receiptSent).toBe(true);
    expect(transport.sent[0].to).toBe(`${TEST_PREFIX}contact@example.com`);
    const row = await prisma.supportRequest.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.userId).toBe(signedIn);
    expect(row.email).toBeNull();
  });

  it("stores the request without a receipt when no address is known", async () => {
    const result = await service.create(noContact, { topic: "other", message: "Just a question about it." });
    expect(result.receiptSent).toBe(false);
    expect(transport.sent).toHaveLength(0);
    await expect(prisma.supportRequest.count({ where: { id: result.id } })).resolves.toBe(1);
  });

  it("drops a honeypot submission without storing it", async () => {
    const before = await prisma.supportRequest.count({ where: { userId: noContact } });
    await service.create(noContact, { topic: "other", message: "Buy cheap things now", website: "spam.example" });
    await expect(prisma.supportRequest.count({ where: { userId: noContact } })).resolves.toBe(before);
  });

  it("rejects a message that is too short", async () => {
    await expect(service.create(null, { topic: "other", message: "hi" })).rejects.toMatchObject({ status: 400 });
  });

  it(`refuses a person's request beyond ${SUPPORT_REQUESTS_PER_DAY} a day with 429`, async () => {
    for (let i = 0; i < SUPPORT_REQUESTS_PER_DAY; i += 1) {
      await service.create(capped, { topic: "other", message: `Request number ${i} for help.` });
    }
    await expect(service.create(capped, { topic: "other", message: "One request too many." })).rejects.toMatchObject({
      status: 429,
    });
    await expect(prisma.supportRequest.count({ where: { userId: capped } })).resolves.toBe(SUPPORT_REQUESTS_PER_DAY);
  });

  it("applies the daily cap to a signed-out reply address, whatever its case", async () => {
    const address = `${TEST_PREFIX}Flood@Example.com`;
    for (let i = 0; i < SUPPORT_REQUESTS_PER_DAY; i += 1) {
      await service.create(null, { topic: "other", message: `Visitor request ${i} here.`, email: address });
    }
    await expect(
      service.create(null, { topic: "other", message: "Another request here.", email: address.toLowerCase() }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("lists requests for operators with the reply address, and marks one answered", async () => {
    const created = await service.create(signedIn, { topic: "payments", message: "A question about a payment." });
    const { requests, counts } = await service.list("new");
    const row = requests.find((r) => r.id === created.id);
    expect(row).toEqual(
      expect.objectContaining({ topic: "payments", signedIn: true, replyTo: `${TEST_PREFIX}contact@example.com` }),
    );
    expect(counts.new).toBeGreaterThan(0);

    const updated = await service.setStatus(created.id, "answered", "operator-1");
    expect(updated.status).toBe("answered");
    const stored = await prisma.supportRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toEqual(expect.objectContaining({ status: "answered", statusChangedBy: "operator-1" }));
    const answered = await service.list("answered");
    expect(answered.requests.some((r) => r.id === created.id)).toBe(true);
  });

  it("404s a status change for an unknown request", async () => {
    await expect(service.setStatus(`${TEST_PREFIX}missing`, "closed", "operator-1")).rejects.toMatchObject({ status: 404 });
  });

  describe("service status line", () => {
    // Other suites may hold active incident broadcasts, so assert on ours by id.
    const notices = new NoticeService({ subscribe: jest.fn() } as never, { log: jest.fn() } as never);

    it("shows the newest active incident broadcast to everyone, and clears when it is ended", async () => {
      const notice = await prisma.notice.create({
        data: {
          category: "incident",
          title: `${TEST_PREFIX} Uploads are slow`,
          body: "We are looking into it.",
          audience: "all",
          createdBy: "operator-1",
          emailFannedOutAt: new Date(),
        },
      });
      noticeIds.push(notice.id);
      const shown = await notices.currentStatus();
      expect(shown.status?.id).toBe(notice.id);
      expect(shown.status).toEqual(expect.objectContaining({ title: `${TEST_PREFIX} Uploads are slow` }));

      const ended = await notices.endBroadcast(notice.id);
      expect(new Date(ended.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
      const after = await notices.currentStatus();
      expect(after.status?.id).not.toBe(notice.id);
    });

    it("never shows a policy broadcast or a role-only incident as the public status", async () => {
      const policy = await prisma.notice.create({
        data: { category: "policy", title: "Policy", body: "b", audience: "all", createdBy: "op", emailFannedOutAt: new Date() },
      });
      const artistsOnly = await prisma.notice.create({
        data: { category: "incident", title: "Artists", body: "b", audience: "role:artist", createdBy: "op", emailFannedOutAt: new Date() },
      });
      noticeIds.push(policy.id, artistsOnly.id);
      const shown = await notices.currentStatus();
      expect([policy.id, artistsOnly.id]).not.toContain(shown.status?.id);
    });

    it("404s ending a targeted notice", async () => {
      const targeted = await prisma.notice.create({
        data: {
          category: "account",
          title: "t",
          body: "b",
          audience: "user",
          recipientUserId: noContact,
          createdBy: "op",
          emailFannedOutAt: new Date(),
        },
      });
      noticeIds.push(targeted.id);
      await expect(notices.endBroadcast(targeted.id)).rejects.toMatchObject({ status: 404 });
    });
  });
});
