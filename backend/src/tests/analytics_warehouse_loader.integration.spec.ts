import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { prisma } from "../db/prisma";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import {
  AnalyticsWarehouseLoaderService,
  LocalJsonAnalyticsWarehouseTarget,
} from "../modules/analytics/analytics_warehouse_loader";

const TEST_PREFIX = `analytics_loader_${Date.now()}_`;

describe("Analytics warehouse loader integration", () => {
  const store = new PrismaAnalyticsEventStore();
  const ingest = new AnalyticsIngestService(store);
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resonate-analytics-warehouse-integration-"));
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: { eventId: { startsWith: TEST_PREFIX } },
    });
    await rm(tempDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("serializes batch loads across store instances and releases the lock after failure", async () => {
    const key = `${TEST_PREFIX}target`;
    const otherStore = new PrismaAnalyticsEventStore();
    await expect(store.withExclusiveWarehouseLoad(key, async () => {
      await expect(otherStore.withExclusiveWarehouseLoad(key, async () => "unexpected")).rejects.toThrow("already running");
      throw new Error("simulated load failure");
    })).rejects.toThrow("simulated load failure");
    await expect(otherStore.withExclusiveWarehouseLoad(key, async () => "recovered")).resolves.toBe("recovered");
  });

  it("backfills stored events by date and event family into a durable target", async () => {
    await ingest.ingest({
      eventId: `${TEST_PREFIX}play_in_scope`,
      geo: { countryCode: "FR", precision: "country", source: "user_declared" },
      eventName: "playback.completed",
      occurredAt: "2026-05-20T09:00:00.000Z",
      producer: "analytics-loader-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}track`,
      },
    });
    await ingest.ingest({
      eventId: `${TEST_PREFIX}play_out_of_scope`,
      eventName: "playback.completed",
      occurredAt: "2026-05-19T09:00:00.000Z",
      producer: "analytics-loader-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}old_track`,
      },
    });
    await ingest.ingest({
      eventId: `${TEST_PREFIX}payment_other_family`,
      eventName: "payment.settled",
      occurredAt: "2026-05-20T09:30:00.000Z",
      producer: "analytics-loader-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}track`,
        amountUsd: 7,
      },
    });

    const loader = new AnalyticsWarehouseLoaderService(store, new LocalJsonAnalyticsWarehouseTarget(tempDir));

    const result = await loader.backfill({
      runId: `${TEST_PREFIX}backfill`,
      from: "2026-05-20T00:00:00.000Z",
      to: "2026-05-21T00:00:00.000Z",
      eventFamily: "playback",
    });

    const bounded = await store.listEvents({ occurredFrom: new Date("2026-05-20T00:00:00Z"),
      occurredTo: new Date("2026-05-21T00:00:00Z"), limit: 1 });
    expect(bounded).toHaveLength(1);
    expect(result.eventsRead).toBe(1);
    expect(result.layers.eventsRaw).toBe(1);
    const cleanRows = await readJsonl(join(tempDir, "analytics_local_events_clean.jsonl"));
    expect(cleanRows[0].geoCountryCode).toBe("FR");
    expect(result.layers.analyticsFacts).toBe(1);
    expect(result.metrics.quarantinedRows).toBe(0);

    const rawRows = await readJsonl(join(tempDir, "analytics_local_events_raw.jsonl"));
    expect(rawRows).toEqual([
      expect.objectContaining({
        eventId: `${TEST_PREFIX}play_in_scope`,
        eventName: "playback.completed",
      }),
    ]);
  });
});

async function readJsonl(path: string) {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
