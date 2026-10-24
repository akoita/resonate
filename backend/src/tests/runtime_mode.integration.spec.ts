/**
 * #1608: the real `AppModule`, booted per `BACKEND_RUNTIME_MODE`.
 *
 * `api` must start no background loop (no indexer interval, no queue
 * processor, no sweep timer); `worker` must start them and answer only
 * `/health`. The loop flags are switched on so that, absent the mode, every
 * indexer would start.
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

const ENV_KEYS = [
  "BACKEND_RUNTIME_MODE",
  "NODE_ENV",
  "ENABLE_CONTRACT_INDEXER",
  "ENABLE_SHOWS_ESCROW_INDEXER",
  "JWT_SECRET",
] as const;

type Booted = {
  app: INestApplication;
  indexer: any;
  shows: any;
  stemsProcessor: unknown;
  decisions: Record<string, boolean>;
};

async function boot(mode: string): Promise<Booted> {
  process.env.BACKEND_RUNTIME_MODE = mode;
  process.env.ENABLE_CONTRACT_INDEXER = "true";
  process.env.ENABLE_SHOWS_ESCROW_INDEXER = "true";
  process.env.JWT_SECRET ||= "runtime-mode-integration-test-only";
  // Fresh module graph: queue processors are chosen when modules are loaded.
  // Every @nestjs/* package is reloaded with it so the graph shares one copy.
  jest.resetModules();
  const { Test } = require("@nestjs/testing");
  const { applyGlobalValidation } = require("../config/validation");
  const {
    workerHealthOnlyMiddleware,
  } = require("../modules/health/worker_health_only.middleware");
  const { AppModule } = require("../modules/app.module");
  const { IndexerService } = require("../modules/contracts/indexer.service");
  const { ShowsEscrowIndexerService } = require("../modules/shows/shows-escrow-indexer.service");
  const { StemsProcessor } = require("../modules/ingestion/stems.processor");
  const runtime = require("../config/runtime_mode");
  runtime.resetBackgroundLoopDecisions();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  applyGlobalValidation(app);
  if (mode === "worker") app.use(workerHealthOnlyMiddleware());
  await app.init();

  let stemsProcessor: unknown = null;
  try {
    stemsProcessor = moduleRef.get(StemsProcessor, { strict: false });
  } catch {
    stemsProcessor = null;
  }
  return {
    app,
    indexer: moduleRef.get(IndexerService, { strict: false }),
    shows: moduleRef.get(ShowsEscrowIndexerService, { strict: false }),
    stemsProcessor,
    decisions: runtime.backgroundLoopDecisions(),
  };
}

describe("AppModule per BACKEND_RUNTIME_MODE (#1608)", () => {
  const saved: Record<string, string | undefined> = {};
  let booted: Booted | undefined;

  beforeAll(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(async () => {
    await booted?.app.close();
    booted = undefined;
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("api mode starts no indexer and registers no queue processor, but still serves", async () => {
    booted = await boot("api");

    expect(booted.indexer.indexingInterval).toBeNull();
    expect(booted.shows.interval).toBeNull();
    expect(booted.stemsProcessor).toBeNull();
    expect(booted.decisions).toEqual(
      expect.objectContaining({ contractIndexer: false, showsEscrowIndexer: false }),
    );
    expect(Object.values(booted.decisions).every((started) => started === false)).toBe(true);

    // The indexers stay constructed: request paths still use them on demand.
    expect(typeof booted.indexer.runIndexCycle).toBe("function");
    await request(booted.app.getHttpServer()).get("/health").expect(200);
  });

  it("worker mode starts the indexers and the queue processor and answers only /health", async () => {
    booted = await boot("worker");

    expect(booted.indexer.indexingInterval).not.toBeNull();
    expect(booted.shows.interval).not.toBeNull();
    expect(booted.stemsProcessor).not.toBeNull();
    expect(booted.decisions).toEqual(
      expect.objectContaining({ contractIndexer: true, showsEscrowIndexer: true }),
    );

    await request(booted.app.getHttpServer()).get("/health").expect(200);
    await request(booted.app.getHttpServer()).get("/metadata/indexer/status").expect(404);
  });

  it("combined mode (the default) is today's behaviour: loops and HTTP", async () => {
    booted = await boot("combined");

    expect(booted.indexer.indexingInterval).not.toBeNull();
    expect(booted.shows.interval).not.toBeNull();
    expect(booted.stemsProcessor).not.toBeNull();
    await request(booted.app.getHttpServer()).get("/health").expect(200);
  });
});
