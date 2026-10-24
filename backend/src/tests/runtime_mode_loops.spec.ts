import "reflect-metadata";
import { Logger } from "@nestjs/common";

jest.mock("../modules/ingestion/pubsub-runtime", () => ({
  resolvePubSubRuntimeConfig: jest.fn(async () => ({ enabled: false, reason: "test" })),
}));

import { ContractsService } from "../modules/contracts/contracts.service";
import { IndexerService } from "../modules/contracts/indexer.service";
import { ShowsEscrowIndexerService } from "../modules/shows/shows-escrow-indexer.service";
import { StemWatchdogService } from "../modules/ingestion/stem-watchdog.service";
import { StemResultSubscriber } from "../modules/ingestion/stem-result.subscriber";
import { X402RefundWatchdogService } from "../modules/punchline/x402-refund-watchdog.service";
import { AgentReputationSchedulerService } from "../modules/agents/agent_reputation_scheduler.service";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { EventBus } from "../modules/shared/event_bus";
import { resolvePubSubRuntimeConfig } from "../modules/ingestion/pubsub-runtime";
import {
  backgroundLoopDecisions,
  resetBackgroundLoopDecisions,
  resetRuntimeModeWarnings,
} from "../config/runtime_mode";

/**
 * #1608: in `api` mode no background loop starts; in `worker` (and the default
 * `combined`) mode they do. Each case drives the real `onModuleInit` and spies
 * on the work the loop would perform.
 */
const ENV_KEYS = [
  "BACKEND_RUNTIME_MODE",
  "NODE_ENV",
  "ENABLE_CONTRACT_INDEXER",
  "ENABLE_SHOWS_ESCROW_INDEXER",
  "STEM_PROCESSING_MODE",
  "ERC8004_ENABLED",
  "ERC8004_REPUTATION_SCHEDULER_ENABLED",
  "DISCOVERY_POPULARITY_SOURCE",
  "DISCOVERY_POPULARITY_REFRESH_MINUTES",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function applyEnv(mode: string | undefined) {
  // The watchdogs and the refresh timer stay off under NODE_ENV=test.
  process.env.NODE_ENV = "development";
  process.env.ENABLE_CONTRACT_INDEXER = "true";
  process.env.ENABLE_SHOWS_ESCROW_INDEXER = "true";
  process.env.STEM_PROCESSING_MODE = "pubsub";
  process.env.ERC8004_ENABLED = "true";
  process.env.ERC8004_REPUTATION_SCHEDULER_ENABLED = "true";
  process.env.DISCOVERY_POPULARITY_SOURCE = "local";
  process.env.DISCOVERY_POPULARITY_REFRESH_MINUTES = "15";
  if (mode === undefined) delete process.env.BACKEND_RUNTIME_MODE;
  else process.env.BACKEND_RUNTIME_MODE = mode;
}

describe("background loops follow BACKEND_RUNTIME_MODE (#1608)", () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    resetBackgroundLoopDecisions();
    resetRuntimeModeWarnings();
    (resolvePubSubRuntimeConfig as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  type Harness = {
    name: string;
    loopId: string;
    /** Boots the service, returns how many times its work started and a teardown. */
    boot: () => Promise<{ started: () => number; stop: () => Promise<void> | void }>;
  };

  const noop = () => undefined;
  const harnesses: Harness[] = [
    {
      name: "contract indexer",
      loopId: "contractIndexer",
      boot: async () => {
        const service = new IndexerService(new EventBus());
        const cycle = jest.spyOn(service as any, "runIndexCycle").mockResolvedValue(undefined);
        await service.onModuleInit();
        return { started: () => cycle.mock.calls.length, stop: () => service.onModuleDestroy() };
      },
    },
    {
      name: "Shows escrow indexer",
      loopId: "showsEscrowIndexer",
      boot: async () => {
        const service = new ShowsEscrowIndexerService(new EventBus());
        const cycle = jest.spyOn(service, "runIndexCycle").mockResolvedValue(undefined);
        await service.onModuleInit();
        return {
          started: () => cycle.mock.calls.length,
          // onModuleDestroy releases leases through Prisma; the spec only owns the timer.
          stop: () => {
            const interval = (service as any).interval as NodeJS.Timeout | null;
            if (interval) clearInterval(interval);
          },
        };
      },
    },
    {
      name: "contracts startup reconcilers and sale-split retry",
      loopId: "contractsStartupReconcile",
      boot: async () => {
        const bus = new EventBus();
        const service = new ContractsService(bus, {} as any);
        const spies = [
          jest.spyOn(service, "reconcileListings").mockResolvedValue(undefined),
          jest.spyOn(service as any, "reconcileListingLifecycle").mockResolvedValue(undefined),
          jest.spyOn(service as any, "reconcileOrphanListings").mockResolvedValue(undefined),
          jest.spyOn(service, "finalizePendingSaleSplits").mockResolvedValue(undefined as any),
        ];
        const subscribe = jest.spyOn(bus, "subscribe");
        await service.onModuleInit();
        // Event handlers register in every mode: they react to events from this process.
        expect(subscribe).toHaveBeenCalled();
        return { started: () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0), stop: noop };
      },
    },
    {
      name: "stem watchdog",
      loopId: "stemWatchdog",
      boot: async () => {
        const service = new StemWatchdogService(new EventBus());
        const sweep = jest.spyOn(service, "runWatchdogSweep").mockResolvedValue(undefined as any);
        service.onModuleInit();
        return { started: () => sweep.mock.calls.length, stop: () => service.onModuleDestroy() };
      },
    },
    {
      name: "x402 refund watchdog",
      loopId: "x402RefundWatchdog",
      boot: async () => {
        const service = new X402RefundWatchdogService(new EventBus());
        const sweep = jest.spyOn(service, "runSweepOnce").mockResolvedValue(undefined);
        service.onModuleInit();
        return { started: () => sweep.mock.calls.length, stop: () => service.onModuleDestroy() };
      },
    },
    {
      name: "agent reputation scheduler",
      loopId: "agentReputationScheduler",
      boot: async () => {
        const values: Record<string, string | undefined> = { ...process.env };
        const service = new AgentReputationSchedulerService(
          {} as any,
          { get: (key: string) => values[key] } as any,
        );
        const sweep = jest.spyOn(service, "runSchedulerSweep").mockResolvedValue({} as any);
        service.onModuleInit();
        return { started: () => sweep.mock.calls.length, stop: () => service.onModuleDestroy() };
      },
    },
    {
      name: "discovery popularity refresh",
      loopId: "discoveryPopularityRefresh",
      boot: async () => {
        const service = new DiscoveryPopularityService();
        const refresh = jest.spyOn(service, "refreshAll").mockResolvedValue(undefined);
        service.onModuleInit();
        return { started: () => refresh.mock.calls.length, stop: () => service.onModuleDestroy() };
      },
    },
    {
      name: "Pub/Sub stem-results subscriber",
      loopId: "stemResultSubscriber",
      boot: async () => {
        const service = new StemResultSubscriber(
          new EventBus(),
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );
        await service.onModuleInit();
        return {
          started: () => (resolvePubSubRuntimeConfig as jest.Mock).mock.calls.length,
          stop: noop,
        };
      },
    },
  ];

  describe.each(harnesses)("$name", (harness) => {
    it("does not start in api mode", async () => {
      applyEnv("api");
      const running = await harness.boot();
      expect(running.started()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      expect(backgroundLoopDecisions()[harness.loopId]).toBe(false);
      await running.stop();
    });

    it.each([
      { label: "worker", mode: "worker" },
      { label: "combined", mode: "combined" },
      { label: "default (unset)", mode: undefined },
    ])("starts in $label mode", async ({ mode }) => {
      applyEnv(mode);
      const running = await harness.boot();
      expect(running.started()).toBeGreaterThan(0);
      expect(backgroundLoopDecisions()[harness.loopId]).toBe(true);
      await running.stop();
    });
  });

  describe("queue processors are providers only where loops run", () => {
    const queueModules = [
      {
        file: "../modules/ingestion/ingestion.module",
        exportName: "IngestionModule",
        processorFile: "../modules/ingestion/stems.processor",
        processorName: "StemsProcessor",
      },
      {
        file: "../modules/generation/generation.module",
        exportName: "GenerationModule",
        processorFile: "../modules/generation/generation.processor",
        processorName: "GenerationProcessor",
      },
      {
        file: "../modules/remix/remix.module",
        exportName: "RemixModule",
        processorFile: "../modules/remix/remix-generation.processor",
        processorName: "RemixGenerationProcessor",
      },
    ];

    function loadProviders(mode: string | undefined, entry: (typeof queueModules)[number]) {
      applyEnv(mode);
      let providers: unknown[] = [];
      let processor: unknown;
      jest.isolateModules(() => {
        const moduleClass = require(entry.file)[entry.exportName];
        processor = require(entry.processorFile)[entry.processorName];
        providers = Reflect.getMetadata("providers", moduleClass) ?? [];
      });
      return { providers, processor };
    }

    it.each(queueModules)("$exportName registers $processorName by mode", (entry) => {
      const api = loadProviders("api", entry);
      expect(api.providers).not.toContain(api.processor);
      // Still has the rest of its providers: only the consumer is withheld.
      expect(api.providers.length).toBeGreaterThan(0);

      for (const mode of ["worker", "combined", undefined]) {
        const loaded = loadProviders(mode, entry);
        expect(loaded.providers).toContain(loaded.processor);
      }
    });
  });
});
