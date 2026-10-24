import {
  BACKGROUND_LOOPS,
  BACKEND_RUNTIME_MODES,
  backgroundLoopDecisions,
  backgroundLoopProviders,
  resetBackgroundLoopDecisions,
  resetRuntimeModeWarnings,
  resolveBackendRuntimeMode,
  runsBackgroundLoops,
  servesPublicApi,
  shouldRunBackgroundLoop,
  type BackgroundLoopId,
} from "../config/runtime_mode";
import { workerHealthOnlyMiddleware } from "../modules/health/worker_health_only.middleware";

describe("backend runtime mode (#1608)", () => {
  beforeEach(() => {
    resetRuntimeModeWarnings();
    resetBackgroundLoopDecisions();
  });

  describe("resolveBackendRuntimeMode", () => {
    it("defaults to combined when unset or blank, without a warning", () => {
      const warn = jest.fn();
      expect(resolveBackendRuntimeMode({}, warn)).toBe("combined");
      expect(resolveBackendRuntimeMode({ BACKEND_RUNTIME_MODE: "  " }, warn)).toBe("combined");
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(BACKEND_RUNTIME_MODES)("accepts %s", (mode) => {
      const warn = jest.fn();
      expect(resolveBackendRuntimeMode({ BACKEND_RUNTIME_MODE: mode }, warn)).toBe(mode);
      expect(warn).not.toHaveBeenCalled();
    });

    it("trims and lower-cases the value", () => {
      expect(resolveBackendRuntimeMode({ BACKEND_RUNTIME_MODE: " Worker " }, jest.fn())).toBe("worker");
      expect(resolveBackendRuntimeMode({ BACKEND_RUNTIME_MODE: "API" }, jest.fn())).toBe("api");
    });

    it("falls back to combined for an unknown value and warns once per value", () => {
      const warn = jest.fn();
      const env = { BACKEND_RUNTIME_MODE: "indexer" };
      expect(resolveBackendRuntimeMode(env, warn)).toBe("combined");
      expect(resolveBackendRuntimeMode(env, warn)).toBe("combined");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Unknown BACKEND_RUNTIME_MODE "indexer"');
      expect(warn.mock.calls[0][0]).toContain("combined, api, worker");

      resolveBackendRuntimeMode({ BACKEND_RUNTIME_MODE: "other" }, warn);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe("mode capabilities", () => {
    it("combined does both, api only serves, worker only runs loops", () => {
      expect([runsBackgroundLoops("combined"), servesPublicApi("combined")]).toEqual([true, true]);
      expect([runsBackgroundLoops("api"), servesPublicApi("api")]).toEqual([false, true]);
      expect([runsBackgroundLoops("worker"), servesPublicApi("worker")]).toEqual([true, false]);
    });
  });

  describe("shouldRunBackgroundLoop", () => {
    const ids = Object.keys(BACKGROUND_LOOPS) as BackgroundLoopId[];

    it("starts every declared loop in combined and worker mode", () => {
      for (const mode of ["combined", "worker"]) {
        for (const id of ids) {
          expect(shouldRunBackgroundLoop(id, undefined, { BACKEND_RUNTIME_MODE: mode })).toBe(true);
        }
      }
      expect(shouldRunBackgroundLoop("contractIndexer", undefined, {})).toBe(true);
    });

    it("starts no declared loop in api mode, says why, and records the decision", () => {
      const logger = { log: jest.fn() };
      for (const id of ids) {
        expect(shouldRunBackgroundLoop(id, logger, { BACKEND_RUNTIME_MODE: "api" })).toBe(false);
      }
      expect(logger.log).toHaveBeenCalledTimes(ids.length);
      expect(logger.log.mock.calls[0][0]).toContain("BACKEND_RUNTIME_MODE=api");
      expect(Object.values(backgroundLoopDecisions())).toEqual(ids.map(() => false));
    });

    it("keeps an invalid mode on today's behaviour (loops run) and warns through the console", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        expect(
          shouldRunBackgroundLoop("showsEscrowIndexer", undefined, { BACKEND_RUNTIME_MODE: "nope" }),
        ).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("backgroundLoopProviders", () => {
    class Processor {}

    it("keeps the providers where loops run and drops them in api mode", () => {
      expect(backgroundLoopProviders("stemsQueueProcessor", [Processor], {})).toEqual([Processor]);
      expect(
        backgroundLoopProviders("stemsQueueProcessor", [Processor], { BACKEND_RUNTIME_MODE: "worker" }),
      ).toEqual([Processor]);
      expect(
        backgroundLoopProviders("stemsQueueProcessor", [Processor], { BACKEND_RUNTIME_MODE: "api" }),
      ).toEqual([]);
    });
  });

  describe("workerHealthOnlyMiddleware", () => {
    function run(path: string) {
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      workerHealthOnlyMiddleware()({ path } as any, res, next);
      return { res, next };
    }

    it("lets /health through", () => {
      expect(run("/health").next).toHaveBeenCalled();
      expect(run("/health/").next).toHaveBeenCalled();
    });

    it("answers 404 for everything else, before any route runs", () => {
      for (const path of ["/", "/catalog/published", "/healthz", "/metadata/indexer/status"]) {
        const { res, next } = run(path);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(404);
      }
    });
  });
});
