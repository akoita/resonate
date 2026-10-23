/**
 * AI DJ "More like this" (#2243) against real Postgres. A seed track steers one
 * `agent/next` request, only when the session already picked it, and is never
 * remembered or published. "Not this" never re-offers a track: every pick is
 * logged on the session and sent back as `recentTrackIds`. Only the runtime is
 * stubbed.
 */
import { prisma } from "../db/prisma";
import { SessionsService } from "../modules/sessions/sessions.service";
import { EventBus } from "../modules/shared/event_bus";

const PREFIX = `up_next_seed_${Date.now()}_`;
const USER = `${PREFIX}user`;
const OTHER_USER = `${PREFIX}other`;
const ids = {
  artist: `${PREFIX}artist`,
  release: `${PREFIX}release`,
  picked: `${PREFIX}picked`,
  rejected: `${PREFIX}rejected`,
  unpicked: `${PREFIX}unpicked`,
  next: `${PREFIX}next`,
};

describe("AI DJ seed track and rejected picks (integration)", () => {
  const runCommerce = jest.fn();
  const published: Array<Record<string, any>> = [];
  const eventBus = new EventBus();
  const sessions = new SessionsService({} as any, eventBus, { runCommerce } as any, {} as any);
  let sessionId: string;

  beforeAll(async () => {
    eventBus.subscribe("agent.track_selected", (event: Record<string, any>) => published.push(event));
    await prisma.user.createMany({
      data: [
        { id: USER, email: `${USER}@test.resonate` },
        { id: OTHER_USER, email: `${OTHER_USER}@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: { id: ids.artist, userId: USER, displayName: "Seed Artist", payoutAddress: `0x${"d".repeat(40)}` },
    });
    await prisma.release.create({
      data: { id: ids.release, artistId: ids.artist, title: "Seed Release", genre: "Soul", status: "published" },
    });
    await prisma.track.createMany({
      data: [ids.picked, ids.rejected, ids.unpicked, ids.next].map((id, index) => ({
        id,
        releaseId: ids.release,
        title: `Track ${index}`,
        position: index + 1,
      })),
    });
    const session = await prisma.session.create({
      data: { userId: USER, budgetCapUsd: 10, spentUsd: 0 },
    });
    sessionId = session.id;
    // The DJ already queued these two; the listener then said "Not this" to one.
    await prisma.license.createMany({
      data: [ids.picked, ids.rejected].map((trackId) => ({
        sessionId,
        trackId,
        type: "personal",
        priceUsd: 0,
        durationSeconds: 0,
      })),
    });
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { sessionId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: { in: [USER, OTHER_USER] } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: ids.release } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: ids.release } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ids.artist } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER_USER] } } }).catch(() => {});
  });

  beforeEach(() => {
    runCommerce.mockReset();
    runCommerce.mockResolvedValue({ status: "no_tracks", tracks: [], shortfall: 1 });
    published.length = 0;
  });

  const lastPreferences = () => runCommerce.mock.calls.at(-1)![0].preferences;
  const lastRecentTrackIds = () => runCommerce.mock.calls.at(-1)![0].recentTrackIds as string[];

  it("passes a seed the session already picked to the runtime, for that request only", async () => {
    await sessions.agentNext({
      sessionId,
      userId: USER,
      preferences: { genres: ["Soul"], seedTrackId: ids.picked },
    });
    expect(lastPreferences()).toMatchObject({ genres: expect.arrayContaining(["Soul"]), seedTrackId: ids.picked });

    // The next refill (no preferences) neither remembers nor repeats the seed.
    await sessions.agentNext({ sessionId, userId: USER });
    expect(lastPreferences()).not.toHaveProperty("seedTrackId");
    expect(lastPreferences().genres).toEqual(expect.arrayContaining(["Soul"]));
  });

  it("ignores a seed the session never picked, and never fails the request", async () => {
    await expect(
      sessions.agentNext({ sessionId, userId: USER, preferences: { seedTrackId: ids.unpicked } }),
    ).resolves.toMatchObject({ status: "no_tracks" });
    expect(lastPreferences()).not.toHaveProperty("seedTrackId");

    await sessions.agentNext({ sessionId, userId: USER, preferences: { seedTrackId: "not-a-track" } });
    expect(lastPreferences()).not.toHaveProperty("seedTrackId");
  });

  it("never reads another listener's session", async () => {
    await expect(
      sessions.agentNext({ sessionId, userId: OTHER_USER, preferences: { seedTrackId: ids.picked } }),
    ).rejects.toThrow("Session not found");
    expect(runCommerce).not.toHaveBeenCalled();
  });

  it("excludes every track the session already picked, so a rejected one is not offered again", async () => {
    await sessions.agentNext({ sessionId, userId: USER });
    expect(lastRecentTrackIds()).toEqual(expect.arrayContaining([ids.picked, ids.rejected]));
  });

  it("records the new pick's tracks on the session and keeps the seed out of the published event", async () => {
    runCommerce.mockResolvedValue({
      status: "approved",
      primaryTrack: { trackId: ids.next, licenseType: "personal", priceUsd: 0, score: 1, explanation: ["Sounds close to your taste"] },
      tracks: [],
      shortfall: 0,
    });
    const result = (await sessions.agentNext({
      sessionId,
      userId: USER,
      preferences: { seedTrackId: ids.picked },
    })) as { status: string; track?: { id: string } };
    expect(result.track?.id).toBe(ids.next);
    expect(await prisma.license.count({ where: { sessionId, trackId: ids.next } })).toBe(1);
    expect(JSON.stringify(published)).not.toContain("seedTrackId");
  });
});
