import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { InMemoryAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import {
  AnalyticsWarehouseLoaderService,
  analyticsWarehouseTargetFromEnv,
  LocalJsonAnalyticsWarehouseTarget,
  supportedEventVersionsFromEnv,
} from "../modules/analytics/analytics_warehouse_loader";

describe("analytics warehouse loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resonate-analytics-warehouse-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads generated layers idempotently into the local JSON target", async () => {
    const store = new InMemoryAnalyticsEventStore();
    const ingest = new AnalyticsIngestService(store);
    const loader = new AnalyticsWarehouseLoaderService(store, new LocalJsonAnalyticsWarehouseTarget(tempDir));

    await ingest.ingest({
      eventId: "evt_loader_play",
      eventName: "playback.completed",
      occurredAt: "2026-05-20T09:00:00.000Z",
      payload: { artistId: "artist-1", trackId: "track-1" },
    });

    const first = await loader.load({ runId: "run-1" });
    const second = await loader.load({ runId: "run-2" });

    expect(first.status).toBe("ok");
    expect(first.metrics.insertedRows).toBeGreaterThan(0);
    expect(second.metrics.insertedRows).toBe(0);
    expect(second.metrics.skippedRows).toBe(first.metrics.insertedRows);

    const rawRows = await readJsonl(join(tempDir, "analytics_local_events_raw.jsonl"));
    expect(rawRows).toEqual([
      expect.objectContaining({
        eventId: "evt_loader_play",
        eventName: "playback.completed",
      }),
    ]);
  });

  it("quarantines unsupported families and schema-incompatible versions before writing facts", async () => {
    const store = new InMemoryAnalyticsEventStore();
    const ingest = new AnalyticsIngestService(store);
    const loader = new AnalyticsWarehouseLoaderService(store, new LocalJsonAnalyticsWarehouseTarget(tempDir));

    await ingest.ingest({
      eventId: "evt_loader_unknown",
      eventName: "unknown.created",
      eventVersion: 1,
      occurredAt: "2026-05-20T09:00:00.000Z",
      payload: {},
    });
    await ingest.ingest({
      eventId: "evt_loader_v2",
      eventName: "playback.completed",
      eventVersion: 2,
      occurredAt: "2026-05-20T09:01:00.000Z",
      payload: {},
    });

    const result = await loader.load({ runId: "run-quarantine" });

    expect(result.layers.eventsRaw).toBe(2);
    expect(result.layers.analyticsFacts).toBe(0);
    expect(result.layers.analyticsQuarantine).toBe(2);
    expect(result.metrics.schemaIncompatibleRows).toBe(1);

    const quarantineRows = await readJsonl(join(tempDir, "analytics_local_analytics_quarantine.jsonl"));
    expect(quarantineRows).toEqual([
      expect.objectContaining({ eventId: "evt_loader_unknown", reason: "unsupported event family: unknown" }),
      expect.objectContaining({ eventId: "evt_loader_v2", reason: "unsupported event version: 2" }),
    ]);
  });

  it("parses supported event versions from environment configuration", () => {
    expect(supportedEventVersionsFromEnv({ ANALYTICS_WAREHOUSE_SUPPORTED_EVENT_VERSIONS: "1,2, 4" })).toEqual([
      1,
      2,
      4,
    ]);
    expect(supportedEventVersionsFromEnv({ ANALYTICS_WAREHOUSE_SUPPORTED_EVENT_VERSIONS: "bad" })).toEqual([1]);
  });

  it("selects the configured warehouse target provider", () => {
    const localTarget = analyticsWarehouseTargetFromEnv({
      ANALYTICS_WAREHOUSE_TARGET: "local_json",
      ANALYTICS_WAREHOUSE_LOCAL_DIR: tempDir,
    });
    const bigQueryTarget = analyticsWarehouseTargetFromEnv({
      ANALYTICS_WAREHOUSE_TARGET: "bigquery_insert_all",
      ANALYTICS_WAREHOUSE_PROJECT_ID: "analytics-project",
    });

    expect(localTarget.describe()).toEqual({ provider: "local_json", location: tempDir });
    expect(bigQueryTarget.describe()).toEqual({ provider: "bigquery_insert_all", location: "analytics-project" });
  });
});

async function readJsonl(path: string) {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
