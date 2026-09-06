import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

const generatedAt = "2026-09-06T12:00:00.000Z";
const fixtures = JSON.parse(readFileSync(resolve(__dirname, "../../../test-fixtures/analytics_expected_events.json"), "utf8"));
const base = { eventVersion: 1, occurredAt: generatedAt, receivedAt: generatedAt,
  producer: "parity-test", environment: "staging", privacyTier: "pseudonymous" };

function compare(events: unknown[]) {
  const backend = JSON.parse(JSON.stringify(buildAnalyticsWarehouseExport(events, { generatedAt: new Date(generatedAt) })));
  const run = spawnSync("python3", ["-B", resolve(__dirname, "../../../workers/analytics-dataflow/parity_export.py")], {
    input: JSON.stringify({ events, generatedAt }), encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(run.stderr || String(run.error));
  const streaming = JSON.parse(run.stdout);
  const layers = { eventsRaw: "events_raw", eventsClean: "events_clean", analyticsFacts: "analytics_facts",
    analyticsViews: "analytics_views", analyticsQuarantine: "analytics_quarantine" };
  for (const [name, pythonName] of Object.entries(layers)) {
    const rows = streaming[pythonName].map((row: Record<string, unknown>) => {
      const decoded = { ...row };
      for (const field of ["payload", "sourceRefs", "envelope", "dimensions", "raw"]) {
        if (typeof decoded[field] === "string") decoded[field] = JSON.parse(decoded[field] as string);
        if (decoded[field] === null) delete decoded[field];
      }
      return decoded;
    });
    // Streaming emits additive per-event views; backend emits grouped daily rows.
    if (name === "analyticsViews") {
      const groups = new Map<string, any>();
      for (const row of rows) {
        const key = JSON.stringify([row.date, row.eventName, row.artistId, row.trackId]);
        const prev = groups.get(key);
        if (prev) for (const field of ["eventCount", "playCount", "payoutUsd"]) prev[field] += row[field];
        else groups.set(key, { ...row });
      }
      expect([...groups.values()]).toEqual(backend[name]);
    } else expect(rows).toEqual(backend[name]);
  }
}

describe("batch/streaming warehouse parity", () => {
  it("preserves every shared event fixture and deduplicates redelivery", () => {
    const events = fixtures.map((fixture: any, index: number) => ({ ...base, ...fixture, eventId: `fixture-${index}` }));
    compare([...events, events[0], events[1]]);
  });
  it("preserves credited identity, privacy, geo and owner-remix dimensions", () => {
    compare([{ ...base, eventId: "identity", eventName: "remix.created", actorId: "actor", consentBasis: "opt_in",
      privacyTier: "personal", geo: { countryCode: "FR", precision: "country", source: "user_declared" },
      payload: { artistId: "manager", managerArtistId: "manager", creditedArtistId: "credited",
        creditedArtistName: "Artist", creditedArtistIds: ["credited"], creditedArtistNames: ["Artist"],
        creatorOwner: true, remixId: "remix", sourceTrackId: "track", stemIds: ["stem"] } }]);
  });
  it("quarantines unsupported families and versions without creating facts", () => {
    compare([{ ...base, eventId: "unknown", eventName: "unknown.created", payload: {} },
      { ...base, eventId: "future", eventName: "playback.completed", eventVersion: 999, payload: {} }]);
  });
});
