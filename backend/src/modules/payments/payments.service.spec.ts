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
      settlement: ["marketplace"],
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

  it("returns enabled payment assets from PAYMENT_ASSETS_JSON", () => {
    const service = createService({
      PAYMENT_ASSETS_JSON: JSON.stringify(assets),
      PAYMENT_DEFAULT_ASSET: "local:eth",
    });

    expect(service.getPaymentAssets()).toEqual({
      chainId: 31337,
      assets,
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
