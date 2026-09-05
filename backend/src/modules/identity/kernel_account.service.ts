import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, foundry } from "viem/chains";

// ZeroDev SDK import (dynamic to handle ESM)
let _sdkCache: typeof import("@zerodev/sdk") | null = null;

async function getZeroDevSdk() {
  if (!_sdkCache) _sdkCache = await import("@zerodev/sdk");
  return _sdkCache;
}

// Anvil account 0 — default funder for local dev auto-funding
const DEFAULT_ANVIL_FUNDER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const RESONATE_KERNEL_VERSION = "0.3.1" as const;
const LOCAL_ENTRY_POINT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CANONICAL_ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export function assertAaKernelVersion(configured?: string): typeof RESONATE_KERNEL_VERSION {
  const version = configured || RESONATE_KERNEL_VERSION;
  if (version !== RESONATE_KERNEL_VERSION) {
    throw new Error(
      `AA_KERNEL_VERSION must be ${RESONATE_KERNEL_VERSION}; received ${version}`,
    );
  }
  return RESONATE_KERNEL_VERSION;
}

export function resolveAaChain(chainId: number, rpcUrl: string): Chain {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`AA_CHAIN_ID must be a positive safe integer; received ${chainId}`);
  }
  if (chainId === 31337) {
    return {
      ...foundry,
      rpcUrls: { default: { http: [rpcUrl] } },
    };
  }
  if (chainId === 11155111) {
    return {
      ...sepolia,
      rpcUrls: { default: { http: [rpcUrl] } },
    };
  }
  return {
    id: chainId,
    name: `AA custom chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export function resolveAaEntryPoint(chainId: number, configured?: string) {
  const knownDefault = chainId === 31337
    ? LOCAL_ENTRY_POINT
    : [11155111, 8453, 84532].includes(chainId)
      ? CANONICAL_ENTRY_POINT_V07
      : undefined;
  const address = configured || knownDefault;
  if (!address) {
    throw new Error(`AA_ENTRY_POINT is required for custom chain ${chainId}`);
  }
  return {
    address: getAddress(address),
    version: "0.7" as const,
  };
}

export function resolveAaFunderKey(chainId: number, configured?: string): Hex | null {
  if (configured) {
    const normalized = `0x${configured.replace(/^0x/, "")}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
      throw new Error("AA_FUNDER_KEY must be a 32-byte hexadecimal private key");
    }
    return normalized as Hex;
  }
  return chainId === 31337 ? (DEFAULT_ANVIL_FUNDER_KEY as Hex) : null;
}

/**
 * KernelAccountService — Sends agent transactions through the ERC-4337 bundler
 * using per-user session keys (agent-owned key model from PR #382).
 *
 * Account creation is handled on the frontend via passkey auth.
 * This service only handles:
 *   - Session key transactions (per-user encrypted agent keys)
 *   - Local dev auto-funding (Anvil only)
 */
@Injectable()
export class KernelAccountService {
  private readonly logger = new Logger(KernelAccountService.name);
  private readonly rpcUrl: string;
  private readonly bundlerUrl: string;
  private readonly chainId: number;
  private readonly entryPoint: ReturnType<typeof resolveAaEntryPoint>;
  private readonly kernelVersion: typeof RESONATE_KERNEL_VERSION;
  private readonly strictMode: boolean;
  private readonly funderKey: Hex | null;
  private readonly paymasterUrl: string | null;

  constructor(private readonly config: ConfigService) {
    this.rpcUrl = this.config.get<string>("RPC_URL") || "http://localhost:8545";
    this.bundlerUrl =
      this.config.get<string>("AA_BUNDLER") || "http://localhost:4337";
    this.chainId = Number(this.config.get<string>("AA_CHAIN_ID") || "11155111");
    resolveAaChain(this.chainId, this.rpcUrl);
    this.entryPoint = resolveAaEntryPoint(
      this.chainId,
      this.config.get<string>("AA_ENTRY_POINT"),
    );
    this.kernelVersion = assertAaKernelVersion(
      this.config.get<string>("AA_KERNEL_VERSION"),
    );
    this.strictMode = this.config.get<string>("AA_STRICT_MODE") === "true";

    // Pimlico paymaster URL for gas sponsorship (production/testnet).
    // When set, UserOps are sponsored — no ETH needed in the smart account.
    this.paymasterUrl = this.config.get<string>("AA_PAYMASTER") || null;
    if (this.paymasterUrl) {
      this.logger.log(`Paymaster configured: ${this.paymasterUrl.replace(/apikey=.*/, 'apikey=***')}`);
    }

    // Funder key for local Anvil auto-funding (not used in production).
    const funder = this.config.get<string>("AA_FUNDER_KEY");
    this.funderKey = resolveAaFunderKey(this.chainId, funder);
  }

  /**
   * Get the chain definition for viem clients.
   */
  private getChain(): Chain {
    return resolveAaChain(this.chainId, this.rpcUrl);
  }

  /**
   * Fund an address from Anvil's pre-funded account 0 if balance is low.
   * Only works on local Anvil instances.
   * Disabled in AA_STRICT_MODE to match production gas behavior.
   */
  private async fundAccountIfNeeded(
    address: Address,
    label: string,
    minEth: string = "0.5",
  ): Promise<void> {
    if (this.strictMode) {
      this.logger.warn(
        `Skipping auto-fund for ${label} ${address} (AA_STRICT_MODE=true — manage gas manually)`,
      );
      return;
    }
    if (!this.funderKey) {
      this.logger.warn(
        `Skipping auto-fund for ${label} ${address}; AA_FUNDER_KEY is required outside plain Anvil chain 31337`,
      );
      return;
    }

    const chain = this.getChain();
    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    const balance = await publicClient.getBalance({ address });
    const minBalance = BigInt(Math.floor(parseFloat(minEth) * 1e18).toString());

    if (balance >= minBalance) return;

    this.logger.log(
      `Funding ${label} ${address} (balance: ${balance} wei, min: ${minEth} ETH)`,
    );

    const funder = privateKeyToAccount(this.funderKey);

    const walletClient = createWalletClient({
      account: funder,
      chain,
      transport: http(this.rpcUrl),
    });

    const amount = BigInt("10000000000000000000"); // 10 ETH
    const hash = await walletClient.sendTransaction({
      to: address,
      value: amount,
      account: funder,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(`Funded ${label} ${address} with 10 ETH (tx: ${hash})`);
  }

  /**
   * Send a transaction using the agent's own session key.
   * Agent-owned key model:
   *   - The agent's private key was generated and stored server-side
   *   - The approval data was signed by the user on the frontend
   *   - We reconstruct the permission account from both
   */
  async sendSessionKeyTransaction(
    agentPrivateKey: string,
    approvalData: string,
    to: Address,
    data: Hex,
    value: bigint = BigInt(0),
  ): Promise<string> {
    const sdk = await getZeroDevSdk();
    const { deserializePermissionAccount } = await import("@zerodev/permissions");

    const chain = this.getChain();
    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    this.logger.log(`Building session key client from agent-owned key`);

    // Deserialize the permission account using the approval data
    // The approval data contains the serialized permission account
    // with the agent's private key embedded during serialization
    const permissionAccount = await deserializePermissionAccount(
      publicClient,
      this.entryPoint,
      this.kernelVersion,
      approvalData,
    );

    // Fund the smart account if needed (fallback when paymaster is absent or limited)
    await this.fundAccountIfNeeded(permissionAccount.address, "session-key-account", "1");

    this.logger.log(
      `Session key account: ${permissionAccount.address}, sending tx to ${to}${this.paymasterUrl ? " (gas sponsored)" : ""}`,
    );

    // Custom gas price fetcher for Alto/Pimlico bundler
    const estimateFeesPerGas = async () => {
      try {
        const response = await fetch(this.bundlerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "pimlico_getUserOperationGasPrice",
            params: [],
          }),
        });
        const json = await response.json();
        if (json.result) {
          return {
            maxFeePerGas: BigInt(json.result.fast.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(json.result.fast.maxPriorityFeePerGas),
          };
        }
      } catch {
        // fallback below
      }
      return {
        maxFeePerGas: BigInt("2000000000"),
        maxPriorityFeePerGas: BigInt("1500000000"),
      };
    };

    // Pimlico paymaster — sponsors gas when configured.
    // Use ZeroDev's paymaster client for SDK compatibility.
    let paymasterClient: Awaited<ReturnType<typeof sdk.createZeroDevPaymasterClient>> | undefined;
    if (this.paymasterUrl) {
      paymasterClient = sdk.createZeroDevPaymasterClient({
        chain,
        transport: http(this.paymasterUrl),
      });
    }

    // Create a Kernel client scoped to the session key
    const sessionKeyClient = sdk.createKernelAccountClient({
      account: permissionAccount,
      chain,
      bundlerTransport: http(this.bundlerUrl),
      ...(paymasterClient ? { paymaster: paymasterClient } : {}),
      userOperation: { estimateFeesPerGas },
    });

    try {
      const txHash = await (sessionKeyClient as any).sendTransaction({
        to,
        data,
        value,
      });

      this.logger.log(`Session key transaction confirmed: ${txHash}`);
      return txHash;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Session key transaction failed: ${message}`);

      throw new Error(`Session key transaction failed: ${message}`);
    }
  }
}
