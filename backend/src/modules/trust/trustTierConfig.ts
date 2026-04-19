export interface TrustTierInfo {
  tier: string;
  stakeAmountWei: string;
  escrowDays: number;
}

const DEFAULT_TRUST_TIERS: Record<string, TrustTierInfo> = {
  verified: { tier: "verified", stakeAmountWei: "0", escrowDays: 3 },
  trusted: { tier: "trusted", stakeAmountWei: "1000000000000000", escrowDays: 7 },
  established: { tier: "established", stakeAmountWei: "5000000000000000", escrowDays: 14 },
  new: { tier: "new", stakeAmountWei: "10000000000000000", escrowDays: 30 },
};

function getConfiguredStakeAmountWei(
  getEnv: (key: string) => string | undefined,
  envKey: string,
  fallback: string,
): string {
  const configured = getEnv(envKey)?.trim();
  return configured && configured.length > 0 ? configured : fallback;
}

export function resolveTrustTiers(
  getEnv: (key: string) => string | undefined,
): Record<string, TrustTierInfo> {
  return {
    verified: DEFAULT_TRUST_TIERS.verified,
    trusted: {
      ...DEFAULT_TRUST_TIERS.trusted,
      stakeAmountWei: getConfiguredStakeAmountWei(
        getEnv,
        "TRUST_STAKE_WEI_TRUSTED",
        DEFAULT_TRUST_TIERS.trusted.stakeAmountWei,
      ),
    },
    established: {
      ...DEFAULT_TRUST_TIERS.established,
      stakeAmountWei: getConfiguredStakeAmountWei(
        getEnv,
        "TRUST_STAKE_WEI_ESTABLISHED",
        DEFAULT_TRUST_TIERS.established.stakeAmountWei,
      ),
    },
    new: {
      ...DEFAULT_TRUST_TIERS.new,
      stakeAmountWei: getConfiguredStakeAmountWei(
        getEnv,
        "TRUST_STAKE_WEI_NEW",
        DEFAULT_TRUST_TIERS.new.stakeAmountWei,
      ),
    },
  };
}

export function getDefaultTrustTier(tier: "verified" | "trusted" | "established" | "new") {
  return DEFAULT_TRUST_TIERS[tier];
}
