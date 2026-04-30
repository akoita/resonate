import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPaymentAssetForToken,
  fundLocalDevWallet,
  formatPaymentAmount,
  formatPaymentAmountWithSymbol,
  getFundingOptions,
  getPaymentAssets,
  groupFundingOptions,
  isNativePaymentToken,
  paymentAssetSupportsSurface,
  paymentAssetSymbol,
  ZERO_PAYMENT_TOKEN,
  type FundingOption,
  type PaymentAsset,
} from "./payments";

const API_BASE = "http://localhost:3000";

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
    expect(formatPaymentAmountWithSymbol(10000000n, 6, "USDC")).toBe("10 USDC");
  });

  it("matches upload stake assets through the stake settlement alias", () => {
    expect(paymentAssetSupportsSurface(assets[1], "upload_stake")).toBe(false);
    expect(paymentAssetSupportsSurface({
      ...assets[1],
      settlement: ["stake"],
    }, "upload_stake")).toBe(true);
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

describe("payment API routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads payment assets from the backend payments controller route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chainId: 84532,
        assets: [],
        defaultAsset: null,
        source: "env",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getPaymentAssets(84532);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${API_BASE}/payments/assets?chainId=84532`);
  });

  it("loads funding options from the backend payments controller route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chainId: 84532,
        wallet: "0x7fa9b6d13bc29d60d3445922a5697d2f1b6c20e6",
        options: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getFundingOptions({
      chainId: 84532,
      wallet: "0x7fa9b6d13bc29d60d3445922a5697d2f1b6c20e6",
      surface: "upload_stake",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      `${API_BASE}/payments/funding-options`,
    );
    expect(parsed.searchParams.get("chainId")).toBe("84532");
    expect(parsed.searchParams.get("wallet")).toBe(
      "0x7fa9b6d13bc29d60d3445922a5697d2f1b6c20e6",
    );
    expect(parsed.searchParams.get("surface")).toBe("upload_stake");
  });

  it("posts local dev funding to the configured payments endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "funded",
        assetId: "local:eth",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fundLocalDevWallet({
      wallet: "0x7fa9b6d13bc29d60d3445922a5697d2f1b6c20e6",
      assetId: "local:eth",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/payments/dev/fund`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        wallet: "0x7fa9b6d13bc29d60d3445922a5697d2f1b6c20e6",
        assetId: "local:eth",
      }),
    );
  });
});
