const findUniqueAgentConfig = jest.fn();
const updateAgentConfig = jest.fn();
const createSession = jest.fn();
const updateSession = jest.fn();
const findFirstWallet = jest.fn();
const updateWallet = jest.fn();
const createLicense = jest.fn();
const findUniqueSession = jest.fn();

jest.mock("../db/prisma", () => ({
  prisma: {
    agentConfig: {
      findUnique: (...args: unknown[]) => findUniqueAgentConfig(...args),
      update: (...args: unknown[]) => updateAgentConfig(...args),
    },
    session: {
      create: (...args: unknown[]) => createSession(...args),
      update: (...args: unknown[]) => updateSession(...args),
      findUnique: (...args: unknown[]) => findUniqueSession(...args),
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

type RuntimeResult = Record<string, unknown>;

function makeController(overrides: { runtimeResult?: RuntimeResult } = {}) {
  const paymentRouter = {
    purchase: jest.fn().mockResolvedValue({ success: true, txHash: "0xabc", remaining: 5 }),
  };
  const negotiator = {
    negotiate: jest.fn().mockResolvedValue({
      allowed: true,
      licenseType: "remix",
      priceUsd: 2,
      listings: [{ listingId: 1n, tokenId: 7n, pricePerUnit: 1000n, stemType: "vocals", stemId: "stem_1" }],
    }),
  };
  const controller = new AgentConfigController(
    {} as any,
    {
      run: jest.fn().mockResolvedValue(
        overrides.runtimeResult ?? {
          status: "no_pick",
          reason: "empty_catalog",
          latencyMs: 12,
          picks: [],
        },
      ),
    } as any,
    paymentRouter as any,
    negotiator as any,
    {} as any,
    {
      computeTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
      recordSignal: jest.fn(),
    } as any,
    { recordValidation: jest.fn() } as any,
    { publish: jest.fn() } as any,
  );
  return { controller, paymentRouter, negotiator };
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
    findUniqueSession.mockResolvedValue({ budgetCapUsd: 10, spentUsd: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.AGENT_SESSION_BUY_MODE_ENABLED;
  });

  it("starts a session with intent preferences and forwards them to events and runtime", async () => {
    const { controller: ctrl } = makeController();
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
  describe("buy mode (ADR-TE-1)", () => {
    const req = { user: { userId: "user_1" } };
    const llmPick = {
      status: "ok",
      reason: "llm",
      latencyMs: 5,
      picks: [{ trackId: "track_1", licenseType: "remix", priceUsd: 2 }],
    };
    const orchestratorPick = {
      tracks: [
        {
          trackId: "track_1",
          negotiation: {
            allowed: true,
            licenseType: "remix",
            priceUsd: 2,
            reason: "ok",
            listings: [{ listingId: 1n, tokenId: 7n, pricePerUnit: 1000n, stemType: "vocals", stemId: "stem_1" }],
          },
        },
      ],
    };

    function storeSessionMode(sessionMode: string) {
      findUniqueAgentConfig.mockResolvedValue({
        id: "agent_1",
        userId: "user_1",
        name: "booba",
        vibes: ["Bass"],
        stemTypes: ["all"],
        monthlyCapUsd: 10,
        sessionMode,
      });
    }

    it.each([
      ["LLM picks", llmPick],
      ["orchestrator picks", orchestratorPick],
    ])("does not negotiate or purchase a stored buy session when the flag is off (%s)", async (_label, runtimeResult) => {
      storeSessionMode("buy");
      const { controller, paymentRouter, negotiator } = makeController({ runtimeResult });

      await controller.startSession(req, { preferences: { mood: "Hype", licenseType: "remix" } });
      await jest.advanceTimersByTimeAsync(500);

      expect(createLicense).toHaveBeenCalled();
      expect(negotiator.negotiate).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
    });

    it("keeps today's buy behavior when the flag is on (LLM picks)", async () => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
      storeSessionMode("buy");
      const { controller, paymentRouter, negotiator } = makeController({ runtimeResult: llmPick });

      await controller.startSession(req, { preferences: { mood: "Hype", licenseType: "remix" } });
      await jest.advanceTimersByTimeAsync(500);

      expect(negotiator.negotiate).toHaveBeenCalledWith(expect.objectContaining({ trackId: "track_1" }));
      expect(paymentRouter.purchase).toHaveBeenCalledWith(
        expect.objectContaining({ rail: "erc4337_marketplace", userId: "user_1", sessionId: "session_1" }),
      );
    });

    it("keeps today's buy behavior when the flag is on (orchestrator picks)", async () => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
      storeSessionMode("buy");
      const { controller, paymentRouter } = makeController({ runtimeResult: orchestratorPick });

      await controller.startSession(req, { preferences: { mood: "Hype", licenseType: "remix" } });
      await jest.advanceTimersByTimeAsync(500);

      expect(paymentRouter.purchase).toHaveBeenCalledTimes(1);
    });

    it("never purchases a curate session, even with the flag on", async () => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
      storeSessionMode("curate");
      const { controller, paymentRouter, negotiator } = makeController({ runtimeResult: llmPick });

      await controller.startSession(req, { preferences: { mood: "Focus" } });
      await jest.advanceTimersByTimeAsync(500);

      expect(negotiator.negotiate).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
    });
  });
});
