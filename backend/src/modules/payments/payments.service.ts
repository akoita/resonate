import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { encodeFunctionData, formatUnits, parseEther, parseUnits } from "viem";
import { EventBus } from "../shared/event_bus";
import { decoratePaymentAmount, PaymentAmountMetadata } from "./payment-asset-metadata";

interface PaymentRecord {
  id: string;
  sessionId: string;
  trackId?: string;
  amountUsd: number;
  chainId: number;
  assetId?: string;
  asset?: PaymentAmountMetadata;
  status: "initiated" | "settled" | "failed";
  split?: { artistPct: number; mixerPct: number; platformPct: number };
  txHash?: string;
}

type PaymentAssetKind = "native" | "wrapped_native" | "stablecoin";
type PaymentPricingStrategy = "usd_pegged" | "chainlink_feed" | "fixed_test_price";

export type PaymentSurface =
  | "marketplace"
  | "upload_stake"
  | "dispute_counter_stake"
  | "appeal_stake"
  | "revenue_escrow"
  | "x402";

export interface PaymentAsset {
  assetId: string;
  chainId: number;
  symbol: string;
  name: string;
  kind: PaymentAssetKind;
  tokenAddress: string;
  decimals: number;
  enabled: boolean;
  settlement: string[];
  pricingStrategy: PaymentPricingStrategy;
}

export interface FundingOption {
  id: string;
  assetId: string;
  chainId?: number;
  kind: "local_faucet" | "testnet_faucet" | "transfer" | "onramp" | "offramp";
  label: string;
  description?: string;
  provider?: string;
  region?: string;
  endpoint?: string;
  url?: string;
  requiresWallet?: boolean;
  disabledReason?: string;
  localOnly?: boolean;
  surfaces?: PaymentSurface[];
}

interface LocalPaymentArtifact {
  network: string;
  chainId: number;
  rpcUrl?: string;
  contracts?: Record<string, string>;
  prices?: Record<string, string>;
  assets?: PaymentAsset[];
  funding?: { enabled: boolean; options: FundingOption[] };
  x402?: { localMode: string; fallbackModes?: string[] };
}

interface AssetPriceConfig {
  priceUsd: string | number;
  updatedAt?: string | number;
  maxAgeSeconds?: number;
}

interface PaymentAssetQuote {
  assetId: string;
  chainId: number;
  symbol: string;
  name: string;
  kind: PaymentAssetKind;
  tokenAddress: string;
  decimals: number;
  pricingStrategy: PaymentPricingStrategy;
  priceUsd: string;
  amount: string;
  amountUnits: string;
  expiresAt: string;
}

interface DecimalFraction {
  numerator: bigint;
  scale: bigint;
  normalized: string;
}

const LOCAL_CHAIN_ID = 31337;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_LOCAL_PAYMENT_ARTIFACT = "contracts/deployments/local-payments.json";
const DEFAULT_LOCAL_FUNDER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const DEFAULT_QUOTE_TTL_SECONDS = 60;
const DEFAULT_PRICE_MAX_STALENESS_SECONDS = 3600;
const DEFAULT_FIXED_TEST_PRICES_USD: Record<string, string> = {
  ETH: "3000",
  WETH: "3000",
  USDC: "1",
};
const PAYMENT_SURFACES: PaymentSurface[] = [
  "marketplace",
  "upload_stake",
  "dispute_counter_stake",
  "appeal_stake",
  "revenue_escrow",
  "x402",
];
const SURFACE_SETTLEMENT_ALIASES: Record<PaymentSurface, string[]> = {
  marketplace: ["marketplace"],
  upload_stake: ["upload_stake", "stake"],
  dispute_counter_stake: ["dispute_counter_stake", "dispute", "stake"],
  appeal_stake: ["appeal_stake", "appeal", "stake"],
  revenue_escrow: ["revenue_escrow", "escrow"],
  x402: ["x402"],
};
const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
const WRAPPED_NATIVE_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

@Injectable()
export class PaymentsService {
  private payments = new Map<string, PaymentRecord>();
  private splitConfigByTrack = new Map<
    string,
    { artistPct: number; mixerPct: number }
  >();

  constructor(
    private readonly eventBus: EventBus,
    private readonly config: ConfigService,
  ) {}

  initiatePayment(input: {
    sessionId: string;
    amountUsd: number;
    trackId?: string;
    chainId?: number;
    assetId?: string;
  }) {
    const assets = this.loadPaymentAssets();
    const chainId = input.chainId ?? this.getConfiguredChainId(assets);
    const asset = this.resolveInitiatedPaymentAsset(assets, chainId, input.assetId);
    const quote = this.buildAssetQuote(
      asset,
      this.parsePositiveDecimal(input.amountUsd, "amountUsd"),
      new Date(Date.now() + DEFAULT_QUOTE_TTL_SECONDS * 1000).toISOString(),
    );
    const assetMetadata = decoratePaymentAmount({
      chainId,
      paymentToken: asset.tokenAddress,
      amountUnits: quote.amountUnits,
      assets,
      canonicalAmountUsd: input.amountUsd,
    });
    const payment: PaymentRecord = {
      id: this.generateId("pay"),
      sessionId: input.sessionId,
      trackId: input.trackId,
      amountUsd: input.amountUsd,
      chainId,
      assetId: asset.assetId,
      asset: assetMetadata,
      status: "initiated",
    };
    if (input.trackId) {
      const config = this.splitConfigByTrack.get(input.trackId);
      if (config) {
        const platformPct = Math.max(0, 100 - config.artistPct - config.mixerPct);
        payment.split = { ...config, platformPct };
      }
    }
    this.payments.set(payment.id, payment);
    this.eventBus.publish({
      eventName: "payment.initiated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      paymentId: payment.id,
      amountUsd: payment.amountUsd,
      sessionId: payment.sessionId,
      trackId: payment.trackId,
      chainId: payment.chainId,
      paymentToken: assetMetadata.paymentToken,
      paymentAssetId: assetMetadata.paymentAssetId,
      paymentAssetSymbol: assetMetadata.paymentAssetSymbol,
      paymentAssetDecimals: assetMetadata.paymentAssetDecimals,
      settlementAmount: assetMetadata.settlementAmount,
      settlementAmountUnits: assetMetadata.settlementAmountUnits,
    });
    return payment;
  }

  setSplitConfig(input: { trackId: string; artistPct: number; mixerPct: number }) {
    if (input.artistPct + input.mixerPct > 100) {
      return { trackId: input.trackId, status: "invalid_split" };
    }
    this.splitConfigByTrack.set(input.trackId, {
      artistPct: input.artistPct,
      mixerPct: input.mixerPct,
    });
    return { trackId: input.trackId, status: "ok" };
  }

  splitPayment(input: { paymentId: string; artistPct: number; mixerPct: number }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment) {
      return { paymentId: input.paymentId, status: "not_found" };
    }
    if (input.artistPct + input.mixerPct > 100) {
      return { paymentId: input.paymentId, status: "invalid_split" };
    }
    const platformPct = Math.max(0, 100 - input.artistPct - input.mixerPct);
    payment.split = {
      artistPct: input.artistPct,
      mixerPct: input.mixerPct,
      platformPct,
    };
    payment.status = "settled";
    payment.txHash = this.generateId("tx");
    this.eventBus.publish({
      eventName: "payment.settled",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      paymentId: payment.id,
      txHash: payment.txHash,
      status: payment.status,
      amountUsd: payment.amountUsd,
      sessionId: payment.sessionId,
      trackId: payment.trackId,
      chainId: payment.chainId,
      paymentToken: payment.asset?.paymentToken,
      paymentAssetId: payment.asset?.paymentAssetId,
      paymentAssetSymbol: payment.asset?.paymentAssetSymbol,
      paymentAssetDecimals: payment.asset?.paymentAssetDecimals,
      settlementAmount: payment.asset?.settlementAmount,
      settlementAmountUnits: payment.asset?.settlementAmountUnits,
    });
    return payment;
  }

  confirmOnChain(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { paymentId, status: "not_found" };
    }
    return {
      paymentId,
      status: payment.status,
      txHash: payment.txHash ?? null,
    };
  }

  getPaymentAssets(chainId?: number) {
    const assets = this.loadPaymentAssets();
    return {
      chainId: chainId ?? this.getConfiguredChainId(assets),
      assets: typeof chainId === "number"
        ? assets.filter((asset) => asset.chainId === chainId)
        : assets,
      defaultAsset: this.config.get<string>("PAYMENT_DEFAULT_ASSET") ?? null,
      source: this.getPaymentConfigSource(),
    };
  }

  quotePayment(input: {
    amountUsd: string | number;
    chainId?: number;
    assetId?: string;
    surface?: PaymentSurface;
  }) {
    const amountUsd = this.parsePositiveDecimal(input.amountUsd, "amountUsd");
    const assets = this.loadPaymentAssets();
    const chainId = input.chainId ?? this.getConfiguredChainId(assets);
    const surface = input.surface;
    this.assertKnownSurface(surface);

    const chainAssets = assets.filter((asset) => asset.chainId === chainId);
    const candidates = input.assetId
      ? chainAssets.filter((asset) => asset.assetId === input.assetId)
      : chainAssets.filter((asset) => this.assetSupportsSurface(asset, surface));

    if (input.assetId && candidates.length === 0) {
      throw new BadRequestException(`Payment asset ${input.assetId} is not enabled on chain ${chainId}`);
    }
    if (candidates.length === 0) {
      throw new BadRequestException(`No enabled payment assets are configured for chain ${chainId}`);
    }

    const expiresAt = new Date(Date.now() + this.getQuoteTtlSeconds() * 1000).toISOString();
    const quotes = candidates.map((asset) => this.buildAssetQuote(asset, amountUsd, expiresAt));
    return {
      chainId,
      surface: surface ?? null,
      amountUsd: amountUsd.normalized,
      quotes,
      defaultAsset: this.resolveDefaultAssetId(chainAssets, surface),
      source: this.getPaymentConfigSource(),
    };
  }

  getPaymentPolicy(input: { chainId?: number; surface?: PaymentSurface }) {
    const assets = this.loadPaymentAssets();
    const chainId = input.chainId ?? this.getConfiguredChainId(assets);
    this.assertKnownSurface(input.surface);
    const chainAssets = assets.filter((asset) => asset.chainId === chainId);
    const surfaces = input.surface ? [input.surface] : PAYMENT_SURFACES;

    return {
      chainId,
      policies: surfaces.map((surface) => {
        const acceptedAssets = chainAssets.filter((asset) => this.assetSupportsSurface(asset, surface));
        return {
          surface,
          acceptedAssetIds: acceptedAssets.map((asset) => asset.assetId),
          defaultAsset: this.resolveDefaultAssetId(acceptedAssets, surface),
          requiresGas: acceptedAssets.some((asset) => asset.kind !== "native"),
          quoteRequired: true,
        };
      }),
    };
  }

  getFundingOptions(input: {
    chainId?: number;
    wallet?: string;
    assetId?: string;
    surface?: PaymentSurface;
  }) {
    const assets = this.loadPaymentAssets();
    const chainId = input.chainId ?? this.getConfiguredChainId(assets);
    this.assertKnownSurface(input.surface);
    const options = this.loadFundingOptions(assets);
    return {
      chainId,
      wallet: input.wallet ?? null,
      options: options.filter((option) => {
        const asset = assets.find((candidate) => candidate.assetId === option.assetId);
        if (input.assetId && option.assetId !== input.assetId) {
          return false;
        }
        if (input.surface && option.surfaces && !option.surfaces.includes(input.surface)) {
          return false;
        }
        if (asset && !this.assetSupportsSurface(asset, input.surface)) {
          return false;
        }
        const optionChainId = option.chainId ?? asset?.chainId;
        return !optionChainId || optionChainId === chainId;
      }),
    };
  }

  getLocalDevStatus() {
    const artifact = this.loadLocalPaymentArtifact();
    const assets = this.loadPaymentAssets();
    const chainId = this.getConfiguredChainId(assets);
    return {
      chainId,
      localChain: chainId === LOCAL_CHAIN_ID,
      artifactPath: this.resolveArtifactPath() ?? null,
      artifactPresent: Boolean(artifact),
      assets,
      fundingControlsEnabled:
        this.config.get<string>("PAYMENT_DEV_FAUCET_ENABLED") === "true" &&
        chainId === LOCAL_CHAIN_ID &&
        process.env.NODE_ENV !== "production",
      x402LocalMode:
        this.config.get<string>("X402_LOCAL_MODE") ??
        artifact?.x402?.localMode ??
        null,
      rpcUrl: this.getRpcUrl(),
    };
  }

  async fundLocalDevWallet(input: {
    wallet: string;
    assetId: string;
    amount?: string;
  }) {
    const wallet = input.wallet?.trim();
    if (!ADDRESS_PATTERN.test(wallet)) {
      return { status: "invalid_wallet", wallet };
    }

    const assets = this.loadPaymentAssets();
    const asset = assets.find((candidate) => candidate.assetId === input.assetId);
    if (!asset) {
      return { status: "unknown_asset", assetId: input.assetId };
    }
    this.assertLocalFundingAllowed(asset.chainId);

    const amount = input.amount ?? (asset.kind === "native" || asset.kind === "wrapped_native" ? "1" : "100");
    const amountUnits = asset.kind === "native"
      ? parseEther(amount)
      : parseUnits(amount, asset.decimals);

    if (asset.kind === "native") {
      await this.rpc("anvil_setBalance", [wallet, this.toRpcQuantity(amountUnits)]);
      return {
        status: "funded",
        assetId: asset.assetId,
        wallet,
        amount,
        txHash: null,
      };
    }

    if (!ADDRESS_PATTERN.test(asset.tokenAddress) || asset.tokenAddress === ZERO_ADDRESS) {
      return { status: "invalid_token", assetId: asset.assetId };
    }

    if (asset.kind === "wrapped_native") {
      const funder = this.getLocalFunderAddress();
      await this.rpc("eth_sendTransaction", [
        {
          from: funder,
          to: asset.tokenAddress,
          data: encodeFunctionData({
            abi: WRAPPED_NATIVE_ABI,
            functionName: "deposit",
          }),
          value: this.toRpcQuantity(amountUnits),
        },
      ]);
      const txHash = await this.rpc("eth_sendTransaction", [
        {
          from: funder,
          to: asset.tokenAddress,
          data: encodeFunctionData({
            abi: WRAPPED_NATIVE_ABI,
            functionName: "transfer",
            args: [wallet as `0x${string}`, amountUnits],
          }),
        },
      ]);

      return {
        status: "funded",
        assetId: asset.assetId,
        wallet,
        amount,
        txHash,
      };
    }

    const data = encodeFunctionData({
      abi: MINT_ABI,
      functionName: "mint",
      args: [wallet as `0x${string}`, amountUnits],
    });
    const txHash = await this.rpc("eth_sendTransaction", [
      {
        from: this.getLocalFunderAddress(),
        to: asset.tokenAddress,
        data,
      },
    ]);

    return {
      status: "funded",
      assetId: asset.assetId,
      wallet,
      amount,
      txHash,
    };
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  private loadPaymentAssets(): PaymentAsset[] {
    const configured = this.parseJsonArray<PaymentAsset>(
      this.config.get<string>("PAYMENT_ASSETS_JSON"),
    );
    const assets = configured.length > 0
      ? configured
      : this.loadLocalPaymentArtifact()?.assets ?? [];
    return assets.filter((asset) => asset.enabled);
  }

  private loadFundingOptions(assets: PaymentAsset[]): FundingOption[] {
    const configured = this.parseJsonArray<FundingOption>(
      this.config.get<string>("PAYMENT_FUNDING_OPTIONS_JSON"),
    );
    if (configured.length > 0) {
      return configured;
    }
    const localOptions = this.loadLocalPaymentArtifact()?.funding?.options ?? [];
    if (localOptions.length > 0) {
      return localOptions;
    }
    return this.buildDefaultFundingOptions(assets);
  }

  private buildDefaultFundingOptions(assets: PaymentAsset[]): FundingOption[] {
    const options: FundingOption[] = [];
    const baseSepoliaAssets = assets.filter((asset) => asset.chainId === BASE_SEPOLIA_CHAIN_ID);
    const baseSepoliaEth = baseSepoliaAssets.find((asset) => {
      return asset.kind === "native" || asset.assetId === "base-sepolia:eth";
    });
    const baseSepoliaUsdc = baseSepoliaAssets.find((asset) => {
      return asset.kind === "stablecoin" && asset.symbol.toUpperCase() === "USDC";
    });

    if (baseSepoliaEth) {
      options.push({
        id: "base-sepolia-eth-transfer",
        assetId: baseSepoliaEth.assetId,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        kind: "transfer",
        label: "Transfer Base Sepolia ETH",
        description: "Send Base Sepolia ETH to this wallet for gas.",
        provider: "Wallet or exchange",
        requiresWallet: true,
      });
      const ethFaucetUrl = this.config.get<string>("PAYMENT_BASE_SEPOLIA_ETH_FAUCET_URL");
      if (ethFaucetUrl) {
        options.push({
          id: "base-sepolia-eth-faucet",
          assetId: baseSepoliaEth.assetId,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          kind: "testnet_faucet",
          label: "Get Base Sepolia ETH",
          description: "Use a configured testnet faucet to fund gas.",
          provider: this.config.get<string>("PAYMENT_BASE_SEPOLIA_ETH_FAUCET_PROVIDER") ?? "Configured faucet",
          url: ethFaucetUrl,
          requiresWallet: true,
        });
      }
    }

    if (baseSepoliaUsdc) {
      options.push({
        id: "base-sepolia-usdc-transfer",
        assetId: baseSepoliaUsdc.assetId,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        kind: "transfer",
        label: "Transfer Circle USDC",
        description: "Send Base Sepolia USDC to this wallet for settlement.",
        provider: "Wallet or exchange",
        requiresWallet: true,
      });
      const usdcFaucetUrl = this.config.get<string>("PAYMENT_BASE_SEPOLIA_USDC_FAUCET_URL");
      if (usdcFaucetUrl) {
        options.push({
          id: "base-sepolia-usdc-faucet",
          assetId: baseSepoliaUsdc.assetId,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          kind: "testnet_faucet",
          label: "Get Circle USDC",
          description: "Use the configured Circle USDC testnet faucet.",
          provider: this.config.get<string>("PAYMENT_BASE_SEPOLIA_USDC_FAUCET_PROVIDER") ?? "Circle",
          url: usdcFaucetUrl,
          requiresWallet: true,
        });
      }
    }

    return options;
  }

  private loadLocalPaymentArtifact(): LocalPaymentArtifact | null {
    const artifactPath = this.resolveArtifactPath();
    if (!artifactPath) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(artifactPath, "utf8")) as LocalPaymentArtifact;
    } catch {
      return null;
    }
  }

  private resolveArtifactPath() {
    const configured =
      this.config.get<string>("PAYMENT_DEV_ARTIFACT_PATH") ??
      DEFAULT_LOCAL_PAYMENT_ARTIFACT;
    const candidates = path.isAbsolute(configured)
      ? [configured]
      : [
          path.resolve(process.cwd(), configured),
          path.resolve(process.cwd(), "..", configured),
        ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  private parseJsonArray<T>(value?: string): T[] {
    if (!value) {
      return [];
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }

  private parseJsonObject<T extends Record<string, unknown>>(value?: string): T | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as T
        : null;
    } catch {
      return null;
    }
  }

  private getConfiguredChainId(assets: PaymentAsset[]) {
    const configured =
      this.config.get<string>("PAYMENT_CHAIN_ID") ??
      this.config.get<string>("AA_CHAIN_ID") ??
      this.config.get<string>("NEXT_PUBLIC_CHAIN_ID");
    const parsed = configured ? Number(configured) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    return assets[0]?.chainId ?? LOCAL_CHAIN_ID;
  }

  private getPaymentConfigSource() {
    if (this.config.get<string>("PAYMENT_ASSETS_JSON")) {
      return "env";
    }
    if (this.resolveArtifactPath()) {
      return "artifact";
    }
    return "empty";
  }

  private buildAssetQuote(
    asset: PaymentAsset,
    amountUsd: DecimalFraction,
    expiresAt: string,
  ): PaymentAssetQuote {
    const priceUsd = this.resolveAssetPriceUsd(asset);
    const amountUnits = this.quoteAssetUnits(amountUsd, priceUsd, asset.decimals);
    return {
      assetId: asset.assetId,
      chainId: asset.chainId,
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      tokenAddress: asset.tokenAddress,
      decimals: asset.decimals,
      pricingStrategy: asset.pricingStrategy,
      priceUsd: priceUsd.normalized,
      amount: formatUnits(amountUnits, asset.decimals),
      amountUnits: amountUnits.toString(),
      expiresAt,
    };
  }

  private resolveInitiatedPaymentAsset(assets: PaymentAsset[], chainId: number, assetId?: string) {
    const chainAssets = assets.filter((asset) => asset.chainId === chainId);
    const selected = assetId
      ? chainAssets.find((asset) => asset.assetId === assetId)
      : chainAssets.find((asset) => asset.assetId === this.resolveDefaultAssetId(chainAssets)) ?? chainAssets[0];
    if (!selected) {
      return {
        assetId: `${chainId === LOCAL_CHAIN_ID ? "local" : `chain-${chainId}`}:eth`,
        chainId,
        symbol: "ETH",
        name: "Native Ether",
        kind: "native" as const,
        tokenAddress: ZERO_ADDRESS,
        decimals: 18,
        enabled: true,
        settlement: PAYMENT_SURFACES,
        pricingStrategy: "fixed_test_price" as const,
      };
    }
    if (!selected.enabled) {
      throw new BadRequestException(`Payment asset ${selected.assetId} is disabled`);
    }
    return selected;
  }

  private quoteAssetUnits(
    amountUsd: DecimalFraction,
    priceUsd: DecimalFraction,
    decimals: number,
  ) {
    const unitScale = 10n ** BigInt(decimals);
    const numerator = amountUsd.numerator * priceUsd.scale * unitScale;
    const denominator = amountUsd.scale * priceUsd.numerator;
    return this.ceilDiv(numerator, denominator);
  }

  private resolveAssetPriceUsd(asset: PaymentAsset): DecimalFraction {
    if (asset.pricingStrategy === "usd_pegged") {
      return this.parsePositiveDecimal("1", `priceUsd:${asset.assetId}`);
    }

    const priceConfig = this.lookupAssetPriceConfig(asset);
    if (priceConfig) {
      this.assertPriceFresh(asset, priceConfig);
      return this.parsePositiveDecimal(priceConfig.priceUsd, `priceUsd:${asset.assetId}`);
    }

    const artifactPrice = this.loadLocalPaymentArtifact()?.prices?.[`${asset.symbol}/USD`];
    if (artifactPrice) {
      return this.parsePositiveDecimal(artifactPrice, `priceUsd:${asset.assetId}`);
    }

    if (asset.pricingStrategy === "fixed_test_price") {
      const fixedPrice = DEFAULT_FIXED_TEST_PRICES_USD[asset.symbol.toUpperCase()];
      if (fixedPrice) {
        return this.parsePositiveDecimal(fixedPrice, `priceUsd:${asset.assetId}`);
      }
    }

    throw new BadRequestException(`No USD price configured for payment asset ${asset.assetId}`);
  }

  private lookupAssetPriceConfig(asset: PaymentAsset): AssetPriceConfig | null {
    const configured = this.parseJsonObject<Record<string, unknown>>(
      this.config.get<string>("PAYMENT_ASSET_PRICES_JSON"),
    );
    const rawPrice = configured?.[asset.assetId] ??
      configured?.[asset.symbol] ??
      configured?.[asset.symbol.toUpperCase()] ??
      configured?.[`${asset.symbol}/USD`];

    if (rawPrice === undefined) {
      return null;
    }
    if (typeof rawPrice === "string" || typeof rawPrice === "number") {
      return { priceUsd: rawPrice };
    }
    if (rawPrice && typeof rawPrice === "object" && !Array.isArray(rawPrice)) {
      const record = rawPrice as Record<string, unknown>;
      const priceUsd = record.priceUsd;
      if (typeof priceUsd === "string" || typeof priceUsd === "number") {
        return {
          priceUsd,
          updatedAt: typeof record.updatedAt === "string" || typeof record.updatedAt === "number"
            ? record.updatedAt
            : undefined,
          maxAgeSeconds: typeof record.maxAgeSeconds === "number"
            ? record.maxAgeSeconds
            : undefined,
        };
      }
    }
    throw new BadRequestException(`Invalid PAYMENT_ASSET_PRICES_JSON entry for ${asset.assetId}`);
  }

  private assertPriceFresh(asset: PaymentAsset, priceConfig: AssetPriceConfig) {
    if (priceConfig.updatedAt === undefined) {
      return;
    }
    const updatedAt = typeof priceConfig.updatedAt === "number"
      ? priceConfig.updatedAt
      : Date.parse(priceConfig.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      throw new BadRequestException(`Invalid updatedAt for payment asset ${asset.assetId}`);
    }
    const maxAgeSeconds =
      priceConfig.maxAgeSeconds ??
      this.getNumberConfig("PAYMENT_QUOTE_MAX_STALENESS_SECONDS", DEFAULT_PRICE_MAX_STALENESS_SECONDS);
    const ageSeconds = Math.floor((Date.now() - updatedAt) / 1000);
    if (ageSeconds > maxAgeSeconds) {
      throw new BadRequestException(`USD price for payment asset ${asset.assetId} is stale`);
    }
  }

  private assetSupportsSurface(asset: PaymentAsset, surface?: PaymentSurface) {
    if (!surface) {
      return true;
    }
    const accepted = new Set(asset.settlement);
    return SURFACE_SETTLEMENT_ALIASES[surface].some((alias) => accepted.has(alias));
  }

  private resolveDefaultAssetId(assets: PaymentAsset[], surface?: PaymentSurface) {
    const defaultAsset = this.config.get<string>("PAYMENT_DEFAULT_ASSET");
    if (defaultAsset && assets.some((asset) => {
      return asset.assetId === defaultAsset && this.assetSupportsSurface(asset, surface);
    })) {
      return defaultAsset;
    }
    const stablecoin = assets.find((asset) => {
      return asset.kind === "stablecoin" && this.assetSupportsSurface(asset, surface);
    });
    return stablecoin?.assetId ?? assets[0]?.assetId ?? null;
  }

  private assertKnownSurface(surface?: PaymentSurface) {
    if (surface && !PAYMENT_SURFACES.includes(surface)) {
      throw new BadRequestException(`Unknown payment surface ${surface}`);
    }
  }

  private parsePositiveDecimal(value: string | number, label: string): DecimalFraction {
    const raw = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new BadRequestException(`${label} must be a positive decimal`);
    }
    const [whole, fraction = ""] = raw.split(".");
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
    const normalizedFraction = fraction.replace(/0+$/, "");
    const scale = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole) * scale + BigInt(fraction || "0");
    if (numerator <= 0n) {
      throw new BadRequestException(`${label} must be greater than zero`);
    }
    return {
      numerator,
      scale,
      normalized: normalizedFraction
        ? `${normalizedWhole}.${normalizedFraction}`
        : normalizedWhole,
    };
  }

  private ceilDiv(numerator: bigint, denominator: bigint) {
    if (denominator <= 0n) {
      throw new BadRequestException("Quote denominator must be greater than zero");
    }
    return (numerator + denominator - 1n) / denominator;
  }

  private getQuoteTtlSeconds() {
    return this.getNumberConfig("PAYMENT_QUOTE_TTL_SECONDS", DEFAULT_QUOTE_TTL_SECONDS);
  }

  private getNumberConfig(name: string, fallback: number) {
    const configured = this.config.get<string>(name);
    const parsed = configured ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private assertLocalFundingAllowed(chainId: number) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local payment funding is disabled in production");
    }
    if (chainId !== LOCAL_CHAIN_ID) {
      throw new Error(`Local payment funding only supports chain ${LOCAL_CHAIN_ID}`);
    }
    if (this.config.get<string>("PAYMENT_DEV_FAUCET_ENABLED") !== "true") {
      throw new Error("PAYMENT_DEV_FAUCET_ENABLED must be true for local funding");
    }
  }

  private getRpcUrl() {
    return (
      this.config.get<string>("RPC_URL") ??
      this.config.get<string>("LOCAL_RPC_URL") ??
      "http://localhost:8545"
    );
  }

  private getLocalFunderAddress() {
    return this.config.get<string>("PAYMENT_DEV_FUNDER_ADDRESS") ?? DEFAULT_LOCAL_FUNDER;
  }

  private async rpc(method: string, params: unknown[]) {
    const response = await fetch(this.getRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
    }
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    if (payload.error) {
      throw new Error(payload.error.message ?? `RPC ${method} failed`);
    }
    return payload.result;
  }

  private toRpcQuantity(value: bigint) {
    return `0x${value.toString(16)}`;
  }
}
