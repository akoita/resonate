import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, foundry, sepolia } from "viem/chains";
import { prisma } from "../../db/prisma";

export const SIGNUP_FAUCET_STORE = "SIGNUP_FAUCET_STORE";
export const SIGNUP_FAUCET_SENDER = "SIGNUP_FAUCET_SENDER";

// Keep the original purpose string so existing idempotency records still apply
// after the faucet is generalized beyond Ethereum Sepolia.
const SIGNUP_FAUCET_PURPOSE = "signup-sepolia-faucet";
/** Purpose of the welcome test-USDC leg, recorded next to the ETH leg. */
export const WELCOME_USDC_PURPOSE = "welcome-test-usdc";
const DEFAULT_FAUCET_CHAIN_ID = 11155111;
const DEFAULT_FAUCET_AMOUNT_ETH = "0.1";
/** Test-network USDC uses 6 decimals, like the real token. */
const USDC_DECIMALS = 6;
/** At most this many accounts receive welcome money per UTC day by default. */
const DEFAULT_DAILY_LIMIT = 25;
/**
 * The faucet only ever pays on test networks (Base Sepolia, Ethereum Sepolia,
 * local Anvil). A misconfigured chain override can never send real money.
 */
export const FAUCET_TEST_CHAIN_IDS: ReadonlySet<number> = new Set([84532, 11155111, 31337]);

export type AuthMode = "login" | "register";

export type SignupFaucetSent = {
  status: "sent";
  chainId: number;
  /** ETH leg; absent when only test USDC was sent. */
  txHash?: Hex;
  amountEth?: string;
  /** Test USDC leg. */
  usdcTxHash?: Hex;
  amountUsdc?: string;
};

export type SignupFaucetResult =
  | { status: "skipped"; reason: string }
  | SignupFaucetSent
  | { status: "failed"; reason: string };

type SignupFaucetConfig = {
  enabled: boolean;
  chainId: number;
  amountEth: string;
  amountWei: string;
  /** Test USDC sent once per account; "0" or empty switches the leg off. */
  amountUsdc: string;
  amountUsdcUnits: string;
  usdcTokenAddress?: Address;
  dailyLimit: number;
  rpcUrl?: string;
  funderPrivateKey?: Hex;
};

export type WelcomeLegStatus = "pending" | "sent" | "failed" | null;

export type WelcomeFundsStatus = {
  /** The deployment hands out welcome test money at all. */
  available: boolean;
  chainId: number;
  amountEth: string | null;
  amountUsdc: string | null;
  eth: WelcomeLegStatus;
  usdc: WelcomeLegStatus;
  /** A configured leg has not been sent yet, so the claim button may show. */
  canClaim: boolean;
};

type SignupFaucetAttempt = {
  id: string;
  status: string;
  txHash?: string | null;
};

export interface SignupFaucetStore {
  createPending(input: {
    userId: string;
    walletAddress: string;
    chainId: number;
    amountWei: string;
    purpose: string;
  }): Promise<{ created: boolean; attempt: SignupFaucetAttempt }>;
  markSent(id: string, txHash: Hex): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  /** Distinct accounts with a pending or sent attempt touched since `since`. */
  countAccountsFundedSince(since: Date): Promise<number>;
  listForUser(userId: string, chainId: number): Promise<Array<{ purpose: string; status: string }>>;
  /** The address sign-in verified for this user, when there is one. */
  findVerifiedWallet(userId: string): Promise<{ address: string; chainId: number } | null>;
}

export interface SignupFaucetSender {
  sendEth(input: {
    rpcUrl?: string;
    chainId: number;
    funderPrivateKey: Hex;
    to: Address;
    amountWei: bigint;
  }): Promise<Hex>;
  sendErc20(input: {
    rpcUrl?: string;
    chainId: number;
    funderPrivateKey: Hex;
    token: Address;
    to: Address;
    amount: bigint;
  }): Promise<Hex>;
}

function normalizePrivateKey(value?: string | null): Hex | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return `0x${trimmed.replace(/^0x/, "")}` as Hex;
}

function parseEnabled(value?: string | null) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function firstConfiguredValue(config: ConfigService, keys: string[]) {
  for (const key of keys) {
    const value = config.get<string>(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseChainId(value?: string | null) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCaip2ChainId(value?: string | null) {
  const match = /^eip155:(\d+)$/.exec(value?.trim() ?? "");
  return match ? parseChainId(match[1]) : undefined;
}

function chainFor(chainId: number, rpcUrl?: string): Chain {
  if (chainId === 31337) return foundry;
  if (chainId === 8453) {
    return rpcUrl
      ? { ...base, rpcUrls: { default: { http: [rpcUrl] } } }
      : base;
  }
  if (chainId === 84532) {
    return rpcUrl
      ? { ...baseSepolia, rpcUrls: { default: { http: [rpcUrl] } } }
      : baseSepolia;
  }
  if (chainId === 11155111) {
    return rpcUrl
      ? { ...sepolia, rpcUrls: { default: { http: [rpcUrl] } } }
      : sepolia;
  }
  return {
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  };
}

function resolveSignupFaucetChainId(config: ConfigService, activeChainId?: number) {
  return (
    parseChainId(config.get<string>("SIGNUP_FAUCET_CHAIN_ID")) ??
    activeChainId ??
    parseChainId(config.get<string>("SIGNUP_SEPOLIA_FAUCET_CHAIN_ID")) ??
    parseChainId(firstConfiguredValue(config, [
      "PAYMENT_CHAIN_ID",
      "AA_CHAIN_ID",
      "CHAIN_ID",
      "NEXT_PUBLIC_CHAIN_ID",
      "INDEXER_CHAIN_ID",
    ])) ??
    parseCaip2ChainId(config.get<string>("X402_NETWORK")) ??
    DEFAULT_FAUCET_CHAIN_ID
  );
}

function resolveSignupFaucetRpcUrl(config: ConfigService, chainId: number) {
  const explicitRpc = firstConfiguredValue(config, ["SIGNUP_FAUCET_RPC_URL"]);
  if (explicitRpc) return explicitRpc;

  if (chainId === 84532) {
    return firstConfiguredValue(config, ["BASE_SEPOLIA_RPC_URL", "RPC_URL"]) || "https://sepolia.base.org";
  }
  if (chainId === 8453) {
    return firstConfiguredValue(config, ["BASE_RPC_URL", "RPC_URL"]) || "https://mainnet.base.org";
  }
  if (chainId === 11155111) {
    return firstConfiguredValue(config, [
      "SIGNUP_SEPOLIA_FAUCET_RPC_URL",
      "SEPOLIA_RPC_URL",
      "RPC_URL",
    ]);
  }
  if (chainId === 31337) {
    return firstConfiguredValue(config, ["LOCAL_RPC_URL", "RPC_URL"]) || "http://localhost:8545";
  }

  return config.get<string>("RPC_URL")?.trim();
}

function parseDecimalAmount(value: string | undefined, decimals: number) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return { amount: "0", units: "0" };
  try {
    return { amount: trimmed, units: parseUnits(trimmed, decimals).toString() };
  } catch {
    return { amount: "0", units: "0" };
  }
}

function parseDailyLimit(value?: string) {
  const parsed = Number(value?.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

function optionalAddress(value?: string): Address | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? getAddress(trimmed) : undefined;
}

export function getSignupFaucetConfig(config: ConfigService, activeChainId?: number): SignupFaucetConfig {
  const chainId = resolveSignupFaucetChainId(config, activeChainId);
  const amountEth =
    firstConfiguredValue(config, [
      "SIGNUP_FAUCET_AMOUNT_ETH",
      "SIGNUP_SEPOLIA_FAUCET_AMOUNT_ETH",
    ]) ?? DEFAULT_FAUCET_AMOUNT_ETH;
  const usdc = parseDecimalAmount(config.get<string>("SIGNUP_FAUCET_USDC_AMOUNT"), USDC_DECIMALS);

  return {
    amountUsdc: usdc.amount,
    amountUsdcUnits: usdc.units,
    usdcTokenAddress: optionalAddress(
      firstConfiguredValue(config, [
        "SIGNUP_FAUCET_USDC_TOKEN_ADDRESS",
        "SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS",
        "PAYMENT_USDC_ADDRESS",
      ]),
    ),
    dailyLimit: parseDailyLimit(config.get<string>("SIGNUP_FAUCET_DAILY_LIMIT")),
    enabled: parseEnabled(firstConfiguredValue(config, [
      "SIGNUP_FAUCET_ENABLED",
      "SIGNUP_SEPOLIA_FAUCET_ENABLED",
    ])),
    chainId,
    amountEth,
    amountWei: parseEther(amountEth).toString(),
    rpcUrl: resolveSignupFaucetRpcUrl(config, chainId),
    funderPrivateKey: normalizePrivateKey(
      firstConfiguredValue(config, [
        "SIGNUP_FAUCET_FUNDER_PRIVATE_KEY",
        "SIGNUP_SEPOLIA_FAUCET_FUNDER_PRIVATE_KEY",
        "PRIVATE_KEY",
      ]),
    ),
  };
}

@Injectable()
export class PrismaSignupFaucetStore implements SignupFaucetStore {
  async createPending(input: {
    userId: string;
    walletAddress: string;
    chainId: number;
    amountWei: string;
    purpose: string;
  }) {
    try {
      const attempt = await prisma.signupFaucetAttempt.create({
        data: {
          userId: input.userId,
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          amountWei: input.amountWei,
          purpose: input.purpose,
          status: "pending",
        },
      });
      return { created: true, attempt };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") {
        throw error;
      }
      const attempt = await prisma.signupFaucetAttempt.findFirstOrThrow({
        where: {
          userId: input.userId,
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          purpose: input.purpose,
        },
      });
      if (attempt.status === "failed") {
        const retryAttempt = await prisma.signupFaucetAttempt.update({
          where: { id: attempt.id },
          data: {
            amountWei: input.amountWei,
            status: "pending",
            txHash: null,
            failureReason: null,
          },
        });
        return { created: true, attempt: retryAttempt };
      }
      return { created: false, attempt };
    }
  }

  async markSent(id: string, txHash: Hex) {
    await prisma.signupFaucetAttempt.update({
      where: { id },
      data: { status: "sent", txHash, failureReason: null },
    });
  }

  async markFailed(id: string, reason: string) {
    await prisma.signupFaucetAttempt.update({
      where: { id },
      data: { status: "failed", failureReason: reason.slice(0, 1000) },
    });
  }

  async countAccountsFundedSince(since: Date) {
    const rows = await prisma.signupFaucetAttempt.findMany({
      where: { status: { in: ["pending", "sent"] }, updatedAt: { gte: since } },
      distinct: ["userId"],
      select: { userId: true },
    });
    return rows.length;
  }

  async listForUser(userId: string, chainId: number) {
    return prisma.signupFaucetAttempt.findMany({
      where: { userId, chainId },
      select: { purpose: true, status: true },
    });
  }

  async findVerifiedWallet(userId: string) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { address: true, chainId: true, addressVerifiedAt: true },
    });
    if (!wallet?.addressVerifiedAt) return null;
    return { address: wallet.address, chainId: wallet.chainId };
  }
}

@Injectable()
export class ViemSignupFaucetSender implements SignupFaucetSender {
  async sendEth(input: {
    rpcUrl?: string;
    chainId: number;
    funderPrivateKey: Hex;
    to: Address;
    amountWei: bigint;
  }): Promise<Hex> {
    const account = privateKeyToAccount(input.funderPrivateKey);
    const chain = chainFor(input.chainId, input.rpcUrl);
    const client = createWalletClient({
      account,
      chain,
      transport: http(input.rpcUrl),
    });

    return client.sendTransaction({
      account,
      to: input.to,
      value: input.amountWei,
    });
  }

  async sendErc20(input: {
    rpcUrl?: string;
    chainId: number;
    funderPrivateKey: Hex;
    token: Address;
    to: Address;
    amount: bigint;
  }): Promise<Hex> {
    const account = privateKeyToAccount(input.funderPrivateKey);
    const chain = chainFor(input.chainId, input.rpcUrl);
    const client = createWalletClient({
      account,
      chain,
      transport: http(input.rpcUrl),
    });

    return client.writeContract({
      account,
      chain,
      address: input.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [input.to, input.amount],
    });
  }
}

function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

type LegOutcome =
  | { leg: "eth" | "usdc"; status: "sent"; txHash: Hex }
  | { leg: "eth" | "usdc"; status: "failed"; reason: string }
  | { leg: "eth" | "usdc"; status: "skipped"; reason: string };

/**
 * Welcome test money for newcomers on test networks (staging): a little ETH
 * for gas and, when configured, test USDC to try pledging. Each leg is sent at
 * most once per account, every UTC day is capped, and only test chains pay.
 */
@Injectable()
export class SignupFaucetService {
  private readonly logger = new Logger(SignupFaucetService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(SIGNUP_FAUCET_STORE) private readonly store?: SignupFaucetStore,
    @Optional() @Inject(SIGNUP_FAUCET_SENDER) private readonly sender?: SignupFaucetSender,
  ) { }

  /** Overridable clock for the daily limit. */
  protected now() {
    return new Date();
  }

  private getStore() {
    return this.store ?? new PrismaSignupFaucetStore();
  }

  private getSender() {
    return this.sender ?? new ViemSignupFaucetSender();
  }

  private faucetConfig(activeChainId?: number) {
    return getSignupFaucetConfig(this.config, activeChainId ?? this.activeChainId());
  }

  private activeChainId() {
    return parseChainId(firstConfiguredValue(this.config, [
      "PAYMENT_CHAIN_ID",
      "AA_CHAIN_ID",
      "CHAIN_ID",
      "NEXT_PUBLIC_CHAIN_ID",
    ]));
  }

  private legsConfigured(faucetConfig: SignupFaucetConfig) {
    return {
      eth: BigInt(faucetConfig.amountWei) > BigInt(0),
      usdc: BigInt(faucetConfig.amountUsdcUnits) > BigInt(0) && Boolean(faucetConfig.usdcTokenAddress),
    };
  }

  async maybeFundOnSignup(input: {
    authMode?: AuthMode;
    requestedChainId?: number;
    verifiedChainId: number;
    userId: string;
    walletAddress: string;
  }): Promise<SignupFaucetResult> {
    if (input.authMode !== "register") {
      return { status: "skipped", reason: "not_signup" };
    }
    return this.fund(input);
  }

  /**
   * The Wallet page's "Get my test money" button: sends whatever welcome leg
   * this account has not received yet (a failed sign-up top-up, or an account
   * made before welcome money existed), to the address sign-in verified.
   */
  async claimWelcomeFunds(userId: string): Promise<SignupFaucetResult> {
    const normalizedUserId = userId.toLowerCase();
    const wallet = await this.getStore().findVerifiedWallet(normalizedUserId);
    if (!wallet) return { status: "skipped", reason: "no_verified_wallet" };
    return this.fund({
      verifiedChainId: wallet.chainId,
      userId: normalizedUserId,
      walletAddress: wallet.address,
    });
  }

  async getWelcomeFundsStatus(userId: string): Promise<WelcomeFundsStatus> {
    const normalizedUserId = userId.toLowerCase();
    const store = this.getStore();
    const wallet = await store.findVerifiedWallet(normalizedUserId);
    const faucetConfig = this.faucetConfig(wallet?.chainId);
    const legs = this.legsConfigured(faucetConfig);
    const available =
      faucetConfig.enabled &&
      FAUCET_TEST_CHAIN_IDS.has(faucetConfig.chainId) &&
      (legs.eth || legs.usdc);
    const attempts = available ? await store.listForUser(normalizedUserId, faucetConfig.chainId) : [];
    const statusOf = (purpose: string): WelcomeLegStatus => {
      const found = attempts.find((attempt) => attempt.purpose === purpose)?.status;
      return found === "pending" || found === "sent" || found === "failed" ? found : null;
    };
    const eth = legs.eth ? statusOf(SIGNUP_FAUCET_PURPOSE) : null;
    const usdc = legs.usdc ? statusOf(WELCOME_USDC_PURPOSE) : null;
    const open = (configured: boolean, status: WelcomeLegStatus) =>
      configured && status !== "sent" && status !== "pending";
    return {
      available,
      chainId: faucetConfig.chainId,
      amountEth: legs.eth ? faucetConfig.amountEth : null,
      amountUsdc: legs.usdc ? faucetConfig.amountUsdc : null,
      eth,
      usdc,
      canClaim:
        available &&
        Boolean(wallet) &&
        wallet!.chainId === faucetConfig.chainId &&
        (open(legs.eth, eth) || open(legs.usdc, usdc)),
    };
  }

  private async fund(input: {
    requestedChainId?: number;
    verifiedChainId: number;
    userId: string;
    walletAddress: string;
  }): Promise<SignupFaucetResult> {
    const faucetConfig = getSignupFaucetConfig(this.config, input.verifiedChainId);
    if (!faucetConfig.enabled) {
      this.logger.log("Signup faucet skipped because SIGNUP_FAUCET_ENABLED is not enabled");
      return { status: "skipped", reason: "disabled" };
    }

    if (input.requestedChainId && input.requestedChainId !== faucetConfig.chainId) {
      this.logger.warn(
        `Signup faucet skipped because requested chain ${input.requestedChainId} does not match faucet chain ${faucetConfig.chainId}`,
      );
      return { status: "skipped", reason: "request_chain_mismatch" };
    }

    if (input.verifiedChainId !== faucetConfig.chainId) {
      this.logger.warn(
        `Signup faucet skipped because verified chain ${input.verifiedChainId} does not match faucet chain ${faucetConfig.chainId}`,
      );
      return { status: "skipped", reason: "server_chain_mismatch" };
    }

    if (!FAUCET_TEST_CHAIN_IDS.has(faucetConfig.chainId)) {
      this.logger.error(`Signup faucet refused chain ${faucetConfig.chainId}: it only pays on test networks`);
      return { status: "skipped", reason: "not_a_test_network" };
    }

    const legs = this.legsConfigured(faucetConfig);
    if (!legs.eth && !legs.usdc) {
      return { status: "skipped", reason: "nothing_configured" };
    }

    let walletAddress: Address;
    try {
      walletAddress = getAddress(input.walletAddress);
    } catch {
      return { status: "failed", reason: "invalid_wallet_address" };
    }

    const store = this.getStore();
    const userId = input.userId.toLowerCase();
    const normalizedWallet = walletAddress.toLowerCase();

    const funded = await store.countAccountsFundedSince(startOfUtcDay(this.now()));
    if (funded >= faucetConfig.dailyLimit) {
      const existing = await store.listForUser(userId, faucetConfig.chainId);
      // An account already counted today may finish its other leg.
      if (!existing.some((attempt) => attempt.status === "pending" || attempt.status === "sent")) {
        this.logger.warn(`Signup faucet daily limit (${faucetConfig.dailyLimit}) reached; skipped ${normalizedWallet}`);
        return { status: "skipped", reason: "daily_limit" };
      }
    }

    const outcomes: LegOutcome[] = [];
    if (legs.eth) {
      outcomes.push(await this.fundLeg({
        leg: "eth",
        purpose: SIGNUP_FAUCET_PURPOSE,
        amount: faucetConfig.amountWei,
        userId,
        walletAddress: normalizedWallet,
        faucetConfig,
        send: (funderPrivateKey) => this.getSender().sendEth({
          rpcUrl: faucetConfig.rpcUrl,
          chainId: faucetConfig.chainId,
          funderPrivateKey,
          to: walletAddress,
          amountWei: BigInt(faucetConfig.amountWei),
        }),
      }));
    }
    if (legs.usdc) {
      outcomes.push(await this.fundLeg({
        leg: "usdc",
        purpose: WELCOME_USDC_PURPOSE,
        amount: faucetConfig.amountUsdcUnits,
        userId,
        walletAddress: normalizedWallet,
        faucetConfig,
        send: (funderPrivateKey) => this.getSender().sendErc20({
          rpcUrl: faucetConfig.rpcUrl,
          chainId: faucetConfig.chainId,
          funderPrivateKey,
          token: faucetConfig.usdcTokenAddress!,
          to: walletAddress,
          amount: BigInt(faucetConfig.amountUsdcUnits),
        }),
      }));
    }

    const sentEth = outcomes.find((o) => o.leg === "eth" && o.status === "sent");
    const sentUsdc = outcomes.find((o) => o.leg === "usdc" && o.status === "sent");
    if (sentEth || sentUsdc) {
      return {
        status: "sent",
        chainId: faucetConfig.chainId,
        ...(sentEth?.status === "sent" ? { txHash: sentEth.txHash, amountEth: faucetConfig.amountEth } : {}),
        ...(sentUsdc?.status === "sent" ? { usdcTxHash: sentUsdc.txHash, amountUsdc: faucetConfig.amountUsdc } : {}),
      };
    }
    const failed = outcomes.find((o) => o.status === "failed");
    if (failed?.status === "failed") return { status: "failed", reason: failed.reason };
    return { status: "skipped", reason: "already_attempted" };
  }

  private async fundLeg(input: {
    leg: "eth" | "usdc";
    purpose: string;
    amount: string;
    userId: string;
    walletAddress: string;
    faucetConfig: SignupFaucetConfig;
    send: (funderPrivateKey: Hex) => Promise<Hex>;
  }): Promise<LegOutcome> {
    const store = this.getStore();
    const { created, attempt } = await store.createPending({
      userId: input.userId,
      walletAddress: input.walletAddress,
      chainId: input.faucetConfig.chainId,
      amountWei: input.amount,
      purpose: input.purpose,
    });

    if (!created) {
      this.logger.log(
        `Signup faucet ${input.leg} already attempted for ${input.walletAddress} (${attempt.status}${attempt.txHash ? `, tx: ${attempt.txHash}` : ""})`,
      );
      return { leg: input.leg, status: "skipped", reason: "already_attempted" };
    }

    if (!input.faucetConfig.funderPrivateKey) {
      const reason = "missing_funder_private_key";
      await store.markFailed(attempt.id, reason);
      this.logger.error(`Signup faucet is enabled for chain ${input.faucetConfig.chainId} but no funder private key is configured`);
      return { leg: input.leg, status: "failed", reason };
    }

    try {
      const txHash = await input.send(input.faucetConfig.funderPrivateKey);
      await store.markSent(attempt.id, txHash);
      this.logger.log(
        `Funded signup wallet ${input.walletAddress} with ${input.leg === "eth" ? `${input.faucetConfig.amountEth} ETH` : `${input.faucetConfig.amountUsdc} test USDC`} on chain ${input.faucetConfig.chainId} (${txHash})`,
      );
      return { leg: input.leg, status: "sent", txHash };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await store.markFailed(attempt.id, reason);
      this.logger.error(`Signup faucet ${input.leg} failed for ${input.walletAddress}: ${reason}`);
      return { leg: input.leg, status: "failed", reason };
    }
  }
}
