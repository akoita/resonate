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
import { foundry, sepolia } from "viem/chains";
import { prisma } from "../../db/prisma";

export const SIGNUP_FAUCET_STORE = "SIGNUP_FAUCET_STORE";
export const SIGNUP_FAUCET_SENDER = "SIGNUP_FAUCET_SENDER";

const SIGNUP_FAUCET_PURPOSE = "signup-sepolia-faucet";
const DEFAULT_FAUCET_CHAIN_ID = 11155111;
const DEFAULT_FAUCET_AMOUNT_ETH = "0.1";

export type AuthMode = "login" | "register";

export type SignupFaucetResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; txHash: Hex }
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

function chainFor(chainId: number, rpcUrl?: string): Chain {
  if (chainId === 31337) return foundry;
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

export function getSignupFaucetConfig(config: ConfigService): SignupFaucetConfig {
  const chainId = Number(
    config.get<string>("SIGNUP_SEPOLIA_FAUCET_CHAIN_ID") ?? DEFAULT_FAUCET_CHAIN_ID,
  );
  const amountEth =
    config.get<string>("SIGNUP_SEPOLIA_FAUCET_AMOUNT_ETH") ?? DEFAULT_FAUCET_AMOUNT_ETH;

  return {
    enabled: parseEnabled(config.get<string>("SIGNUP_SEPOLIA_FAUCET_ENABLED")),
    chainId,
    amountEth,
    amountWei: parseEther(amountEth).toString(),
    rpcUrl:
      config.get<string>("SIGNUP_SEPOLIA_FAUCET_RPC_URL") ||
      config.get<string>("RPC_URL") ||
      config.get<string>("SEPOLIA_RPC_URL") ||
      undefined,
    funderPrivateKey: normalizePrivateKey(
      config.get<string>("SIGNUP_SEPOLIA_FAUCET_FUNDER_PRIVATE_KEY") ||
      config.get<string>("PRIVATE_KEY"),
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

    const faucetConfig = getSignupFaucetConfig(this.config);
    if (!faucetConfig.enabled) {
      return { status: "skipped", reason: "disabled" };
    }

    if (input.requestedChainId !== faucetConfig.chainId) {
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
      this.logger.error("Signup Sepolia faucet is enabled but no funder private key is configured");
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
        `Funded signup wallet ${normalizedWallet} with ${faucetConfig.amountEth} Sepolia ETH (${txHash})`,
      );
      return { status: "sent", txHash };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await store.markFailed(attempt.id, reason);
      this.logger.error(`Signup faucet failed for ${normalizedWallet}: ${reason}`);
      return { status: "failed", reason };
    }
  }
}
