/**
 * Session History filters (#2096) against real Postgres: session start stores
 * the session's OWN filters (never the saved vibes, never free text), a
 * mid-session edit updates them, a refill without preferences leaves them, and
 * the history endpoint returns them. Only the runtime services are stubbed.
 */
import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { SessionsService } from "../modules/sessions/sessions.service";
import { EventBus } from "../modules/shared/event_bus";

const PREFIX = `sess_filters_${Date.now()}_`;
const USER = `${PREFIX}user`;
const req = { user: { userId: USER } };
const SECRET = "secret sentence about my private evening";

async function waitFor(assertion: () => void, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return assertion();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

describe("Session filters summary (integration)", () => {
  const runtime = { run: jest.fn() };
  const learning = {
    resolveTasteProfile: jest.fn().mockResolvedValue(null),
    mergeLearnedGenres: jest.fn(),
  };
  const identity = { enrichConfig: jest.fn(async (config: unknown) => config) };
  const controller = new AgentConfigController(
    {} as any,
    runtime as any,
    identity as any,
    learning as any,
    { publish: jest.fn() } as any,
  );
  const runCommerce = jest.fn();
  const sessions = new SessionsService(
    {} as any,
    new EventBus(),
    { runCommerce } as any,
    {} as any,
  );

  const storedFilters = async (id: string) =>
    (await prisma.session.findUniqueOrThrow({ where: { id } })).filters;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.resonate` } });
    await prisma.agentConfig.create({
      data: { userId: USER, monthlyCapUsd: 10, vibes: ["Saved Vibe"] },
    });
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { session: { userId: USER } } });
    await prisma.session.deleteMany({ where: { userId: USER } });
    await prisma.agentConfig.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  beforeEach(() => {
    runtime.run.mockReset();
    runtime.run.mockResolvedValue({ status: "no_tracks", tracks: [] });
    runCommerce.mockReset();
    runCommerce.mockResolvedValue({ status: "no_tracks", tracks: [], shortfall: 1 });
  });

  it("stores the session's own filters at start, without vibes or free text, and history returns them", async () => {
    const started = await controller.startSession(req, {
      preferences: {
        sessionIntentName: "Night Drive",
        mood: "Chill",
        genres: ["Soul"],
        request: {
          genres: ["Trap", "soul"],
          moods: ["dark"],
          energy: "high",
          bpm: { min: 90, max: 110 },
          text: SECRET,
        },
      },
      // Not part of the contract: must never reach storage either.
      ...({ text: SECRET } as object),
    } as any);
    expect(started).toMatchObject({ status: "started" });
    const sessionId = (started as { sessionId: string }).sessionId;
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1));

    const filters = await storedFilters(sessionId);
    expect(filters).toEqual({
      presetName: "Night Drive",
      genres: ["Soul", "Trap"],
      moods: ["dark"],
      energy: "high",
      tempoBpm: { min: 90, max: 110 },
      explicit: false,
    });
    expect(JSON.stringify(filters)).not.toContain("Saved Vibe");
    expect(JSON.stringify(filters)).not.toContain(SECRET);

    const history = await controller.getHistory(req);
    expect(history.find((session: { id: string }) => session.id === sessionId)).toMatchObject({
      filters: { presetName: "Night Drive", genres: ["Soul", "Trap"] },
    });
  });

  it("stores an empty summary for a start with no filters", async () => {
    const started = await controller.startSession(req, {});
    const sessionId = (started as { sessionId: string }).sessionId;
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1));
    expect(await storedFilters(sessionId)).toEqual({ genres: [], moods: [], explicit: false });
  });

  it("SessionsService.startSession stores the summary too", async () => {
    const walletStub = { setBudget: jest.fn().mockResolvedValue({}) };
    const service = new SessionsService(walletStub as any, new EventBus(), { runCommerce } as any, {} as any);
    const session = await service.startSession({
      userId: USER,
      budgetCapUsd: 10,
      preferences: { sessionIntentName: "Focus", genres: ["Ambient"], energy: "low", allowExplicit: true },
    });
    expect(await storedFilters(session.id)).toEqual({
      presetName: "Focus",
      genres: ["Ambient"],
      moods: [],
      energy: "low",
      explicit: true,
    });
  });

  it("a plain Next Pick that falls back to the saved vibes does not record them as session filters", async () => {
    const started = await controller.startSession(req, {});
    const sessionId = (started as { sessionId: string }).sessionId;
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1));

    await sessions.agentNext({ sessionId, userId: USER, preferences: { genres: ["saved vibe"] } });
    expect(await storedFilters(sessionId)).toEqual({ genres: [], moods: [], explicit: false });
  });

  it("agentNext updates the summary on changed preferences and leaves it on a plain refill", async () => {
    const started = await controller.startSession(req, {
      preferences: { sessionIntentName: "Night Drive", genres: ["Soul"] },
    });
    const sessionId = (started as { sessionId: string }).sessionId;
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1));

    await sessions.agentNext({
      sessionId,
      userId: USER,
      preferences: {
        genres: ["Jazz"],
        mood: "Calm",
        request: { genres: ["Funk"], moods: ["warm"], energy: "medium", bpm: { min: 100, max: null }, text: SECRET } as any,
        allowExplicit: true,
      },
    });
    const updated = await storedFilters(sessionId);
    expect(updated).toEqual({
      genres: ["Jazz", "Funk"],
      moods: ["warm"],
      energy: "medium",
      tempoBpm: { min: 100, max: null },
      explicit: true,
    });
    expect(JSON.stringify(updated)).not.toContain(SECRET);

    // A continuation refill with no preferences must not write.
    const before = JSON.stringify(await storedFilters(sessionId));
    await sessions.agentNext({ sessionId, userId: USER });
    expect(JSON.stringify(await storedFilters(sessionId))).toBe(before);
    expect(runCommerce).toHaveBeenCalledTimes(2);
  });
});
