import { Test } from "@nestjs/testing";
import { SceneScoutModule } from "../modules/scene_scout/scene_scout.module";
import { SCENE_SCOUT_SOURCE, SceneScoutService } from "../modules/scene_scout/scene_scout.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { sceneScoutCityCards } from "../modules/analytics/analytics_scene_scout";
import type { SceneScoutResult } from "../modules/scene_scout/scene_scout.service";

const result: SceneScoutResult = {
  status: "ready",
  cityDemand: [{
    releaseId: "release-1", releaseTitle: "First Light", citySlug: "paris", countryCode: "FR", windowDays: 28,
    resonantListeners: 5, saves: 5, follows: 0, purchases: 0, pledges: 0, uniqueListeners: 5, signalCount: 10,
    computedAt: new Date("2026-10-03T09:00:00Z"),
  }],
};

describe("Scene Scout cockpit contract", () => {
  it("returns an aggregate-only editable show action with stable attribution", () => {
    const [card] = sceneScoutCityCards(result);
    expect(card).toMatchObject({ type: "propose_show_city", sourceSignal: { category: "playback", count: 10 }, privacy: { aggregateOnly: true, thresholdApplied: true } });
    const query = new URL(card.cta.href!, "http://localhost").searchParams;
    expect(query.get("city")).toBe("paris");
    expect(query.get("country")).toBe("FR");
    expect(query.get("releaseId")).toBe("release-1");
    expect(JSON.stringify(card)).not.toMatch(/actorId|userId|wallet|payout/);
  });
  it("suppresses thin, denied and insufficient signal results", () => {
    expect(sceneScoutCityCards(undefined)).toEqual([]);
    expect(sceneScoutCityCards({ ...result, status: "thin_data" })).toEqual([]);
    expect(sceneScoutCityCards({ ...result, status: "unavailable" })).toEqual([]);
    expect(sceneScoutCityCards({ ...result, cityDemand: [{ ...result.cityDemand[0], signalCount: 4 }] })).toEqual([]);
  });
  it("gives one action per release/city when both windows qualify", () => {
    const cards = sceneScoutCityCards({ ...result, cityDemand: [
      { ...result.cityDemand[0], windowDays: 7 }, result.cityDemand[0],
    ] });
    expect(cards).toHaveLength(1);
    expect(cards[0].reason).toContain("28 days");
  });
  it("rechecks the audience floor at the card boundary", () => {
    expect(sceneScoutCityCards({ ...result, cityDemand: [{ ...result.cityDemand[0], uniqueListeners: 2 }] })).toEqual([]);
  });
  it("keeps the dashboard available when its optional Scene Scout source fails", async () => {
    const analytics = new AnalyticsService(new AnalyticsIngestService(), undefined, undefined, undefined, undefined, {
      getArtistSceneScout: async () => { throw new Error("snapshot read unavailable"); },
    });
    const dashboard = await analytics.getArtistDashboard("artist-1", 28);
    expect(dashboard.sceneScout?.status).toBe("unavailable");
    expect(dashboard.actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "propose_show_city" })]));
  });

  it("registers the real source behind the production injection seam", async () => {
    const module = await Test.createTestingModule({ imports: [SceneScoutModule] }).compile();
    expect(module.get(SCENE_SCOUT_SOURCE)).toBe(module.get(SceneScoutService));
    await module.close();
  });

});
