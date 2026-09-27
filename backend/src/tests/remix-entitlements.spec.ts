/**
 * Remix Studio entitlement seam (#1903 S6a) — pure unit tests. Pro mode is
 * free for everyone and has no price; the enforcement (403 `pro_required`
 * under a denying policy) is covered against Postgres in
 * remix-fx.integration.spec.ts.
 */

import {
  REMIX_PRO_FEATURE,
  REMIX_PRO_POLICY,
  RemixEntitlementsService,
} from "../modules/remix/remix-entitlements";

describe("RemixEntitlementsService (#1903)", () => {
  const service = new RemixEntitlementsService();

  it("names the feature and the free-for-everyone policy", () => {
    expect(REMIX_PRO_FEATURE).toBe("remix.pro");
    expect(REMIX_PRO_POLICY).toEqual({
      version: "remix-pro-policy/v1",
      rule: "everyone",
    });
    // No price anywhere in the policy.
    expect(JSON.stringify(REMIX_PRO_POLICY)).not.toMatch(/price|cents|usd/i);
  });

  it("allows Pro for every user", async () => {
    for (const userId of ["user-a", "user-b", ""]) {
      await expect(service.pro(userId)).resolves.toEqual({
        allowed: true,
        reason: "free_for_everyone",
        policyVersion: "remix-pro-policy/v1",
      });
    }
  });

  it("exposes the project DTO shape", async () => {
    await expect(service.forProject("user-a")).resolves.toEqual({
      pro: {
        allowed: true,
        reason: "free_for_everyone",
        policyVersion: "remix-pro-policy/v1",
      },
    });
  });
});
