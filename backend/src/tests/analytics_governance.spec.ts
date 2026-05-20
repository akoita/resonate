import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";

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
