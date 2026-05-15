import { PolicyGuardService } from "../modules/agents/policy_guard.service";

const baseInput = {
  sessionId: "session-1",
  userId: "user-1",
  rail: "erc4337_marketplace" as const,
  licenseType: "personal" as const,
  priceUsd: 1,
  budgetRemainingUsd: 5,
};

describe("PolicyGuardService", () => {
  const service = new PolicyGuardService();

  it("allows purchases within policy and budget", () => {
    expect(service.evaluate(baseInput)).toEqual({
      allowed: true,
      reason: "policy_ok",
      remainingUsd: 4,
    });
  });

  it("rejects purchases over budget before execution", () => {
    expect(
      service.evaluate({
        ...baseInput,
        priceUsd: 6,
      }),
    ).toEqual({
      allowed: false,
      reason: "budget_exceeded",
      remainingUsd: 5,
    });
  });

  it("rejects disallowed rails", () => {
    expect(
      service.evaluate({
        ...baseInput,
        rail: "x402",
        allowedRails: ["erc4337_marketplace"],
      }),
    ).toEqual({
      allowed: false,
      reason: "rail_not_allowed",
      remainingUsd: 5,
    });
  });

  it("rejects disallowed license types", () => {
    expect(
      service.evaluate({
        ...baseInput,
        licenseType: "commercial",
        allowedLicenseTypes: ["personal", "remix"],
      }),
    ).toEqual({
      allowed: false,
      reason: "license_not_allowed",
      remainingUsd: 5,
    });
  });
});
