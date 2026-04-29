import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { EventBus } from "../shared/event_bus";

interface PaymentRecord {
  id: string;
  sessionId: string;
  trackId?: string;
  amountUsd: number;
  status: "initiated" | "settled" | "failed";
  split?: { artistPct: number; mixerPct: number; platformPct: number };
  txHash?: string;
}

type PaymentAssetKind = "native" | "wrapped_native" | "stablecoin";

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
  pricingStrategy: "usd_pegged" | "chainlink_feed" | "fixed_test_price";
}

export interface FundingOption {
  id: string;
  assetId: string;
  kind: "local_faucet" | "testnet_faucet" | "transfer" | "onramp" | "offramp";
  label: string;
  endpoint?: string;
  url?: string;
  localOnly?: boolean;
}

interface LocalPaymentArtifact {
  network: string;
  chainId: number;
  rpcUrl?: string;
  contracts?: Record<string, string>;
  assets?: PaymentAsset[];
  funding?: { enabled: boolean; options: FundingOption[] };
  x402?: { localMode: string; fallbackModes?: string[] };
}

const LOCAL_CHAIN_ID = 31337;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_LOCAL_PAYMENT_ARTIFACT = "contracts/deployments/local-payments.json";
const DEFAULT_LOCAL_FUNDER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
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

  initiatePayment(input: { sessionId: string; amountUsd: number; trackId?: string }) {
    const payment: PaymentRecord = {
      id: this.generateId("pay"),
      sessionId: input.sessionId,
      trackId: input.trackId,
      amountUsd: input.amountUsd,
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
      chainId: 0,
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

  getFundingOptions(input: { chainId?: number; wallet?: string }) {
    const assets = this.loadPaymentAssets();
    const chainId = input.chainId ?? this.getConfiguredChainId(assets);
    const options = this.loadFundingOptions();
    return {
      chainId,
      wallet: input.wallet ?? null,
      options: options.filter((option) => {
        const asset = assets.find((candidate) => candidate.assetId === option.assetId);
        return !asset || asset.chainId === chainId;
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

    const amount = input.amount ?? (asset.kind === "native" ? "1" : "100");
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
    if (configured.length > 0) {
      return configured;
    }
    return this.loadLocalPaymentArtifact()?.assets ?? [];
  }

  private loadFundingOptions(): FundingOption[] {
    const configured = this.parseJsonArray<FundingOption>(
      this.config.get<string>("PAYMENT_FUNDING_OPTIONS_JSON"),
    );
    if (configured.length > 0) {
      return configured;
    }
    return this.loadLocalPaymentArtifact()?.funding?.options ?? [];
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
