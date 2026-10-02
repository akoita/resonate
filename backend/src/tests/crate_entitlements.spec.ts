/**
 * Crate Digger entitlement seam (#1966) — pure unit tests. Crate Digger is free
 * for everyone and has no price; the free saved-crate limit only bites once a
 * policy can deny.
 */

import {
  CRATE_FREE_SAVED_CRATES,
  CRATE_PRO_FEATURE,
  CRATE_PRO_POLICY,
  CrateEntitlementDecision,
  CrateEntitlementsService,
  canCreateCrate,
} from "../modules/crates/crate-entitlements";

const GRANTED: CrateEntitlementDecision = {
  allowed: true,
  reason: "free_for_everyone",
  policyVersion: "crate-pro-policy/v1",
};

const DENIED: CrateEntitlementDecision = {
  allowed: false,
  reason: "subscription_required",
  policyVersion: "crate-pro-policy/v2",
};

describe("CrateEntitlementsService (#1966)", () => {
  const service = new CrateEntitlementsService();

  it("names the feature and the free-for-everyone policy", () => {
    expect(CRATE_PRO_FEATURE).toBe("crate.pro");
    expect(CRATE_PRO_POLICY).toEqual({
      version: "crate-pro-policy/v1",
      rule: "everyone",
    });
    expect(CRATE_FREE_SAVED_CRATES).toBe(3);
    // No price anywhere in the policy.
    expect(JSON.stringify(CRATE_PRO_POLICY)).not.toMatch(/price|cents|usd/i);
  });

  it("allows Pro for every user", async () => {
    for (const userId of ["user-a", "user-b", ""]) {
      await expect(service.pro(userId)).resolves.toEqual(GRANTED);
    }
  });

  it("allows exporting a crate for every user, through the same policy (#1965)", async () => {
    for (const userId of ["user-a", "user-b", ""]) {
      await expect(service.export(userId)).resolves.toEqual(GRANTED);
    }
  });

  it("allows watching a crate for every user, through the same policy (#1967)", async () => {
    for (const userId of ["user-a", "user-b", ""]) {
      await expect(service.watch(userId)).resolves.toEqual(GRANTED);
    }
  });

  it("exposes one decision per feature on the crate DTO", async () => {
    await expect(service.forCrate("user-a")).resolves.toEqual({
      pro: GRANTED,
      export: GRANTED,
      watch: GRANTED,
    });
  });

  it("returns denied for every feature when the policy denies (#1966)", async () => {
    // A future policy replaces `pro`; export and watch ride on it, so a denial
    // reaches every feature without any caller changing.
    class DenyingEntitlements extends CrateEntitlementsService {
      async pro(_userId: string): Promise<CrateEntitlementDecision> {
        return DENIED;
      }
    }
    const denying = new DenyingEntitlements();
    await expect(denying.pro("user-a")).resolves.toEqual(DENIED);
    await expect(denying.export("user-a")).resolves.toEqual(DENIED);
    await expect(denying.watch("user-a")).resolves.toEqual(DENIED);
    await expect(denying.forCrate("user-a")).resolves.toEqual({
      pro: DENIED,
      export: DENIED,
      watch: DENIED,
    });
    // At the free limit the same decision refuses one more saved crate.
    expect(
      canCreateCrate({ existingCrates: CRATE_FREE_SAVED_CRATES, pro: await denying.pro("user-a") }),
    ).toEqual({ allowed: false, reason: "pro_required" });
  });
});

describe("canCreateCrate (#1966)", () => {
  it("never limits a user the policy grants Pro", () => {
    for (const existingCrates of [0, CRATE_FREE_SAVED_CRATES, 1000]) {
      expect(canCreateCrate({ existingCrates, pro: GRANTED })).toEqual({ allowed: true });
    }
  });

  it("allows a denied user below the free number", () => {
    for (let existingCrates = 0; existingCrates < CRATE_FREE_SAVED_CRATES; existingCrates += 1) {
      expect(canCreateCrate({ existingCrates, pro: DENIED })).toEqual({ allowed: true });
    }
  });

  it("denies a denied user at and above the free number", () => {
    for (const existingCrates of [CRATE_FREE_SAVED_CRATES, CRATE_FREE_SAVED_CRATES + 1, 50]) {
      expect(canCreateCrate({ existingCrates, pro: DENIED })).toEqual({
        allowed: false,
        reason: "pro_required",
      });
    }
  });
});
