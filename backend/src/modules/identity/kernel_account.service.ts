import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createPublicClient,
  createWalletClient,
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
  private readonly strictMode: boolean;
  private readonly funderKey: Hex;
  private readonly paymasterUrl: string | null;

  constructor(private readonly config: ConfigService) {
    this.rpcUrl = this.config.get<string>("RPC_URL") || "http://localhost:8545";
    this.bundlerUrl =
      this.config.get<string>("AA_BUNDLER") || "http://localhost:4337";
    this.chainId = Number(this.config.get<string>("AA_CHAIN_ID") || "11155111");
    this.strictMode = this.config.get<string>("AA_STRICT_MODE") === "true";

    // Pimlico paymaster URL for gas sponsorship (production/testnet).
    // When set, UserOps are sponsored — no ETH needed in the smart account.
    this.paymasterUrl = this.config.get<string>("AA_PAYMASTER") || null;
    if (this.paymasterUrl) {
      this.logger.log(`Paymaster configured: ${this.paymasterUrl.replace(/apikey=.*/, 'apikey=***')}`);
    }

    // Funder key for local Anvil auto-funding (not used in production).
    const funder = this.config.get<string>("AA_FUNDER_KEY");
    this.funderKey = funder
      ? (`0x${funder.replace(/^0x/, '')}` as Hex)
      : (DEFAULT_ANVIL_FUNDER_KEY as Hex);
  }

  /**
   * Get the chain definition for viem clients.
   */
  private getChain(): Chain {
    if (this.chainId === 31337) return foundry;
    if (this.chainId === 11155111) {
      return {
        ...sepolia,
        rpcUrls: {
          default: { http: [this.rpcUrl] },
        },
      };
    }
    return sepolia;
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

    const entryPoint = sdk.constants.getEntryPoint("0.7");
    const kernelVersion = sdk.constants.KERNEL_V3_1;

    this.logger.log(`Building session key client from agent-owned key`);

    // Deserialize the permission account using the approval data
    // The approval data contains the serialized permission account
    // with the agent's private key embedded during serialization
    const permissionAccount = await deserializePermissionAccount(
      publicClient,
      entryPoint,
      kernelVersion,
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
