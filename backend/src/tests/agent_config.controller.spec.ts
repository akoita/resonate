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

const DEFAULT_RUN_RESULT = {
  status: "no_pick",
  reason: "empty_catalog",
  latencyMs: 12,
  picks: [],
};

function makeController(
  overrides: {
    runResult?: unknown;
    paymentRouter?: unknown;
    negotiatorService?: unknown;
    learningService?: unknown;
  } = {},
) {
  return new AgentConfigController(
    {} as any,
    {
      run: jest.fn().mockResolvedValue(overrides.runResult ?? DEFAULT_RUN_RESULT),
    } as any,
    (overrides.paymentRouter ?? {}) as any,
    (overrides.negotiatorService ?? {}) as any,
    {
      enrichConfig: jest.fn().mockImplementation(async (config: unknown) => config),
    } as any,
    (overrides.learningService ?? {
      resolveTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
      recordSignal: jest.fn(),
    }) as any,
    { recordValidation: jest.fn() } as any,
    { publish: jest.fn() } as any,
  );
}

const BUY_MODE_ENV = "AGENT_SESSION_BUY_MODE_ENABLED";

const LISTING = {
  listingId: 1n,
  tokenId: 2n,
  stemId: null,
  pricePerUnit: "100",
  chainId: 31337,
  stemType: "vocals",
};

const ORCHESTRATOR_RESULT = {
  tracks: [
    {
      trackId: "track_1",
      negotiation: {
        licenseType: "remix",
        priceUsd: 1,
        allowed: true,
        reason: "within_budget",
        listings: [LISTING],
      },
    },
  ],
};

const LLM_RESULT = {
  status: "picked",
  reason: "matches_mood",
  latencyMs: 20,
  picks: [{ trackId: "track_1", licenseType: "remix", priceUsd: 1 }],
};

describe("AgentConfigController", () => {
  const originalBuyModeFlag = process.env[BUY_MODE_ENV];

  beforeEach(() => {
    delete process.env[BUY_MODE_ENV];
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
    if (originalBuyModeFlag === undefined) {
      delete process.env[BUY_MODE_ENV];
    } else {
      process.env[BUY_MODE_ENV] = originalBuyModeFlag;
    }
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
  describe("session mode (ADR-TE-1)", () => {
    const req = { user: { userId: "user_1" } };

    function storeBuyMode() {
      findUniqueAgentConfig.mockResolvedValue({
        id: "agent_1",
        userId: "user_1",
        name: "booba",
        vibes: ["Focus"],
        stemTypes: ["all"],
        monthlyCapUsd: 10,
        sessionMode: "buy",
      });
    }

    function makePaymentRouter() {
      return {
        purchase: jest.fn().mockResolvedValue({ success: true, txHash: "0xabc", remaining: 9 }),
      };
    }

    function makeNegotiator(allowed = true) {
      return {
        negotiate: jest.fn().mockResolvedValue({
          licenseType: "remix",
          priceUsd: 1,
          allowed,
          reason: allowed ? "within_budget" : "over_budget",
          listings: allowed ? [LISTING] : [],
        }),
      };
    }

    async function runSession(ctrl: AgentConfigController) {
      await ctrl.startSession(req, {});
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(0);
    }

    it("does not purchase in orchestrator mode with a stored buy mode and the flag off", async () => {
      storeBuyMode();
      const paymentRouter = makePaymentRouter();
      const ctrl = makeController({ runResult: ORCHESTRATOR_RESULT, paymentRouter });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
    });

    it("purchases in orchestrator mode when the buy flag is on", async () => {
      process.env[BUY_MODE_ENV] = "true";
      storeBuyMode();
      const paymentRouter = makePaymentRouter();
      const ctrl = makeController({ runResult: ORCHESTRATOR_RESULT, paymentRouter });

      await runSession(ctrl);

      expect(paymentRouter.purchase).toHaveBeenCalledTimes(1);
      expect(paymentRouter.purchase).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session_1", listingId: 1n, tokenId: 2n }),
      );
      expect(updateSession).toHaveBeenCalledWith({
        where: { id: "session_1" },
        data: { spentUsd: 1 },
      });
    });

    it("records the policy step's reasonCode on the LLM pick's accept signal", async () => {
      const learningService = {
        resolveTasteProfile: jest.fn().mockResolvedValue(null),
        mergeLearnedGenres: jest.fn(),
        recordSignal: jest.fn(),
      };
      const ctrl = makeController({
        learningService,
        runResult: {
          ...LLM_RESULT,
          picks: [
            {
              trackId: "track_1",
              licenseType: "remix",
              priceUsd: 1,
              score: 48,
              explanation: ["Selected vibe match"],
              reasonCode: "taste_match",
            },
          ],
        },
      });

      await runSession(ctrl);

      expect(learningService.recordSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            runtime: "llm",
            recommendation: {
              score: 48,
              explanation: ["Selected vibe match"],
              reasonCode: "taste_match",
            },
          }),
        }),
      );
    });

    it("does not negotiate or purchase in LLM mode with a stored buy mode and the flag off", async () => {
      storeBuyMode();
      const paymentRouter = makePaymentRouter();
      const negotiatorService = makeNegotiator();
      const ctrl = makeController({ runResult: LLM_RESULT, paymentRouter, negotiatorService });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(negotiatorService.negotiate).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
    });

    it("negotiates and purchases in LLM mode when the buy flag is on", async () => {
      process.env[BUY_MODE_ENV] = "1";
      storeBuyMode();
      const paymentRouter = makePaymentRouter();
      const negotiatorService = makeNegotiator(true);
      const ctrl = makeController({ runResult: LLM_RESULT, paymentRouter, negotiatorService });

      await runSession(ctrl);

      expect(negotiatorService.negotiate).toHaveBeenCalledWith(
        expect.objectContaining({ trackId: "track_1", licenseType: "remix" }),
      );
      expect(paymentRouter.purchase).toHaveBeenCalledTimes(1);
      expect(updateSession).toHaveBeenCalledWith({
        where: { id: "session_1" },
        data: { spentUsd: 1 },
      });
    });

    it("does not purchase in LLM mode with the flag on when negotiation is not allowed", async () => {
      process.env[BUY_MODE_ENV] = "true";
      storeBuyMode();
      const paymentRouter = makePaymentRouter();
      const negotiatorService = makeNegotiator(false);
      const ctrl = makeController({ runResult: LLM_RESULT, paymentRouter, negotiatorService });

      await runSession(ctrl);

      expect(negotiatorService.negotiate).toHaveBeenCalledTimes(1);
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
    });

    it("never purchases for a curate config even when the buy flag is on", async () => {
      process.env[BUY_MODE_ENV] = "true";
      const paymentRouter = makePaymentRouter();
      const negotiatorService = makeNegotiator();
      const ctrl = makeController({ runResult: LLM_RESULT, paymentRouter, negotiatorService });

      await runSession(ctrl);

      expect(negotiatorService.negotiate).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
    });

    it("rejects PATCH sessionMode=buy with 400 when the flag is off", async () => {
      const ctrl = makeController();

      await expect(ctrl.update(req, { sessionMode: "buy" })).rejects.toMatchObject({
        status: 400,
        response: { reason: "session_buy_mode_disabled" },
      });
      expect(updateAgentConfig).not.toHaveBeenCalled();
    });

    it("accepts PATCH sessionMode=buy when the flag is on", async () => {
      process.env[BUY_MODE_ENV] = "true";
      const ctrl = makeController();

      await ctrl.update(req, { sessionMode: "buy" });

      expect(updateAgentConfig).toHaveBeenCalledWith({
        where: { userId: "user_1" },
        data: { sessionMode: "buy" },
      });
    });

    it("accepts PATCH sessionMode=curate regardless of the flag", async () => {
      const ctrl = makeController();

      await ctrl.update(req, { sessionMode: "curate" });

      expect(updateAgentConfig).toHaveBeenCalledWith({
        where: { userId: "user_1" },
        data: { sessionMode: "curate" },
      });
    });

    it("rejects PATCH with an unknown sessionMode", async () => {
      process.env[BUY_MODE_ENV] = "true";
      const ctrl = makeController();

      await expect(ctrl.update(req, { sessionMode: "spend" })).rejects.toMatchObject({
        status: 400,
        response: { reason: "invalid_session_mode" },
      });
      expect(updateAgentConfig).not.toHaveBeenCalled();
    });
  });
});
