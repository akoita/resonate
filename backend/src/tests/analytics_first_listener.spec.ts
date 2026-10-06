import { entitledFirstListenerReceptionSource, firstListenerReceptionCards } from "../modules/analytics/analytics_first_listener";
import type { FirstListenerArtistReception } from "../modules/recommendations/first_listener.contracts";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

const reception: FirstListenerArtistReception = {
  available: true, minimumAudience: 3,
  releases: [{ releaseId: "r-1", title: "First Light", createdAt: new Date("2026-09-01"), heard: 5, fullPlays: 3, saves: null, follows: null }],
};

describe("first-listener reception cockpit", () => {
  it("shows actual reception and keeps suppressed subcounts honest", () => {
    const [card] = firstListenerReceptionCards(reception);
    expect(card.cta.href).toBe("/release/r-1");
    expect(card.reason).toContain("5 listeners heard it; 3 played through; saves: not enough data");
    expect(card.reason).toContain("follows: not enough data");
    expect(card.reason).not.toMatch(/0 saved|0 followed/);
    expect(JSON.stringify(card)).not.toMatch(/userId|actorId|wallet/);
  });
  it("reports follows once they clear the audience floor", () => {
    const [card] = firstListenerReceptionCards({
      ...reception,
      releases: [{ ...reception.releases[0], saves: 3, follows: 4 }],
    });
    expect(card.reason).toContain("3 saved; 4 followed");
  });
  it("enforces both audience and cockpit thresholds", () => {
    expect(firstListenerReceptionCards({ ...reception, minimumAudience: 6 })).toEqual([]);
    expect(firstListenerReceptionCards({ ...reception, releases: [{ ...reception.releases[0], heard: 4 }] })).toEqual([]);
    expect(firstListenerReceptionCards({ ...reception, available: false })).toEqual([]);
  });
  it("checks the entitlement before fetching reception", async () => {
    const getArtistReception = jest.fn(async () => reception);
    const source = entitledFirstListenerReceptionSource({ getArtistReception }, { canRead: async () => false });
    expect((await source.getArtistReception("artist")).available).toBe(false);
    expect(getArtistReception).not.toHaveBeenCalled();
  });
  it("keeps other dashboard analytics available when reception fails", async () => {
    const service = new AnalyticsService(new AnalyticsIngestService(), undefined, undefined, undefined, undefined, undefined, undefined, {
      getArtistReception: async () => { throw new Error("database unavailable"); },
    });
    const dashboard = await service.getArtistDashboard("artist-1", 28);
    expect(dashboard.firstListenerReception?.status).toBe("unavailable");
    expect(dashboard.actions.some((card) => card.type === "review_first_listener_reception")).toBe(false);
  });
});
