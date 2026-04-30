import { describe, expect, it } from "vitest";
import {
  findPaymentAssetForToken,
  formatPaymentAmount,
  groupFundingOptions,
  isNativePaymentToken,
  paymentAssetSymbol,
  ZERO_PAYMENT_TOKEN,
  type FundingOption,
  type PaymentAsset,
} from "./payments";

const assets: PaymentAsset[] = [
  {
    assetId: "local:eth",
    chainId: 31337,
    symbol: "ETH",
    name: "Ether",
    kind: "native",
    tokenAddress: ZERO_PAYMENT_TOKEN,
    decimals: 18,
    enabled: true,
    settlement: ["marketplace"],
    pricingStrategy: "fixed_test_price",
  },
  {
    assetId: "local:usdc",
    chainId: 31337,
    symbol: "USDC",
    name: "USD Coin",
    kind: "stablecoin",
    tokenAddress: "0x00000000000000000000000000000000000000a0",
    decimals: 6,
    enabled: true,
    settlement: ["marketplace", "x402"],
    pricingStrategy: "usd_pegged",
  },
];

describe("payment asset helpers", () => {
  it("recognizes native ETH listings by zero payment token", () => {
    expect(isNativePaymentToken(ZERO_PAYMENT_TOKEN)).toBe(true);
    expect(paymentAssetSymbol(null, ZERO_PAYMENT_TOKEN)).toBe("ETH");
  });

  it("finds ERC-20 listing assets by token address and chain", () => {
    const asset = findPaymentAssetForToken(assets, 31337, "0x00000000000000000000000000000000000000A0");
    expect(asset?.assetId).toBe("local:usdc");
    expect(paymentAssetSymbol(asset, asset?.tokenAddress)).toBe("USDC");
  });

  it("formats token amounts with asset decimals", () => {
    expect(formatPaymentAmount(1234567n, 6)).toBe("1.234567");
    expect(formatPaymentAmount("1000000000000000000", 18)).toBe("1");
  });

  it("groups funding actions by user-facing flow type", () => {
    const fundingOptions: FundingOption[] = [
      { id: "cash-out", assetId: "base:usdc", kind: "offramp", label: "Cash out USDC" },
      { id: "test-usdc", assetId: "base-sepolia:usdc", kind: "testnet_faucet", label: "Get USDC" },
      { id: "local-eth", assetId: "local:eth", kind: "local_faucet", label: "Fund ETH" },
      { id: "transfer", assetId: "base-sepolia:eth", kind: "transfer", label: "Transfer ETH" },
    ];

    expect(groupFundingOptions(fundingOptions).map((group) => ({
      kind: group.kind,
      labels: group.options.map((option) => option.label),
    }))).toEqual([
      { kind: "local_faucet", labels: ["Fund ETH"] },
      { kind: "testnet_faucet", labels: ["Get USDC"] },
      { kind: "transfer", labels: ["Transfer ETH"] },
      { kind: "offramp", labels: ["Cash out USDC"] },
    ]);
  });
});
