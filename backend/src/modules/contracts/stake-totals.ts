export const NATIVE_STAKE_TOKEN = "0x0000000000000000000000000000000000000000";

export interface StakeAssetTotal {
  assetToken: string;
  assetSymbol: string;
  assetDecimals: number;
  /** Sum of base-unit amounts for this single asset. */
  amount: string;
  /** Sum of canonical USD values, or null when any stake in the group lacks one. */
  amountUsd: string | null;
  count: number;
}

/** Group stakes by payment asset; base units are only ever summed within one asset. */
export function sumStakesByAsset(
  stakes: Array<{
    amount: string;
    paymentToken: string;
    paymentAssetSymbol: string;
    paymentAssetDecimals: number;
    canonicalAmountUsd: string | null;
  }>,
): StakeAssetTotal[] {
  const groups = new Map<string, { total: StakeAssetTotal; units: bigint; usd: number; usdKnown: boolean }>();
  for (const stake of stakes) {
    const key = stake.paymentToken.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = {
        total: {
          assetToken: key,
          assetSymbol: stake.paymentAssetSymbol,
          assetDecimals: stake.paymentAssetDecimals,
          amount: "0",
          amountUsd: null,
          count: 0,
        },
        units: 0n,
        usd: 0,
        usdKnown: true,
      };
      groups.set(key, group);
    }
    group.units += BigInt(stake.amount);
    group.total.count += 1;
    const usd = stake.canonicalAmountUsd === null ? Number.NaN : Number(stake.canonicalAmountUsd);
    if (Number.isFinite(usd)) group.usd += usd;
    else group.usdKnown = false;
  }
  return Array.from(groups.values()).map(({ total, units, usd, usdKnown }) => ({
    ...total,
    amount: units.toString(),
    amountUsd: usdKnown ? String(Number(usd.toFixed(6))) : null,
  }));
}
