import {
  decoratePaymentAmount,
  normalizePaymentToken,
  resolvePaymentAssetForToken,
} from "../modules/payments/payment-asset-metadata";

describe("payment asset metadata", () => {
  const assets = [
    {
      assetId: "base-sepolia:usdc",
      chainId: 84532,
      symbol: "USDC",
      name: "USD Coin",
      kind: "stablecoin",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      decimals: 6,
      enabled: true,
      pricingStrategy: "usd_pegged",
    },
  ];

  it("normalizes native payment tokens", () => {
    expect(normalizePaymentToken(null)).toBe("0x0000000000000000000000000000000000000000");
    expect(normalizePaymentToken("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("resolves configured token metadata and canonical USD amount", () => {
    const metadata = decoratePaymentAmount({
      chainId: 84532,
      paymentToken: "0x1111111111111111111111111111111111111111",
      amountUnits: "12345678",
      assets,
    });

    expect(metadata).toEqual({
      paymentToken: "0x1111111111111111111111111111111111111111",
      paymentAssetId: "base-sepolia:usdc",
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      settlementAmount: "12.345678",
      settlementAmountUnits: "12345678",
      canonicalAmountUsd: "12.345678",
    });
  });

  it("falls back to native ETH metadata for native payments", () => {
    const asset = resolvePaymentAssetForToken({
      chainId: 31337,
      tokenAddress: "0x0000000000000000000000000000000000000000",
      assets: [],
    });

    expect(asset.assetId).toBe("local:eth");
    expect(asset.symbol).toBe("ETH");
    expect(asset.decimals).toBe(18);
  });
});
