import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { getAgentSessionHistoryLimit } from "../modules/agents/agent_runtime.config";

const TEST_PREFIX = `djhistory_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const SESSION_COUNT = 12;
const ENV_KEY = "AGENT_SESSION_HISTORY_LIMIT";
const originalLimit = process.env[ENV_KEY];

function makeController() {
  // History endpoints read Prisma only; the injected services are unused.
  return new AgentConfigController(
    {} as any, {} as any, {} as any, {} as any, { publish: jest.fn() } as any,
  );
}

const req = (userId: string) => ({ user: { userId } });
const sessionId = (index: number) => `${TEST_PREFIX}session_${String(index).padStart(2, "0")}`;

describe("AI DJ session history limit", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` },
        { id: OTHER_USER_ID, email: `${TEST_PREFIX}other@test.resonate` },
      ],
    });
    await prisma.artist.create({ data: { id: ARTIST_ID, displayName: "History Artist" } });
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "History Release", status: "published" },
    });
    await prisma.track.create({ data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "History Track", position: 1 } });

    const base = new Date("2026-09-01T12:00:00.000Z").getTime();
    for (let index = 0; index < SESSION_COUNT; index += 1) {
      await prisma.session.create({
        data: {
          id: sessionId(index),
          userId: USER_ID,
          budgetCapUsd: 10,
          spentUsd: 0.5,
          startedAt: new Date(base + index * 60 * 60 * 1000),
          endedAt: new Date(base + index * 60 * 60 * 1000 + 60_000),
        },
      });
    }
    // Two tracks on the oldest session (outside the default window), one on the newest.
    await prisma.license.createMany({
      data: [
        { sessionId: sessionId(0), trackId: TRACK_ID, type: "personal", priceUsd: 0, durationSeconds: 0 },
        { sessionId: sessionId(0), trackId: TRACK_ID, type: "personal", priceUsd: 0, durationSeconds: 0 },
        { sessionId: sessionId(SESSION_COUNT - 1), trackId: TRACK_ID, type: "personal", priceUsd: 0, durationSeconds: 0 },
      ],
    });
    await prisma.session.create({
      data: { id: `${TEST_PREFIX}other_session`, userId: OTHER_USER_ID, budgetCapUsd: 10, spentUsd: 3 },
    });
  });

  afterEach(() => {
    if (originalLimit === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalLimit;
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.session.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
  });

  it("returns the 10 most recent sessions by default, newest first", async () => {
    delete process.env[ENV_KEY];
    const sessions = await makeController().getHistory(req(USER_ID));

    expect(sessions.map((session) => session.id)).toEqual(
      Array.from({ length: 10 }, (_, offset) => sessionId(SESSION_COUNT - 1 - offset)),
    );
  });

  it("honours AGENT_SESSION_HISTORY_LIMIT", async () => {
    process.env[ENV_KEY] = "3";
    const sessions = await makeController().getHistory(req(USER_ID));

    expect(sessions.map((session) => session.id)).toEqual([sessionId(11), sessionId(10), sessionId(9)]);
  });

  it("reports lifetime counts beyond the history window, scoped to the caller", async () => {
    delete process.env[ENV_KEY];
    const summary = await makeController().getHistorySummary(req(USER_ID));

    expect(summary).toEqual({
      sessionCount: SESSION_COUNT,
      sessionsWithTracks: 2,
      trackCount: 3,
      historyLimit: 10,
    });
  });
});

describe("getAgentSessionHistoryLimit", () => {
  afterEach(() => {
    if (originalLimit === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalLimit;
  });

  it.each([
    [undefined, 10],
    ["", 10],
    ["abc", 10],
    ["0", 10],
    ["-4", 10],
    ["25", 25],
    ["500", 50],
  ])("maps %p to %p", (value, expected) => {
    if (value === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = value;
    expect(getAgentSessionHistoryLimit()).toBe(expected);
  });
});
