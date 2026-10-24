import { NATIVE_STAKE_TOKEN, sumStakesByAsset } from "./stake-totals";

const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

function stake(overrides: Partial<Parameters<typeof sumStakesByAsset>[0][number]> = {}) {
  return {
    amount: "5000000",
    paymentToken: USDC,
    paymentAssetSymbol: "USDC",
    paymentAssetDecimals: 6,
    canonicalAmountUsd: "5",
    ...overrides,
  };
}

describe("sumStakesByAsset", () => {
  it("returns no groups for no stakes", () => {
    expect(sumStakesByAsset([])).toEqual([]);
  });

  it("never sums base units across different assets", () => {
    const totals = sumStakesByAsset([
      stake(),
      stake({ amount: "10000000", canonicalAmountUsd: "10" }),
      stake({
        amount: "2000000000000000",
        paymentToken: NATIVE_STAKE_TOKEN,
        paymentAssetSymbol: "ETH",
        paymentAssetDecimals: 18,
        canonicalAmountUsd: "5",
      }),
    ]);

    expect(totals).toHaveLength(2);
    expect(totals.find((t) => t.assetSymbol === "USDC")).toEqual({
      assetToken: USDC,
      assetSymbol: "USDC",
      assetDecimals: 6,
      amount: "15000000",
      amountUsd: "15",
      count: 2,
    });
    expect(totals.find((t) => t.assetSymbol === "ETH")).toEqual({
      assetToken: NATIVE_STAKE_TOKEN,
      assetSymbol: "ETH",
      assetDecimals: 18,
      amount: "2000000000000000",
      amountUsd: "5",
      count: 1,
    });
  });

  it("groups token addresses case-insensitively", () => {
    const totals = sumStakesByAsset([stake(), stake({ paymentToken: USDC.toUpperCase().replace("0X", "0x") })]);
    expect(totals).toHaveLength(1);
    expect(totals[0].amount).toBe("10000000");
  });

  it("reports a null USD total when any stake in the group has no USD value", () => {
    const totals = sumStakesByAsset([stake(), stake({ canonicalAmountUsd: null })]);
    expect(totals[0].amountUsd).toBeNull();
  });
});
