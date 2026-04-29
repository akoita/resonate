import { ConfigService } from "@nestjs/config";
import { PaymentsService } from "./payments.service";

const mockEventBus = {
  publish: jest.fn(),
};

function createService(config: Record<string, string | undefined>) {
  return new PaymentsService(
    mockEventBus as any,
    new ConfigService(config),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PaymentsService local payment metadata", () => {
  const assets = [
    {
      assetId: "local:eth",
      chainId: 31337,
      symbol: "ETH",
      name: "Local Ether",
      kind: "native",
      tokenAddress: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      enabled: true,
      settlement: ["marketplace", "stake", "dispute", "escrow"],
      pricingStrategy: "fixed_test_price",
    },
    {
      assetId: "local:usdc",
      chainId: 31337,
      symbol: "USDC",
      name: "Mock USD Coin",
      kind: "stablecoin",
      tokenAddress: "0x2222222222222222222222222222222222222222",
      decimals: 6,
      enabled: true,
      settlement: ["marketplace", "stake", "dispute", "escrow", "x402"],
      pricingStrategy: "usd_pegged",
    },
    {
      assetId: "local:weth",
      chainId: 31337,
      symbol: "WETH",
      name: "Wrapped Local Ether",
      kind: "wrapped_native",
      tokenAddress: "0x3333333333333333333333333333333333333333",
      decimals: 18,
      enabled: false,
      settlement: ["marketplace", "stake", "dispute", "escrow"],
      pricingStrategy: "fixed_test_price",
    },
    {
      assetId: "base-sepolia:usdc",
      chainId: 84532,
      symbol: "USDC",
      name: "USD Coin",
      kind: "stablecoin",
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      decimals: 6,
      enabled: true,
      settlement: ["x402"],
      pricingStrategy: "usd_pegged",
    },
  ];
  const enabledAssets = assets.filter((asset) => asset.enabled);

  it("returns enabled payment assets from PAYMENT_ASSETS_JSON", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_DEFAULT_ASSET: "local:eth",
    });

    expect(service.getPaymentAssets()).toEqual({
      chainId: 31337,
      assets: enabledAssets,
      defaultAsset: "local:eth",
      source: "env",
    });
  });

  it("filters funding options by requested chain", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_FUNDING_OPTIONS_JSON: JSON.stringify([
        { id: "eth", assetId: "local:eth", kind: "local_faucet", label: "ETH" },
        { id: "usdc", assetId: "base-sepolia:usdc", kind: "testnet_faucet", label: "USDC" },
      ]),
    });

    expect(service.getFundingOptions({ chainId: 84532 })).toEqual({
      chainId: 84532,
      wallet: null,
      options: [
        { id: "usdc", assetId: "base-sepolia:usdc", kind: "testnet_faucet", label: "USDC" },
      ],
    });
  });

  it("filters funding options by asset and payment surface", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_FUNDING_OPTIONS_JSON: JSON.stringify([
        {
          id: "eth",
          assetId: "local:eth",
          kind: "local_faucet",
          label: "ETH",
          surfaces: ["marketplace"],
        },
        {
          id: "usdc",
          assetId: "local:usdc",
          kind: "local_faucet",
          label: "USDC",
          surfaces: ["upload_stake"],
        },
      ]),
    });

    expect(service.getFundingOptions({
      chainId: 31337,
      assetId: "local:usdc",
      surface: "upload_stake",
    })).toEqual({
      chainId: 31337,
      wallet: null,
      options: [
        {
          id: "usdc",
          assetId: "local:usdc",
          kind: "local_faucet",
          label: "USDC",
          surfaces: ["upload_stake"],
        },
      ],
    });
  });

  it("quotes USD-pegged stablecoins with token decimals", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
    });

    const quote = service.quotePayment({
      amountUsd: "12.345678",
      chainId: 31337,
      assetId: "local:usdc",
    });

    expect(quote.quotes).toHaveLength(1);
    expect(quote.quotes[0]).toMatchObject({
      assetId: "local:usdc",
      amount: "12.345678",
      amountUnits: "12345678",
      priceUsd: "1",
    });
  });

  it("rounds ETH quotes up to the smallest token unit", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_ASSET_PRICES_JSON: JSON.stringify({
        "local:eth": { priceUsd: "3000" },
      }),
    });

    const quote = service.quotePayment({
      amountUsd: "0.01",
      chainId: 31337,
      assetId: "local:eth",
    });

    expect(quote.quotes[0]).toMatchObject({
      assetId: "local:eth",
      amount: "0.000003333333333334",
      amountUnits: "3333333333334",
      priceUsd: "3000",
    });
  });

  it("omits disabled assets from quotes and policies", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
    });

    const quote = service.quotePayment({
      amountUsd: "1",
      chainId: 31337,
      surface: "marketplace",
    });
    const policy = service.getPaymentPolicy({
      chainId: 31337,
      surface: "marketplace",
    });

    expect(quote.quotes.map((asset) => asset.assetId)).toEqual([
      "local:eth",
      "local:usdc",
    ]);
    expect(policy.policies[0].acceptedAssetIds).toEqual([
      "local:eth",
      "local:usdc",
    ]);
  });

  it("rejects stale oracle price entries", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_ASSET_PRICES_JSON: JSON.stringify({
        "local:eth": {
          priceUsd: "3000",
          updatedAt: "2020-01-01T00:00:00.000Z",
          maxAgeSeconds: 60,
        },
      }),
    });

    expect(() => service.quotePayment({
      amountUsd: "1",
      chainId: 31337,
      assetId: "local:eth",
    })).toThrow("stale");
  });

  it("rejects invalid local funding wallet addresses before touching RPC", async () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_DEV_FAUCET_ENABLED: "true",
    });

    await expect(
      service.fundLocalDevWallet({
        wallet: "not-an-address",
        assetId: "local:eth",
      }),
    ).resolves.toEqual({ status: "invalid_wallet", wallet: "not-an-address" });
  });

  it("keeps local funding disabled until explicitly enabled", async () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
    });

    await expect(
      service.fundLocalDevWallet({
        wallet: "0x1111111111111111111111111111111111111111",
        assetId: "local:eth",
      }),
    ).rejects.toThrow("PAYMENT_DEV_FAUCET_ENABLED");
  });
});
