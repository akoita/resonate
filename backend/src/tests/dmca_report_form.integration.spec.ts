/**
 * #2664: the public report form. Stores the form's fields, requires the
 * statement of good faith, drops honeypot submissions without storing them,
 * and emails the reporter a receipt with the reference (capped per address
 * per day; a failed send never fails the filing). Real Postgres.
 */
import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { DmcaService, DMCA_RECEIPTS_PER_ADDRESS_PER_DAY } from "../modules/dmca/dmca.service";
import { EmailConfig } from "../modules/email/email_config";
import type { EmailMessage, EmailTransport } from "../modules/email/email_transport";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const P = `dmca_form_${Date.now()}_`;
const userId = `${P}user`;
const artistId = `${P}artist`;
const releaseId = `${P}release`;
const trackId = `${P}track`;

class RecordingTransport implements EmailTransport {
  sent: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage) {
    if (this.fail) throw new Error("smtp down");
    this.sent.push(message);
    return { messageId: `m${this.sent.length}` };
  }
}

const config = new EmailConfig({ EMAIL_TRANSPORT: "log", NODE_ENV: "test" } as NodeJS.ProcessEnv);

function form(overrides: Record<string, unknown> = {}) {
  return {
    trackId,
    claimantName: "Rights Holder",
    claimantCapacity: "rights_holder" as const,
    claimantEmail: `${P}holder@example.com`,
    originalWorkUrl: "My song, released 2024",
    contentLocation: `/release/${releaseId}`,
    category: "copyright" as const,
    reason: "This is my recording, uploaded without permission.",
    goodFaith: true,
    ...overrides,
  };
}

describe("DMCA report form (integration)", () => {
  const transport = new RecordingTransport();
  const service = new DmcaService(new UploadRightsRoutingService(), undefined, undefined, transport, config);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId, displayName: "Form Artist", payoutAddress: "0x" + "f".repeat(40) },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "Form Release", rightsRoute: "STANDARD_ESCROW", rightsSourceType: "direct_upload" },
    });
    await prisma.track.create({ data: { id: trackId, title: "Form Track", releaseId } });
  });

  afterAll(async () => {
    await prisma.dmcaReport.deleteMany({ where: { trackId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(() => {
    transport.sent = [];
    transport.fail = false;
  });

  it("stores every field of the form and sends the reporter a receipt with the reference", async () => {
    const result = await service.fileReport(form());
    expect(result.receiptSent).toBe(true);
    const row = await prisma.dmcaReport.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({
      claimantName: "Rights Holder",
      claimantCapacity: "rights_holder",
      category: "copyright",
      contentLocation: `/release/${releaseId}`,
      originalWorkUrl: "My song, released 2024",
      status: "pending",
    });
    expect(row.goodFaithAt).toBeInstanceOf(Date);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].to).toBe(`${P}holder@example.com`);
    expect(transport.sent[0].text).toContain(`Your reference: ${result.id}`);
    // The receipt never repeats the notice's own words.
    expect(transport.sent[0].text).not.toContain("uploaded without permission");
  });

  it("requires the statement of good faith", async () => {
    await expect(service.fileReport(form({ goodFaith: false }))).rejects.toThrow(BadRequestException);
    await expect(service.fileReport(form({ goodFaith: undefined }))).rejects.toThrow("goodFaith must be confirmed");
  });

  it("stores nothing for a filled honeypot field, and answers the same way", async () => {
    const before = await prisma.dmcaReport.count({ where: { trackId } });
    const result = await service.fileReport(form({ website: "http://spam.example" }));
    expect(result.status).toBe("pending");
    expect(typeof result.id).toBe("string");
    expect(await prisma.dmcaReport.count({ where: { trackId } })).toBe(before);
    expect(transport.sent).toHaveLength(0);
  });

  it("stops sending receipts to one address after the daily cap, but still files the notice", async () => {
    const address = `${P}flood@example.com`;
    const results = [];
    for (let i = 0; i < DMCA_RECEIPTS_PER_ADDRESS_PER_DAY + 1; i += 1) {
      results.push(await service.fileReport(form({ claimantEmail: i % 2 ? address.toUpperCase() : address })));
    }
    expect(results.map((r) => r.receiptSent)).toEqual([
      ...Array(DMCA_RECEIPTS_PER_ADDRESS_PER_DAY).fill(true),
      false,
    ]);
    expect(await prisma.dmcaReport.count({ where: { id: { in: results.map((r) => r.id) } } })).toBe(results.length);
  });

  it("files the notice when the receipt cannot be sent", async () => {
    transport.fail = true;
    const result = await service.fileReport(form({ claimantEmail: `${P}down@example.com` }));
    expect(result.receiptSent).toBe(false);
    expect(await prisma.dmcaReport.count({ where: { id: result.id } })).toBe(1);
  });

  it("sends no receipt when email is not configured", async () => {
    const noEmail = new DmcaService(new UploadRightsRoutingService());
    const result = await noEmail.fileReport(form({ claimantEmail: `${P}none@example.com` }));
    expect(result.receiptSent).toBe(false);
  });
});
