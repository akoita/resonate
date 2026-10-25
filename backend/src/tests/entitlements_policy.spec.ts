/**
 * The one entitlement policy (#2406) — pure unit tests: the decision table for
 * every feature under `entitlements/v1` (`everyone`) and under the later `plan`
 * rule, and how grants resolve to a plan (none, active, expired, revoked,
 * scheduled). The Postgres side is entitlements.integration.spec.ts.
 */

import {
  decideEntitlement,
  ENTITLEMENT_FEATURES,
  ENTITLEMENTS_POLICY,
  FREE_PLAN,
  type EntitlementFeature,
  type EntitlementPolicy,
  type PlanResolution,
} from "../modules/entitlements/entitlements.policy";
import { grantStatus, planFromGrants } from "../modules/entitlements/entitlement_grants.service";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import type { EntitlementGrantsService } from "../modules/entitlements/entitlement_grants.service";
import type { SubscriptionPlanService } from "../modules/entitlements/subscription_plan";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY);

const GRANTED: PlanResolution = { plan: "pro", source: "operator_grant", validUntil: at(30).toISOString() };
const PROMO_OPEN: PlanResolution = { plan: "pro", source: "promo" };
const SUBSCRIBED: PlanResolution = { plan: "pro", source: "stripe_subscription", validUntil: at(10).toISOString() };
const PLAN_RULE: EntitlementPolicy = { version: "entitlements/test-plan", rule: "plan" };

describe("entitlement policy (#2406)", () => {
  it("names the features and the free-for-everyone policy, with no price", () => {
    expect(ENTITLEMENT_FEATURES).toEqual(["remix.pro", "crate.pro", "cockpit.demand"]);
    expect(ENTITLEMENTS_POLICY).toEqual({ version: "entitlements/v1", rule: "everyone" });
    expect(JSON.stringify(ENTITLEMENTS_POLICY)).not.toMatch(/price|cents|usd/i);
  });

  describe("under entitlements/v1 (everyone): identical to the old seams", () => {
    it.each(ENTITLEMENT_FEATURES.map((feature) => [feature]))("allows %s on the free plan", (feature) => {
      expect(decideEntitlement(feature as EntitlementFeature, FREE_PLAN)).toEqual({
        allowed: true,
        reason: "free_for_everyone",
        plan: "free",
        policyVersion: "entitlements/v1",
      });
    });

    it.each(ENTITLEMENT_FEATURES.map((feature) => [feature]))(
      "allows %s with a grant, and records the plan truthfully",
      (feature) => {
        expect(decideEntitlement(feature as EntitlementFeature, GRANTED)).toEqual({
          allowed: true,
          reason: "free_for_everyone",
          plan: "pro",
          source: "operator_grant",
          validUntil: GRANTED.validUntil,
          policyVersion: "entitlements/v1",
        });
      },
    );

    it("omits validUntil for an open-ended grant", () => {
      expect(decideEntitlement("remix.pro", PROMO_OPEN)).toEqual({
        allowed: true,
        reason: "free_for_everyone",
        plan: "pro",
        source: "promo",
        policyVersion: "entitlements/v1",
      });
    });

    it("never carries a source or end date on the free plan", () => {
      const decision = decideEntitlement("crate.pro", { plan: "free", source: "promo", validUntil: at(1).toISOString() });
      expect(decision).toEqual({ allowed: true, reason: "free_for_everyone", plan: "free", policyVersion: "entitlements/v1" });
    });
  });

  describe("under a plan rule (the later gates-on slice, not in force)", () => {
    it.each(ENTITLEMENT_FEATURES.map((feature) => [feature]))("denies %s on free with pro_required", (feature) => {
      expect(decideEntitlement(feature as EntitlementFeature, FREE_PLAN, PLAN_RULE)).toEqual({
        allowed: false,
        reason: "pro_required",
        plan: "free",
        policyVersion: "entitlements/test-plan",
      });
    });

    it("allows a grant with reason grant and a subscription with reason plan", () => {
      expect(decideEntitlement("remix.pro", GRANTED, PLAN_RULE)).toMatchObject({ allowed: true, reason: "grant", plan: "pro" });
      expect(decideEntitlement("remix.pro", PROMO_OPEN, PLAN_RULE)).toMatchObject({ allowed: true, reason: "grant" });
      expect(decideEntitlement("crate.pro", SUBSCRIBED, PLAN_RULE)).toMatchObject({
        allowed: true,
        reason: "plan",
        source: "stripe_subscription",
        validUntil: SUBSCRIBED.validUntil,
      });
    });
  });

  it("refuses an unknown feature instead of failing open", () => {
    expect(() => decideEntitlement("credits.everything" as EntitlementFeature, GRANTED, PLAN_RULE)).toThrow(
      /Unknown entitlement feature/,
    );
  });
});

describe("grants resolve to a plan (#2406)", () => {
  const grant = (over: Partial<{ validFrom: Date; validUntil: Date | null; revokedAt: Date | null; source: "operator_grant" | "promo" }>) => ({
    source: "operator_grant" as const,
    validFrom: at(-1),
    validUntil: at(30),
    revokedAt: null,
    ...over,
  });

  it("no grant is free", () => {
    expect(planFromGrants([], NOW)).toEqual({ plan: "free" });
  });

  it("an active grant is pro until its end", () => {
    expect(planFromGrants([grant({})], NOW)).toEqual({
      plan: "pro",
      source: "operator_grant",
      validUntil: at(30).toISOString(),
    });
    expect(grantStatus(grant({}), NOW)).toBe("active");
  });

  it("an expired grant is free (the end is exclusive)", () => {
    expect(planFromGrants([grant({ validUntil: at(-0.5) })], NOW)).toEqual({ plan: "free" });
    expect(planFromGrants([grant({ validUntil: NOW })], NOW)).toEqual({ plan: "free" });
    expect(grantStatus(grant({ validUntil: NOW }), NOW)).toBe("expired");
  });

  it("a revoked grant is free, even before its end", () => {
    expect(planFromGrants([grant({ revokedAt: at(-0.1) })], NOW)).toEqual({ plan: "free" });
    expect(grantStatus(grant({ revokedAt: at(-0.1), validUntil: at(-2) }), NOW)).toBe("revoked");
  });

  it("a grant that starts later is not pro yet", () => {
    expect(planFromGrants([grant({ validFrom: at(2) })], NOW)).toEqual({ plan: "free" });
    expect(grantStatus(grant({ validFrom: at(2) }), NOW)).toBe("scheduled");
  });

  it("with several active grants, open-ended wins, then the latest end", () => {
    expect(planFromGrants([grant({ validUntil: at(5) }), grant({ validUntil: at(40), source: "promo" })], NOW)).toEqual({
      plan: "pro",
      source: "promo",
      validUntil: at(40).toISOString(),
    });
    expect(planFromGrants([grant({ validUntil: at(40) }), grant({ validUntil: null, source: "promo" })], NOW)).toEqual({
      plan: "pro",
      source: "promo",
    });
  });
});

describe("EntitlementsService (#2406)", () => {
  it("decides from the plan the grants resolve, for that person only", async () => {
    const resolvePlan = jest.fn(async (userId: string) => (userId === "granted" ? GRANTED : FREE_PLAN));
    const noSubscription = { resolvePlan: async () => FREE_PLAN } as unknown as SubscriptionPlanService;
    const service = new EntitlementsService({ resolvePlan } as unknown as EntitlementGrantsService, noSubscription);
    await expect(service.decide("granted", "cockpit.demand", NOW)).resolves.toMatchObject({
      allowed: true,
      reason: "free_for_everyone",
      plan: "pro",
    });
    await expect(service.decide("other", "cockpit.demand", NOW)).resolves.toMatchObject({ allowed: true, plan: "free" });
    expect(resolvePlan).toHaveBeenCalledWith("granted", NOW);
    expect(resolvePlan).toHaveBeenCalledWith("other", NOW);
  });

  it("reads the subscription first, and the grants only when it gives no Pro (#2407)", async () => {
    const subscribed = { plan: "pro" as const, source: "stripe_subscription" as const, validUntil: "2026-11-25T00:00:00.000Z" };
    const subscriptionPlan = jest.fn(async (userId: string) => (userId === "subscriber" ? subscribed : FREE_PLAN));
    const grantPlan = jest.fn(async () => GRANTED);
    const service = new EntitlementsService(
      { resolvePlan: grantPlan } as unknown as EntitlementGrantsService,
      { resolvePlan: subscriptionPlan } as unknown as SubscriptionPlanService,
    );
    await expect(service.resolvePlan("subscriber", NOW)).resolves.toEqual(subscribed);
    expect(grantPlan).not.toHaveBeenCalled();
    await expect(service.resolvePlan("granted", NOW)).resolves.toEqual(GRANTED);
    expect(grantPlan).toHaveBeenCalledWith("granted", NOW);
  });
});
