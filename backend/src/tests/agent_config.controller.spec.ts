const findUniqueAgentConfig = jest.fn();
const updateAgentConfig = jest.fn();
const createSession = jest.fn();
const updateSession = jest.fn();
const findFirstWallet = jest.fn();
const updateWallet = jest.fn();
const createLicense = jest.fn();

jest.mock("../db/prisma", () => ({
  prisma: {
    agentConfig: {
      findUnique: (...args: unknown[]) => findUniqueAgentConfig(...args),
      update: (...args: unknown[]) => updateAgentConfig(...args),
    },
    session: {
      create: (...args: unknown[]) => createSession(...args),
      update: (...args: unknown[]) => updateSession(...args),
    },
    wallet: {
      findFirst: (...args: unknown[]) => findFirstWallet(...args),
      update: (...args: unknown[]) => updateWallet(...args),
    },
    license: {
      create: (...args: unknown[]) => createLicense(...args),
    },
  },
}));

import { AgentConfigController } from "../modules/agents/agent_config.controller";

function makeController() {
  return new AgentConfigController(
    {} as any,
    {
      run: jest.fn().mockResolvedValue({
        status: "no_pick",
        reason: "empty_catalog",
        latencyMs: 12,
        picks: [],
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      computeTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
      recordSignal: jest.fn(),
    } as any,
    {} as any,
    { publish: jest.fn() } as any,
  );
}

describe("AgentConfigController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    findUniqueAgentConfig.mockResolvedValue({
      id: "agent_1",
      userId: "user_1",
      name: "booba",
      vibes: ["Focus"],
      stemTypes: ["all"],
      monthlyCapUsd: 10,
      sessionMode: "curate",
    });
    updateAgentConfig.mockResolvedValue({});
    createSession.mockResolvedValue({ id: "session_1" });
    updateSession.mockResolvedValue({});
    findFirstWallet.mockResolvedValue(null);
    updateWallet.mockResolvedValue({});
    createLicense.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts a session with intent preferences and forwards them to events and runtime", async () => {
    const ctrl = makeController();
    const req = { user: { userId: "user_1" } };

    const result = await ctrl.startSession(req, {
      preferences: {
        mood: "Chill",
        energy: "low",
        genres: ["Soul", "Jazz", "Downtempo"],
        licenseType: "personal",
        sessionIntent: "Chill",
        sessionIntentName: "Liquid Sky",
        queueStyle: "Soft transitions",
        source: "agent_session_intent_panel",
      },
    });

    expect(result).toEqual({ status: "started", sessionId: "session_1" });
    expect(createSession).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        budgetCapUsd: 10,
      },
    });

    await jest.advanceTimersByTimeAsync(500);

    const eventBus = (ctrl as any).eventBus;
    const runtimeService = (ctrl as any).runtimeService;
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "session.started",
        sessionId: "session_1",
        preferences: expect.objectContaining({
          genres: ["Soul", "Jazz", "Downtempo"],
          mood: "Chill",
          energy: "low",
          licenseType: "personal",
          sessionIntent: "Chill",
          sessionIntentName: "Liquid Sky",
          queueStyle: "Soft transitions",
          source: "agent_session_intent_panel",
        }),
      }),
    );
    expect(runtimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        preferences: expect.objectContaining({
          genres: ["Soul", "Jazz", "Downtempo"],
          mood: "Chill",
          energy: "low",
          licenseType: "personal",
          sessionIntent: "Chill",
          sessionIntentName: "Liquid Sky",
          queueStyle: "Soft transitions",
          source: "agent_session_intent_panel",
        }),
      }),
    );
  });
});
