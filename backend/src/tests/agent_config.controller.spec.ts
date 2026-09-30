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

function makeController(overrides: { runResult?: unknown; paymentRouter?: unknown; negotiator?: unknown; identity?: unknown; learningService?: unknown } = {}) {
  return new AgentConfigController(
    {} as any,
    {
      run: jest.fn().mockResolvedValue(
        overrides.runResult ?? {
          status: "no_pick",
          reason: "empty_catalog",
          latencyMs: 12,
          picks: [],
        },
      ),
    } as any,
    (overrides.paymentRouter ?? {}) as any,
    (overrides.negotiator ?? {}) as any,
    (overrides.identity ?? {}) as any,
    (overrides.learningService ?? {
      resolveTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
      recordSignal: jest.fn(),
    }) as any,
    {} as any,
    { publish: jest.fn() } as any,
  );
}

const ENV_KEY = "AGENT_SESSION_BUY_MODE_ENABLED";
const originalFlag = process.env[ENV_KEY];

describe("AgentConfigController", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
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
    if (originalFlag === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalFlag;
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
  describe("buy mode gating (#1954)", () => {
    const req = { user: { userId: "user_1" } };
    const negotiation = {
      allowed: true,
      licenseType: "personal",
      priceUsd: 2,
      reason: "ok",
      listings: [{ listingId: 1n, tokenId: 1n, pricePerUnit: 1n, stemType: "drums" }],
    };
    const orchestratorResult = { tracks: [{ trackId: "track_1", negotiation }] };
    const llmResult = {
      status: "picked",
      reason: "llm",
      latencyMs: 5,
      picks: [{ trackId: "track_1", licenseType: "personal", priceUsd: 2 }],
    };

    function buyConfig() {
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

    async function runSession(ctrl: AgentConfigController) {
      await ctrl.startSession(req, {});
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(0);
    }

    it("records the policy step's reasonCode on the LLM pick's accept signal (#1456)", async () => {
      const learningService = {
        resolveTasteProfile: jest.fn().mockResolvedValue(null),
        mergeLearnedGenres: jest.fn(),
        recordSignal: jest.fn(),
      };
      const ctrl = makeController({
        learningService,
        runResult: {
          ...llmResult,
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

    it("does not purchase or record spend for stored buy mode when the flag is off (orchestrator path)", async () => {
      buyConfig();
      const paymentRouter = { purchase: jest.fn() };
      const ctrl = makeController({ runResult: orchestratorResult, paymentRouter });
      const spy = jest.spyOn(ctrl as any, "recordPurchase").mockResolvedValue(undefined);

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
    });

    it("still purchases and records spend in buy mode when the flag is on (orchestrator path)", async () => {
      process.env[ENV_KEY] = "true";
      buyConfig();
      const ctrl = makeController({ runResult: orchestratorResult });
      const spy = jest.spyOn(ctrl as any, "recordPurchase").mockResolvedValue(undefined);

      await runSession(ctrl);

      expect(spy).toHaveBeenCalledWith("session_1", "user_1", "track_1", negotiation);
      expect(updateSession).toHaveBeenCalledWith({
        where: { id: "session_1" },
        data: { spentUsd: 2 },
      });
    });

    it("does not negotiate, purchase or record spend when the flag is off (LLM path)", async () => {
      buyConfig();
      const negotiator = { negotiate: jest.fn() };
      const paymentRouter = { purchase: jest.fn() };
      const ctrl = makeController({ runResult: llmResult, negotiator, paymentRouter });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(negotiator.negotiate).not.toHaveBeenCalled();
      expect(paymentRouter.purchase).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
      expect((ctrl as any).eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.decision_made", priceUsd: 0 }),
      );
    });

    it("still negotiates, purchases and records spend when the flag is on (LLM path)", async () => {
      process.env[ENV_KEY] = "true";
      buyConfig();
      const negotiator = { negotiate: jest.fn().mockResolvedValue(negotiation) };
      const ctrl = makeController({ runResult: llmResult, negotiator });
      const spy = jest.spyOn(ctrl as any, "recordPurchase").mockResolvedValue(undefined);

      await runSession(ctrl);

      expect(negotiator.negotiate).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(updateSession).toHaveBeenCalledWith({
        where: { id: "session_1" },
        data: { spentUsd: 2 },
      });
      expect((ctrl as any).eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.decision_made", priceUsd: 2 }),
      );
    });

    describe("PATCH /agents/config", () => {
      const identity = { enrichConfig: jest.fn(async (c: any) => ({ ...c, enriched: true })) };

      async function expectReason(promise: Promise<unknown>, reason: string) {
        await expect(promise).rejects.toMatchObject({
          status: 400,
          response: { reason },
        });
      }

      it("rejects buy with 400 buy_mode_disabled when the flag is off", async () => {
        const ctrl = makeController({ identity });
        await expectReason(ctrl.update(req, { sessionMode: "buy" }), "buy_mode_disabled");
        expect(updateAgentConfig).not.toHaveBeenCalled();
      });

      it("rejects an unknown mode with 400 invalid_session_mode", async () => {
        process.env[ENV_KEY] = "true";
        const ctrl = makeController({ identity });
        await expectReason(ctrl.update(req, { sessionMode: "auto" }), "invalid_session_mode");
        expect(updateAgentConfig).not.toHaveBeenCalled();
      });

      it("accepts curate with the flag off and reports buyModeEnabled=false", async () => {
        updateAgentConfig.mockResolvedValue({ id: "agent_1", sessionMode: "curate" });
        const ctrl = makeController({ identity });
        const result = await ctrl.update(req, { sessionMode: "curate" });
        expect(updateAgentConfig).toHaveBeenCalledWith({
          where: { userId: "user_1" },
          data: { sessionMode: "curate" },
        });
        expect(result).toMatchObject({ sessionMode: "curate", buyModeEnabled: false });
      });

      it("accepts buy when the flag is on and reports buyModeEnabled=true", async () => {
        process.env[ENV_KEY] = "true";
        updateAgentConfig.mockResolvedValue({ id: "agent_1", sessionMode: "buy" });
        const ctrl = makeController({ identity });
        const result = await ctrl.update(req, { sessionMode: "buy" });
        expect(result).toMatchObject({ sessionMode: "buy", buyModeEnabled: true });
      });

      it("includes buyModeEnabled on GET and keeps null when unconfigured", async () => {
        const ctrl = makeController({ identity });
        await expect(ctrl.get(req)).resolves.toMatchObject({ enriched: true, buyModeEnabled: false });
        findUniqueAgentConfig.mockResolvedValue(null);
        await expect(ctrl.get(req)).resolves.toBeNull();
      });
    });
  });
});
