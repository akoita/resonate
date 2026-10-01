import { prisma } from "../db/prisma";
import { buildAgentSignalMetadata } from "../modules/agents/agent_learning.service";
import { DiscoveryJournalService } from "../modules/discovery_journal/discovery_journal.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

/**
 * #1455 WS-8: the operator aggregate of resonant discoveries. Seeded far in
 * the future so the 28-day window holds only this file's signals, whatever
 * else shares the database.
 */
const TEST_PREFIX = `djagg_${Date.now()}_`;
const NOW = new Date("2035-03-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const days = (n: number) => n * 24;

const users = {
  a: `${TEST_PREFIX}a`, // discovers artist 1
  f: `${TEST_PREFIX}f`, // also discovers artist 1
  g: `${TEST_PREFIX}g`, // discovers artist 2
  b: `${TEST_PREFIX}b`, // resonant, but knew artist 3 long before
  c: `${TEST_PREFIX}c`, // 90% completion, no follow-up
  d: `${TEST_PREFIX}d`, // taste reset after the signals
  e: `${TEST_PREFIX}e`, // agent playback training off, agent-originated plays
  h: `${TEST_PREFIX}h`, // resonant on a withdrawn release
};
const settingsUsers = [users.d, users.e];

type Seeded = { artistId: string; trackId: string };
const seeded: Record<string, Seeded> = {};

async function seedTrack(name: string, releaseStatus = "published"): Promise<Seeded> {
  const artistId = `${TEST_PREFIX}artist_${name}`;
  await prisma.artist.create({ data: { id: artistId, displayName: `Account ${name}` } });
  const releaseId = `${TEST_PREFIX}release_${name}`;
  await prisma.release.create({
    data: { id: releaseId, artistId, title: `Release ${name}`, genre: "Deep House", status: releaseStatus },
  });
  const trackId = `${TEST_PREFIX}track_${name}`;
  await prisma.track.create({ data: { id: trackId, releaseId, title: `Track ${name}`, position: 1 } });
  return { artistId, trackId };
}

async function signal(
  userId: string,
  trackId: string,
  action: "accept" | "complete" | "replay" | "save",
  at: Date,
  options: { ratio?: number; source?: string } = {},
) {
  await prisma.agentSignal.create({
    data: {
      userId,
      trackId,
      action,
      weight: 1,
      createdAt: at,
      metadata: buildAgentSignalMetadata({
        source: options.source ?? "web_player",
        ...(options.ratio !== undefined
          ? { outcome: { type: "playback_completed", completionRatio: options.ratio } }
          : {}),
      }),
    },
  });
}

describe("DiscoveryJournalService.getResonantDiscoveryAggregate (integration)", () => {
  const service = new DiscoveryJournalService(
    new TasteMemoryService(new EventBus()),
    new DiscoveryPolicyContextService(),
  );

  beforeAll(async () => {
    for (const id of Object.values(users)) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    for (const name of ["one", "two", "three", "four", "five", "six"]) {
      seeded[name] = await seedTrack(name);
    }
    seeded.withdrawn = await seedTrack("withdrawn", "withdrawn");

    // a and f: first listen of artist "one" resonates (complete >= 0.9, replay within 7 days).
    for (const user of [users.a, users.f]) {
      await signal(user, seeded.one.trackId, "accept", ago(days(3) + 0.2));
      await signal(user, seeded.one.trackId, "complete", ago(days(3)), { ratio: 0.95 });
      await signal(user, seeded.one.trackId, "replay", ago(days(2)));
    }
    // g: artist "two", saved after the completion.
    await signal(users.g, seeded.two.trackId, "complete", ago(days(4)), { ratio: 1 });
    await signal(users.g, seeded.two.trackId, "save", ago(days(3)));

    // b: resonates, but interacted with the artist ten days earlier: not a discovery.
    await signal(users.b, seeded.three.trackId, "accept", ago(days(12)));
    await signal(users.b, seeded.three.trackId, "complete", ago(days(3)), { ratio: 0.95 });
    await signal(users.b, seeded.three.trackId, "replay", ago(days(2)));

    // c: completion, no follow-up.
    await signal(users.c, seeded.four.trackId, "complete", ago(days(3)), { ratio: 0.95 });

    // d: would be a discovery, but the listener reset their taste afterwards.
    await signal(users.d, seeded.five.trackId, "complete", ago(days(3)), { ratio: 0.95 });
    await signal(users.d, seeded.five.trackId, "replay", ago(days(2)));
    // e: would be a discovery, but agent-originated playback may not be used.
    await signal(users.e, seeded.six.trackId, "complete", ago(days(3)), { ratio: 0.95, source: "agent_session" });
    await signal(users.e, seeded.six.trackId, "replay", ago(days(2)), { source: "agent_session" });
    await prisma.listenerTasteMemorySettings.create({
      data: { userId: users.d, resetAt: ago(days(1)) },
    });
    await prisma.listenerTasteMemorySettings.create({
      data: { userId: users.e, agentPlaybackTrainingEnabled: false },
    });

    // h: resonates on a withdrawn release: not publicly available.
    await signal(users.h, seeded.withdrawn.trackId, "complete", ago(days(3)), { ratio: 0.95 });
    await signal(users.h, seeded.withdrawn.trackId, "replay", ago(days(2)));
  });

  afterAll(async () => {
    const userIds = Object.values(users);
    await prisma.agentSignal.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: settingsUsers } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}track_` } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}release_` } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}artist_` } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("counts resonant discoveries and distinct new artists across listeners", async () => {
    const aggregate = await service.getResonantDiscoveryAggregate({ windowDays: 28, now: NOW });

    // a, f, g are discoveries. b knew the artist, c never followed up, d reset
    // their taste, e opted out of agent training and h's release is withdrawn.
    expect(aggregate.total).toBe(3);
    expect(aggregate.distinctNewArtists).toBe(2);
    // Every seeded listener has at least one signal in the window.
    expect(aggregate.activeListeners).toBe(Object.keys(users).length);
    expect(aggregate.truncated).toBe(false);
  });

  it("exposes counts only", async () => {
    const aggregate = await service.getResonantDiscoveryAggregate({ windowDays: 28, now: NOW });
    expect(Object.keys(aggregate).sort()).toEqual([
      "activeListeners",
      "distinctNewArtists",
      "total",
      "truncated",
    ]);
  });

  it("counts nothing outside the window", async () => {
    const aggregate = await service.getResonantDiscoveryAggregate({
      windowDays: 1,
      now: NOW,
    });
    expect(aggregate.total).toBe(0);
  });
});
