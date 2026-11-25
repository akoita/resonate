/**
 * Preview measures (#2670) against real Postgres, with seeded data. Rows are
 * dated in a window in 2031 that no other suite writes to, so the global
 * counts the page reads are this suite's own.
 */
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { PreviewMeasuresService } from "../modules/preview_measures/preview_measures.service";

const TEST_PREFIX = `pmeas_${Date.now()}_`;
const FROM = new Date("2031-03-03T00:00:00Z");
const TO = new Date("2031-03-31T00:00:00Z");
const NOW = new Date("2031-05-01T00:00:00Z");
const day = (n: number) => new Date(FROM.getTime() + n * 24 * 60 * 60 * 1000);
const hours = (date: Date, h: number) => new Date(date.getTime() + h * 60 * 60 * 1000);

const operator = `${TEST_PREFIX}operator`;
const artistUsers = [1, 2, 3, 4, 5, 6].map((n) => `${TEST_PREFIX}artist${n}`);
const listeners = [1, 2, 3, 4, 5, 6, 7].map((n) => `${TEST_PREFIX}listener${n}`);
const invitationId = `${TEST_PREFIX}invite`;
const eventIds: string[] = [];

describe("preview measures (#2670)", () => {
  const service = new PreviewMeasuresService();
  const previousSalt = process.env.ANALYTICS_ACTOR_ID_SALT;

  beforeAll(async () => {
    process.env.ANALYTICS_ACTOR_ID_SALT = "preview-measures-test-salt";
    await prisma.user.create({ data: { id: operator, email: `${operator}@test.resonate` } });
    await prisma.invitation.create({
      data: { id: invitationId, codeHash: `${TEST_PREFIX}hash`, codeHint: "ABCD", role: "artist", maxUses: 10, createdByUserId: operator },
    });

    // Six founding artists: five publish within 14 days, one later.
    for (const [index, userId] of artistUsers.entries()) {
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
      await prisma.invitationRedemption.create({
        data: { invitationId, userId, role: "artist", redeemedAt: day(index) },
      });
      await prisma.artist.create({ data: { id: `${userId}_profile`, userId, displayName: `${userId} name` } });
      await prisma.release.create({
        data: {
          id: `${userId}_rel`,
          artistId: `${userId}_profile`,
          title: "First",
          status: "published",
          createdAt: index < 5 ? day(index + 3) : day(index + 20),
        },
      });
    }

    // Seven listeners join; six allowed product analytics. Five are active in
    // their first week, two in their second.
    for (const [index, userId] of listeners.entries()) {
      const joined = day(index);
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate`, createdAt: joined } });
      if (index < 6) {
        await prisma.analyticsConsent.create({
          data: { userId, productAnalytics: true, decidedAt: joined, policyVersion: "test" },
        });
      }
      const activeWeeks = [index < 5 ? 0 : null, index < 2 ? 1 : null].filter((w): w is number => w !== null);
      for (const week of activeWeeks) {
        const occurredAt = hours(joined, week * 7 * 24 + 5);
        const eventId = `${TEST_PREFIX}ev${eventIds.length}`;
        eventIds.push(eventId);
        await prisma.analyticsEvent.create({
          data: {
            eventId,
            eventName: "playback.started",
            eventVersion: 1,
            occurredAt,
            receivedAt: occurredAt,
            producer: "test",
            environment: "test",
            privacyTier: "pseudonymous",
            actorId: pseudonymousAnalyticsActorId(userId),
            payload: {},
            envelope: {},
          },
        });
      }
    }

    // Feature use: five listeners start an AI DJ session in week 1, two make a crate in week 2.
    for (const userId of listeners.slice(0, 5)) {
      await prisma.session.create({ data: { userId, budgetCapUsd: 0, startedAt: day(1) } });
    }
    for (const userId of listeners.slice(0, 2)) {
      await prisma.crate.create({ data: { userId, filters: {}, createdAt: day(8) } });
    }

    // Support: five requests answered after 2, 4, 6, 8 and 10 hours; one still new.
    for (const [index, h] of [2, 4, 6, 8, 10].entries()) {
      const createdAt = day(index + 1);
      await prisma.supportRequest.create({
        data: { userId: listeners[index], topic: "account", message: "Help please.", status: "answered", createdAt, statusChangedAt: hours(createdAt, h) },
      });
    }
    await prisma.supportRequest.create({
      data: { userId: listeners[5], topic: "other", message: "Hello there.", createdAt: day(9) },
    });

    // Five uploads refused by a limit.
    for (let i = 0; i < 5; i += 1) {
      await prisma.uploadLimitRefusal.create({ data: { artistId: `${TEST_PREFIX}refused`, limitKey: "releasesPerDay", createdAt: day(i) } });
    }
  });

  afterAll(async () => {
    if (previousSalt === undefined) delete process.env.ANALYTICS_ACTOR_ID_SALT;
    else process.env.ANALYTICS_ACTOR_ID_SALT = previousSalt;
    const users = [operator, ...artistUsers, ...listeners];
    await prisma.uploadLimitRefusal.deleteMany({ where: { artistId: `${TEST_PREFIX}refused` } });
    await prisma.supportRequest.deleteMany({ where: { userId: { in: users } } });
    await prisma.crate.deleteMany({ where: { userId: { in: users } } });
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: users } } });
    await prisma.release.deleteMany({ where: { id: { in: artistUsers.map((u) => `${u}_rel`) } } });
    await prisma.artist.deleteMany({ where: { userId: { in: artistUsers } } });
    await prisma.invitationRedemption.deleteMany({ where: { invitationId } });
    await prisma.invitation.deleteMany({ where: { id: invitationId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  it("measures the period with the small-group rule", async () => {
    const result = await service.measures(FROM.toISOString(), TO.toISOString(), NOW);

    expect(result.artists).toEqual({ invited: 6, publishedWithin14Days: 5, stillWithin14Days: 0, share: 83.3 });

    expect(result.listeners).toMatchObject({ joined: 7, consenting: 6, analyticsAvailable: true });
    expect(result.listeners.weeks[0]).toEqual({ week: 1, eligible: 6, active: 5, share: 83.3 });
    expect(result.listeners.weeks[1]).toEqual({ week: 2, eligible: 6, active: null, share: null });
    expect(result.listeners.weeks[2]).toEqual({ week: 3, eligible: 6, active: 0, share: 0 });

    expect(result.features.weeks).toHaveLength(4);
    const row = (key: string) => result.features.rows.find((r) => r.key === key);
    expect(row("aiDj")?.weekly).toEqual([5, 0, 0, 0]);
    expect(row("crates")?.weekly).toEqual([0, null, 0, 0]);
    expect(row("stemPreviews")).toMatchObject({ recorded: false });

    expect(result.support).toEqual({ opened: 6, answered: 5, medianHoursToAnswer: 6 });
    expect(result.safety).toEqual({ uploadsRefusedByLimit: 5, takedownReports: 0, communityReports: 0 });
  });

  it("counts a founding artist still inside the 14 days as pending", async () => {
    const early = new Date(day(5).getTime() + 2 * 24 * 60 * 60 * 1000);
    const result = await service.artistActivation({ from: FROM, to: TO }, early);
    // At that moment artists 1-5 had published (release dated before "now" is still counted).
    expect(result.invited).toBe(6);
    expect(result.stillWithin14Days).toBeNull();
  });
});
