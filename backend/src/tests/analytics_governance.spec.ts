import {
  AnalyticsGovernanceService,
  partitionEventsForErasure,
} from "../modules/analytics/analytics_governance.service";

describe("AnalyticsGovernanceService", () => {
  it("derives retention policy from env with safe defaults", () => {
    const service = new AnalyticsGovernanceService();

    expect(service.getRetentionPolicy({})).toEqual({
      personalDays: 395,
      sensitiveDays: 90,
      pseudonymousDays: 730,
    });
    expect(service.getRetentionPolicy({
      ANALYTICS_RETENTION_PERSONAL_DAYS: "30",
      ANALYTICS_RETENTION_SENSITIVE_DAYS: "7",
      ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS: "60",
    })).toEqual({
      personalDays: 30,
      sensitiveDays: 7,
      pseudonymousDays: 60,
    });
  });
});

describe("partitionEventsForErasure", () => {
  it("redacts audit-preserved families and deletes everything else", () => {
    expect(
      partitionEventsForErasure([
        { eventId: "e1", eventName: "playback.completed" },
        { eventId: "e2", eventName: "commerce.settled" },
        { eventId: "e3", eventName: "payment.settled" },
        { eventId: "e4", eventName: "rights.route_decided" },
        { eventId: "e5", eventName: "license.granted" },
        { eventId: "e6", eventName: "generation.created" },
        { eventId: "e7", eventName: "identity.signed_in" },
      ]),
    ).toEqual({
      deleteEventIds: ["e1", "e6", "e7"],
      redactEventIds: ["e2", "e3", "e4", "e5"],
    });
  });

  it("returns empty sets for an erasure that matched nothing", () => {
    expect(partitionEventsForErasure([])).toEqual({ deleteEventIds: [], redactEventIds: [] });
  });
});
