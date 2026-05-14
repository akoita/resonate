export interface TrustTierInfo {
  tier: string;
  stakeAmountWei: string;
  stakeAmountUsd: string;
  escrowDays: number;
}

const DEFAULT_TRUST_TIERS: Record<string, TrustTierInfo> = {
  verified: { tier: "verified", stakeAmountWei: "0", stakeAmountUsd: "0", escrowDays: 3 },
  trusted: { tier: "trusted", stakeAmountWei: "1000000000000000", stakeAmountUsd: "1", escrowDays: 7 },
  established: { tier: "established", stakeAmountWei: "5000000000000000", stakeAmountUsd: "5", escrowDays: 14 },
  new: { tier: "new", stakeAmountWei: "5000000000000000", stakeAmountUsd: "5", escrowDays: 30 },
};

function getConfiguredStakeAmountWei(
  getEnv: (key: string) => string | undefined,
  envKey: string,
  fallback: string,
): string {
  const configured = getEnv(envKey)?.trim();
  return configured && configured.length > 0 ? configured : fallback;
}

function getConfiguredStakeAmountUsd(
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
      stakeAmountUsd: getConfiguredStakeAmountUsd(
        getEnv,
        "TRUST_STAKE_USD_TRUSTED",
        DEFAULT_TRUST_TIERS.trusted.stakeAmountUsd,
      ),
    },
    established: {
      ...DEFAULT_TRUST_TIERS.established,
      stakeAmountWei: getConfiguredStakeAmountWei(
        getEnv,
        "TRUST_STAKE_WEI_ESTABLISHED",
        DEFAULT_TRUST_TIERS.established.stakeAmountWei,
      ),
      stakeAmountUsd: getConfiguredStakeAmountUsd(
        getEnv,
        "TRUST_STAKE_USD_ESTABLISHED",
        DEFAULT_TRUST_TIERS.established.stakeAmountUsd,
      ),
    },
    new: {
      ...DEFAULT_TRUST_TIERS.new,
      stakeAmountWei: getConfiguredStakeAmountWei(
        getEnv,
        "TRUST_STAKE_WEI_NEW",
        DEFAULT_TRUST_TIERS.new.stakeAmountWei,
      ),
      stakeAmountUsd: getConfiguredStakeAmountUsd(
        getEnv,
        "TRUST_STAKE_USD_NEW",
        DEFAULT_TRUST_TIERS.new.stakeAmountUsd,
      ),
    },
  };
}

export function getDefaultTrustTier(tier: "verified" | "trusted" | "established" | "new") {
  return DEFAULT_TRUST_TIERS[tier];
}
