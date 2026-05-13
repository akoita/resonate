import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createWalletClient,
  getAddress,
  http,
  parseEther,
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
const DEFAULT_FAUCET_CHAIN_ID = 11155111;
const DEFAULT_FAUCET_AMOUNT_ETH = "0.1";

export type AuthMode = "login" | "register";

export type SignupFaucetResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; txHash: Hex; chainId: number; amountEth: string }
  | { status: "failed"; reason: string };

type SignupFaucetConfig = {
  enabled: boolean;
  chainId: number;
  amountEth: string;
  amountWei: string;
  rpcUrl?: string;
  funderPrivateKey?: Hex;
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
}

export interface SignupFaucetSender {
  sendEth(input: {
    rpcUrl?: string;
    chainId: number;
    funderPrivateKey: Hex;
    to: Address;
    amountWei: bigint;
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
  const explicitRpc = firstConfiguredValue(config, [
    "SIGNUP_FAUCET_RPC_URL",
    "SIGNUP_SEPOLIA_FAUCET_RPC_URL",
    "RPC_URL",
  ]);
  if (explicitRpc) return explicitRpc;

  if (chainId === 84532) {
    return config.get<string>("BASE_SEPOLIA_RPC_URL")?.trim() || "https://sepolia.base.org";
  }
  if (chainId === 8453) {
    return config.get<string>("BASE_RPC_URL")?.trim() || "https://mainnet.base.org";
  }
  if (chainId === 11155111) {
    return config.get<string>("SEPOLIA_RPC_URL")?.trim() || undefined;
  }
  if (chainId === 31337) {
    return config.get<string>("LOCAL_RPC_URL")?.trim() || "http://localhost:8545";
  }

  return undefined;
}

export function getSignupFaucetConfig(config: ConfigService, activeChainId?: number): SignupFaucetConfig {
  const chainId = resolveSignupFaucetChainId(config, activeChainId);
  const amountEth =
    firstConfiguredValue(config, [
      "SIGNUP_FAUCET_AMOUNT_ETH",
      "SIGNUP_SEPOLIA_FAUCET_AMOUNT_ETH",
    ]) ?? DEFAULT_FAUCET_AMOUNT_ETH;

  return {
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
}

@Injectable()
export class SignupFaucetService {
  private readonly logger = new Logger(SignupFaucetService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(SIGNUP_FAUCET_STORE) private readonly store?: SignupFaucetStore,
    @Optional() @Inject(SIGNUP_FAUCET_SENDER) private readonly sender?: SignupFaucetSender,
  ) { }

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

    const faucetConfig = getSignupFaucetConfig(this.config, input.verifiedChainId);
    if (!faucetConfig.enabled) {
      return { status: "skipped", reason: "disabled" };
    }

    if (input.requestedChainId && input.requestedChainId !== faucetConfig.chainId) {
      return { status: "skipped", reason: "request_chain_mismatch" };
    }

    if (input.verifiedChainId !== faucetConfig.chainId) {
      return { status: "skipped", reason: "server_chain_mismatch" };
    }

    let walletAddress: Address;
    try {
      walletAddress = getAddress(input.walletAddress);
    } catch {
      return { status: "failed", reason: "invalid_wallet_address" };
    }

    const store = this.store ?? new PrismaSignupFaucetStore();
    const sender = this.sender ?? new ViemSignupFaucetSender();
    const userId = input.userId.toLowerCase();
    const normalizedWallet = walletAddress.toLowerCase();

    const { created, attempt } = await store.createPending({
      userId,
      walletAddress: normalizedWallet,
      chainId: faucetConfig.chainId,
      amountWei: faucetConfig.amountWei,
      purpose: SIGNUP_FAUCET_PURPOSE,
    });

    if (!created) {
      this.logger.log(
        `Signup faucet already attempted for ${normalizedWallet} (${attempt.status}${attempt.txHash ? `, tx: ${attempt.txHash}` : ""})`,
      );
      return { status: "skipped", reason: "already_attempted" };
    }

    if (!faucetConfig.funderPrivateKey) {
      const reason = "missing_funder_private_key";
      await store.markFailed(attempt.id, reason);
      this.logger.error(`Signup faucet is enabled for chain ${faucetConfig.chainId} but no funder private key is configured`);
      return { status: "failed", reason };
    }

    try {
      const txHash = await sender.sendEth({
        rpcUrl: faucetConfig.rpcUrl,
        chainId: faucetConfig.chainId,
        funderPrivateKey: faucetConfig.funderPrivateKey,
        to: walletAddress,
        amountWei: BigInt(faucetConfig.amountWei),
      });
      await store.markSent(attempt.id, txHash);
      this.logger.log(
        `Funded signup wallet ${normalizedWallet} with ${faucetConfig.amountEth} native ETH on chain ${faucetConfig.chainId} (${txHash})`,
      );
      return {
        status: "sent",
        txHash,
        chainId: faucetConfig.chainId,
        amountEth: faucetConfig.amountEth,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await store.markFailed(attempt.id, reason);
      this.logger.error(`Signup faucet failed for ${normalizedWallet}: ${reason}`);
      return { status: "failed", reason };
    }
  }
}
