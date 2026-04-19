import {
  getDefaultTrustTier,
  resolveTrustTiers,
} from "../modules/trust/trustTierConfig";

describe("trust tier config", () => {
  it("uses the current defaults when no env overrides are present", () => {
    const tiers = resolveTrustTiers(() => undefined);

    expect(tiers.new).toEqual(getDefaultTrustTier("new"));
    expect(tiers.established).toEqual(getDefaultTrustTier("established"));
    expect(tiers.trusted).toEqual(getDefaultTrustTier("trusted"));
    expect(tiers.verified).toEqual(getDefaultTrustTier("verified"));
  });

  it("allows stake amounts to be overridden from config", () => {
    const tiers = resolveTrustTiers((key) => {
      const values: Record<string, string> = {
        TRUST_STAKE_WEI_NEW: "100000000000000",
        TRUST_STAKE_WEI_ESTABLISHED: "200000000000000",
        TRUST_STAKE_WEI_TRUSTED: "300000000000000",
      };
      return values[key];
    });

    expect(tiers.new.stakeAmountWei).toBe("100000000000000");
    expect(tiers.established.stakeAmountWei).toBe("200000000000000");
    expect(tiers.trusted.stakeAmountWei).toBe("300000000000000");
    expect(tiers.verified.stakeAmountWei).toBe("0");
  });

  it("ignores blank overrides", () => {
    const tiers = resolveTrustTiers((key) => {
      if (key === "TRUST_STAKE_WEI_NEW") return "   ";
      return undefined;
    });

    expect(tiers.new.stakeAmountWei).toBe(getDefaultTrustTier("new").stakeAmountWei);
  });
});
