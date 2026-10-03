import {
  SHOW_PLEDGE_DEMAND_RETENTION_MS,
  normalizeShowPledgeDemandGeo,
  showPledgeDemandContextFields,
} from "../modules/scene_scout/show_pledge_demand";

describe("show pledge demand context helpers", () => {
  it("keeps only a canonical, explicitly declared city and country", () => {
    expect(normalizeShowPledgeDemandGeo({
      countryCode: " ca ",
      citySlug: " Montréal ",
      source: "user_declared",
      precision: "city",
    })).toEqual({ countryCode: "CA", citySlug: "montreal" });
  });

  it.each([
    ["campaign targets", { countryCode: "CA", citySlug: "montreal", source: "campaign_target", precision: "city" }],
    ["IP-derived locations", { countryCode: "CA", citySlug: "montreal", source: "ip_coarse", precision: "city" }],
    ["region-only declarations", { countryCode: "CA", regionCode: "QC", source: "user_declared", precision: "region" }],
    ["missing source", { countryCode: "CA", citySlug: "montreal", precision: "city" }],
    ["missing city", { countryCode: "CA", source: "user_declared", precision: "city" }],
    ["invalid country", { countryCode: "Canada", citySlug: "montreal", source: "user_declared", precision: "city" }],
  ])("rejects %s without changing its provenance", (_name, geo) => {
    expect(normalizeShowPledgeDemandGeo(geo)).toBeNull();
  });

  it("expires each context after exactly 28 days", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    expect(showPledgeDemandContextFields({
      userId: "listener",
      policyVersion: "analytics-consent:2026-10-03",
      geo: { countryCode: "CA", citySlug: "montreal" },
      now,
    })).toEqual({
      userId: "listener",
      countryCode: "CA",
      citySlug: "montreal",
      consentPolicyVersion: "analytics-consent:2026-10-03",
      declaredAt: now,
      expiresAt: new Date(now.getTime() + SHOW_PLEDGE_DEMAND_RETENTION_MS),
    });
  });
});
