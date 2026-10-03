import { unmetDemandCards } from "../modules/analytics/analytics_unmet_demand";
import type { UnmetDemandRow } from "../modules/scene_scout/unmet_demand.contracts";

const row: UnmetDemandRow = {
  targetType: "track", releaseId: "release-1", trackId: "track-1", trackTitle: "First Light",
  kind: "stem", value: "vocals", windowDays: 28, distinctRequesters: 3,
  requestCount: 5, computedAt: new Date(),
};

describe("aggregate unmet-demand action cards", () => {
  const previousFloor = process.env.DISCOVERY_MIN_AUDIENCE;
  beforeEach(() => { process.env.DISCOVERY_MIN_AUDIENCE = "3"; });
  afterAll(() => {
    if (previousFloor === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousFloor;
  });
  it("requires both audience and cockpit floors", () => {
    expect(unmetDemandCards({ status: "ready", demand: [
      { ...row, distinctRequesters: 2 }, { ...row, requestCount: 4 },
    ] })).toEqual([]);
    process.env.DISCOVERY_MIN_AUDIENCE = "6";
    expect(unmetDemandCards({ status: "ready", demand: [row] })).toEqual([]);
  });
  it("links the canonical release and track without exposing requesters", () => {
    const cards = unmetDemandCards({ status: "ready", demand: [row, { ...row, windowDays: 7 }] });
    expect(cards).toHaveLength(1);
    expect(cards[0].cta).toEqual({ label: "Publish this stem", href: "/release/release-1?demandTrack=track-1&demandStem=vocals#scene-scout-supply" });
    expect(cards[0].reason).toContain("5 requests from 3 people");
    expect(JSON.stringify(cards)).not.toMatch(/userId|requestId|sessionId|actorId/);
  });
  it("uses existing license and artist catalog entry points", () => {
    const cards = unmetDemandCards({ status: "ready", demand: [
      { ...row, kind: "license", value: "remix" },
      { ...row, targetType: "genre", trackId: undefined, releaseId: undefined, trackTitle: undefined, kind: "bpm", value: "120–124 BPM" },
    ] });
    expect(cards[0].cta.href).toContain("demandLicense=remix");
    expect(cards[1].cta.href).toBe("/artist/catalog");
  });
  it("never fabricates a card when data is thin or unavailable", () => {
    expect(unmetDemandCards({ status: "thin_data", demand: [row] })).toEqual([]);
    expect(unmetDemandCards({ status: "unavailable", demand: [] })).toEqual([]);
  });
});
