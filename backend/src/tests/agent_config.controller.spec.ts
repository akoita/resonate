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

import { Logger } from "@nestjs/common";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { mergeSessionGenres } from "../modules/agents/agent_session_genres";

function makeController(
  overrides: { runResult?: unknown; identity?: unknown; learningService?: unknown; parser?: unknown } = {},
) {
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
    (overrides.identity ?? {}) as any,
    (overrides.learningService ?? {
      resolveTasteProfile: jest.fn().mockResolvedValue(null),
      mergeLearnedGenres: jest.fn(),
      recordSignal: jest.fn(),
    }) as any,
    { publish: jest.fn() } as any,
    overrides.parser as any,
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
        // #2096: the session's own filters, not the saved vibes.
        filters: {
          presetName: "Liquid Sky",
          genres: ["Soul", "Jazz", "Downtempo"],
          moods: ["Chill"],
          energy: "low",
          explicit: false,
        },
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
          // Saved vibes first, then the session's own genres.
          genres: ["Focus", "Soul", "Jazz", "Downtempo"],
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
  describe("POST /agents/config/session/parse (#2037)", () => {
    const req = { user: { userId: "user_1" } };
    const SENTENCE = "dark deep house for a late drive, 120-125 bpm, under $20";

    function parserReturning(filters: object = {}) {
      return {
        parse: jest.fn().mockResolvedValue({
          filters: {
            ...defaultCrateFilters(),
            genres: ["Deep House"],
            moods: ["Dark"],
            bpm: { min: 120, max: 125 },
            maxTotalUsd: 20,
            ...filters,
          },
          unparsed: ["late drive"],
          strategy: "deterministic",
        }),
      };
    }

    it("returns the listening filters, unparsed phrases, ignored keys and strategy", async () => {
      const parser = parserReturning();
      const ctrl = makeController({ parser });

      const result = await ctrl.parseSession({ text: `  ${SENTENCE}  ` });

      expect(parser.parse).toHaveBeenCalledWith(SENTENCE);
      expect(result).toEqual({
        request: { genres: ["Deep House"], moods: ["Dark"], energy: null, bpm: { min: 120, max: 125 } },
        unparsed: ["late drive"],
        ignored: ["maxTotalUsd"],
        strategy: "deterministic",
      });
    });

    it("rejects text that is only whitespace with 400", async () => {
      const parser = parserReturning();
      const ctrl = makeController({ parser });
      await expect(ctrl.parseSession({ text: "   \n " })).rejects.toMatchObject({ status: 400 });
      expect(parser.parse).not.toHaveBeenCalled();
    });

    it("never persists, publishes or logs the text", async () => {
      const logSpies = (["log", "warn", "error", "debug", "verbose"] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );
      const ctrl = makeController({ parser: parserReturning() });

      await ctrl.parseSession({ text: SENTENCE });

      expect((ctrl as any).eventBus.publish).not.toHaveBeenCalled();
      for (const call of [
        findUniqueAgentConfig,
        updateAgentConfig,
        createSession,
        updateSession,
        findFirstWallet,
        updateWallet,
        createLicense,
      ]) {
        expect(call).not.toHaveBeenCalled();
      }
      for (const spy of logSpies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain("deep house");
        expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTENCE);
        spy.mockRestore();
      }
    });
  });

  describe("session start with a described request (#2037)", () => {
    const req = { user: { userId: "user_1" } };
    const request = {
      genres: ["Deep House"],
      moods: ["Dark", "Moody"],
      energy: "high",
      bpm: { min: 120, max: 125 },
    };

    async function start(ctrl: AgentConfigController, preferences: object) {
      await ctrl.startSession(req, { preferences: preferences as any });
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(0);
    }

    it("joins request genres to the session genres and derives mood, energy, tempo", async () => {
      const ctrl = makeController();

      await start(ctrl, { genres: ["Soul"], request });

      expect((ctrl as any).runtimeService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            genres: ["Focus", "Soul", "Deep House"],
            mood: "Dark",
            moods: ["Dark", "Moody"],
            energy: "high",
            tempoBpm: { min: 120, max: 125 },
            request,
          }),
        }),
      );
      for (const [args] of updateAgentConfig.mock.calls) {
        expect(args.data).toEqual({ isActive: true });
      }
    });

    it("merges request genres after learned favorites and saved vibes", async () => {
      const learningService = {
        resolveTasteProfile: jest.fn().mockResolvedValue({
          favoredGenres: ["Hip Hop"],
          genreWeights: { "Hip Hop": 1 },
        }),
        mergeLearnedGenres: jest.fn((vibes: string[], profile: any, sessionGenres: string[] = []) =>
          mergeSessionGenres({ learnedGenres: profile.favoredGenres, vibes, sessionGenres }),
        ),
        recordSignal: jest.fn(),
      };
      const ctrl = makeController({ learningService });

      await start(ctrl, { request });

      expect((ctrl as any).runtimeService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ genres: ["Hip Hop", "Focus", "Deep House"] }),
        }),
      );
    });

    it("keeps the mood as sent and falls back to the energy as sent", async () => {
      const ctrl = makeController();

      await start(ctrl, {
        mood: "Chill",
        energy: "low",
        request: { genres: ["Soul"], moods: ["Dark"], energy: null, bpm: null },
      });

      const preferences = (ctrl as any).runtimeService.run.mock.calls[0][0].preferences;
      expect(preferences.mood).toBe("Chill");
      expect(preferences.energy).toBe("low");
      expect(preferences.moods).toEqual(["Dark"]);
      expect(preferences).not.toHaveProperty("tempoBpm");
    });

    it("drops an invalid request and runs exactly like a start without one", async () => {
      const withGarbage = makeController();
      await start(withGarbage, { genres: ["Soul"], mood: "Chill", request: { genres: "nope", energy: "wild" } });
      const garbageInput = (withGarbage as any).runtimeService.run.mock.calls[0][0];

      jest.clearAllMocks();
      createSession.mockResolvedValue({ id: "session_1" });
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
      findFirstWallet.mockResolvedValue(null);
      const plain = makeController();
      await start(plain, { genres: ["Soul"], mood: "Chill" });
      const plainInput = (plain as any).runtimeService.run.mock.calls[0][0];

      expect(garbageInput).toEqual(plainInput);
      expect(garbageInput.preferences).not.toHaveProperty("request");
      expect(garbageInput.preferences).not.toHaveProperty("moods");
    });
  });

  describe("curate-only sessions (ADR-TE-1.4)", () => {
    const req = { user: { userId: "user_1" } };
    const pick = { licenseType: "personal", priceUsd: 0, reason: "selected" };
    const orchestratorResult = { tracks: [{ trackId: "track_1", mixPlan: {}, pick }] };
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

    it("records no taste signal when the DJ picks a track (orchestrator path)", async () => {
      const learningService = {
        resolveTasteProfile: jest.fn().mockResolvedValue(null),
        mergeLearnedGenres: jest.fn(),
        recordSignal: jest.fn(),
      };
      const ctrl = makeController({ learningService, runResult: orchestratorResult });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledWith({
        data: {
          sessionId: "session_1",
          trackId: "track_1",
          type: "personal",
          priceUsd: 0,
          durationSeconds: 0,
        },
      });
      expect(learningService.recordSignal).not.toHaveBeenCalled();
    });

    it("records LLM picks as unpriced pick-log rows and no taste signal (#1456)", async () => {
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

      expect(createLicense).toHaveBeenCalledWith({
        data: expect.objectContaining({ trackId: "track_1", priceUsd: 0, durationSeconds: 0 }),
      });
      expect(learningService.recordSignal).not.toHaveBeenCalled();
    });

    it("keeps the preset's genres after merging learned favorites and saved vibes, without writing vibes", async () => {
      const learningService = {
        resolveTasteProfile: jest.fn().mockResolvedValue({
          favoredGenres: ["Hip Hop", "Focus"],
          genreWeights: { "Hip Hop": 1 },
        }),
        mergeLearnedGenres: jest.fn((vibes: string[], profile: any, sessionGenres: string[] = []) =>
          mergeSessionGenres({ learnedGenres: profile.favoredGenres, vibes, sessionGenres }),
        ),
        recordSignal: jest.fn(),
      };
      const ctrl = makeController({ learningService });

      await ctrl.startSession(req, { preferences: { genres: ["Soul", "Jazz"] } });
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(0);

      expect((ctrl as any).runtimeService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            genres: ["Hip Hop", "Focus", "Soul", "Jazz"],
            learnedGenreWeights: { "Hip Hop": 1 },
          }),
        }),
      );
      for (const [args] of updateAgentConfig.mock.calls) {
        expect(args.data).toEqual({ isActive: true });
      }
    });

    it("falls back to saved vibes plus the session's genres when no taste profile resolves", async () => {
      const ctrl = makeController();

      await ctrl.startSession(req, { preferences: { genres: ["Soul"] } });
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(0);

      expect((ctrl as any).runtimeService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ genres: ["Focus", "Soul"] }),
        }),
      );
    });

    it("runs a stored buy-mode config as curate: no purchase, no spend (orchestrator path)", async () => {
      buyConfig();
      const ctrl = makeController({ runResult: orchestratorResult });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(updateSession).not.toHaveBeenCalled();
    });

    it("runs a stored buy-mode config as curate: no purchase, no spend (LLM path)", async () => {
      buyConfig();
      const ctrl = makeController({ runResult: llmResult });

      await runSession(ctrl);

      expect(createLicense).toHaveBeenCalledTimes(1);
      expect(updateSession).not.toHaveBeenCalled();
      expect((ctrl as any).eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.decision_made" }),
      );
      expect((ctrl as any).eventBus.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.decision_made", priceUsd: expect.anything() }),
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

      it("rejects buy with 400 buy_mode_disabled", async () => {
        const ctrl = makeController({ identity });
        await expectReason(ctrl.update(req, { sessionMode: "buy" }), "buy_mode_disabled");
        expect(updateAgentConfig).not.toHaveBeenCalled();
      });

      it("rejects an unknown mode with 400 invalid_session_mode", async () => {
        const ctrl = makeController({ identity });
        await expectReason(ctrl.update(req, { sessionMode: "auto" }), "invalid_session_mode");
        expect(updateAgentConfig).not.toHaveBeenCalled();
      });

      it("accepts curate and no longer reports buyModeEnabled", async () => {
        updateAgentConfig.mockResolvedValue({ id: "agent_1", sessionMode: "curate" });
        const ctrl = makeController({ identity });
        const result = await ctrl.update(req, { sessionMode: "curate" });
        expect(updateAgentConfig).toHaveBeenCalledWith({
          where: { userId: "user_1" },
          data: { sessionMode: "curate" },
        });
        expect(result).toMatchObject({ sessionMode: "curate" });
        expect(result).not.toHaveProperty("buyModeEnabled");
      });

      it("returns the enriched config on GET without buyModeEnabled and keeps null when unconfigured", async () => {
        const ctrl = makeController({ identity });
        const got = await ctrl.get(req);
        expect(got).toMatchObject({ enriched: true });
        expect(got).not.toHaveProperty("buyModeEnabled");
        findUniqueAgentConfig.mockResolvedValue(null);
        await expect(ctrl.get(req)).resolves.toBeNull();
      });
    });
  });
});
