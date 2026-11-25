/**
 * Invitation-only registration, the founding-artist cap and the waiting list (#2662).
 */
import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { InvitationRefusedError, InvitationsService } from "../modules/invitations/invitations.service";

const TEST_PREFIX = `invites_${Date.now()}_`;
const OPERATOR = `${TEST_PREFIX}operator`;
const users = [OPERATOR];
const invitationIds: string[] = [];
const waitlistEmails: string[] = [];

async function seedUser(id: string) {
  users.push(id);
  await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
}

describe("InvitationsService (integration)", () => {
  const service = new InvitationsService();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: OPERATOR, email: `${OPERATOR}@test.resonate` } });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  afterAll(async () => {
    await prisma.invitationRedemption.deleteMany({ where: { userId: { in: users } } });
    await prisma.invitation.deleteMany({ where: { OR: [{ id: { in: invitationIds } }, { createdByUserId: { in: users } }] } });
    await prisma.waitlistEntry.deleteMany({ where: { emailNormalized: { in: waitlistEmails } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  async function create(input: Parameters<InvitationsService["create"]>[1], now?: Date) {
    const created = await service.create(OPERATOR, input, "operator", now);
    invitationIds.push(created.id);
    return created;
  }

  it("defaults to open registration and switches to invitation mode by setting", () => {
    delete process.env.REGISTRATION_MODE;
    expect(service.mode()).toBe("open");
    process.env.REGISTRATION_MODE = "invite";
    expect(service.mode()).toBe("invite");
  });

  it("accepts a valid code once, however it is typed, and refuses it after", async () => {
    const created = await create({ role: "listener" });
    expect(created.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const typed = created.code.toLowerCase().replace(/-/g, " ");

    expect(await service.check(typed)).toEqual({ status: "valid", role: "listener" });

    const user = `${TEST_PREFIX}listener`;
    await seedUser(user);
    const reservation = await service.reserve(typed);
    await service.complete(reservation, user);

    expect(await service.check(created.code)).toEqual({ status: "used" });
    await expect(service.reserve(created.code)).rejects.toEqual(new InvitationRefusedError("used"));
    // The stored row never holds the code.
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(row)).not.toContain(created.code.replace(/-/g, ""));
  });

  it("refuses an expired, a revoked and an unknown code", async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expired = await create({ role: "listener", expiresInDays: 1 }, past);
    expect(await service.check(expired.code)).toEqual({ status: "expired" });

    const revoked = await create({ role: "listener" });
    await service.revoke(revoked.id);
    expect(await service.check(revoked.code)).toEqual({ status: "invalid" });

    expect(await service.check("ZZZZ-ZZZZ-ZZZZ")).toEqual({ status: "invalid" });
    expect(await service.check("short")).toEqual({ status: "invalid" });
  });

  it("gives exactly one of two simultaneous callers the last use", async () => {
    const created = await create({ role: "listener", maxUses: 1 });
    const results = await Promise.allSettled([service.reserve(created.code), service.reserve(created.code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("gives a use back when the account could not be created", async () => {
    const created = await create({ role: "listener", maxUses: 1 });
    const reservation = await service.reserve(created.code);
    await service.release(reservation);
    expect(await service.check(created.code)).toEqual({ status: "valid", role: "listener" });
  });

  it("holds the founding-artist cap", async () => {
    const used = (await service.list()).foundingArtists.used;
    process.env.FOUNDING_ARTIST_CAP = String(used + 1);
    const first = await create({ role: "artist" });
    const second = await create({ role: "artist" });

    const artist = `${TEST_PREFIX}artist`;
    await seedUser(artist);
    await service.complete(await service.reserve(first.code), artist);

    expect(await service.check(second.code)).toEqual({ status: "artist_cap_reached" });
    await expect(service.reserve(second.code)).rejects.toEqual(new InvitationRefusedError("artist_cap_reached"));
    expect((await service.registrationStatus()).artistCapReached).toBe(true);
    expect(await service.isFoundingArtist(artist)).toBe(true);
  });

  it("only lets a founding artist set up a profile in invitation mode", async () => {
    const listener = `${TEST_PREFIX}gate_listener`;
    await seedUser(listener);
    delete process.env.REGISTRATION_MODE;
    await expect(service.assertMayBecomeArtist(listener)).resolves.toBeUndefined();

    process.env.REGISTRATION_MODE = "invite";
    await expect(service.assertMayBecomeArtist(listener)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertMayBecomeArtist(listener, "admin")).resolves.toBeUndefined();

    delete process.env.FOUNDING_ARTIST_CAP;
    const code = (await create({ role: "artist" })).code;
    expect(await service.redeemForExistingAccount(listener, code)).toEqual({ status: "redeemed", role: "artist" });
    await expect(service.assertMayBecomeArtist(listener)).resolves.toBeUndefined();
  });

  it("lets a founding artist hand out a limited number of listener codes", async () => {
    process.env.FOUNDING_ARTIST_LISTENER_INVITES = "2";
    const artist = `${TEST_PREFIX}allowance_artist`;
    await seedUser(artist);
    await expect(service.createMine(artist)).rejects.toBeInstanceOf(ForbiddenException);

    await service.complete(await service.reserve((await create({ role: "artist" })).code), artist);
    const one = await service.createMine(artist);
    await service.createMine(artist);
    expect(one.role).toBe("listener");
    await expect(service.createMine(artist)).rejects.toBeInstanceOf(ForbiddenException);
    const mine = await service.listMine(artist);
    expect(mine).toMatchObject({ eligible: true, allowance: 2, remaining: 0 });
    expect(mine.invitations).toHaveLength(2);
  });

  it("keeps one waiting-list entry per address and links it when its invitation is used", async () => {
    const email = `${TEST_PREFIX}Fan@Example.com`;
    waitlistEmails.push(email.toLowerCase());
    await service.joinWaitlist({ email, kind: "listener", consent: true });
    await service.joinWaitlist({ email: email.toUpperCase(), kind: "artist", consent: true });
    const rows = await prisma.waitlistEntry.findMany({ where: { emailNormalized: email.toLowerCase() } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("artist");

    await expect(service.joinWaitlist({ email: "nope", kind: "listener", consent: true })).rejects.toThrow();
    await expect(service.joinWaitlist({ email, kind: "listener", consent: false })).rejects.toThrow();

    delete process.env.FOUNDING_ARTIST_CAP;
    const invited = await service.inviteWaitlistEntry(OPERATOR, rows[0].id);
    invitationIds.push(invited.id);
    expect(invited).toMatchObject({ role: "artist", email });

    const person = `${TEST_PREFIX}waitlisted`;
    await seedUser(person);
    await service.complete(await service.reserve(invited.code), person);
    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(entry.userId).toBe(person);
    expect((await service.listWaitlist()).find((e) => e.id === rows[0].id)?.joined).toBe(true);

    await service.deleteWaitlistEntry(rows[0].id);
    expect(await prisma.waitlistEntry.findUnique({ where: { id: rows[0].id } })).toBeNull();
  });
});
