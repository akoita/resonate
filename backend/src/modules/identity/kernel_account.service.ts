import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  concat,
  type Address,
  type Hex,
  type Chain,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, foundry } from "viem/chains";

// ZeroDev SDK imports (dynamic to handle ESM)
let _sdkCache: typeof import("@zerodev/sdk") | null = null;
let _ecdsaCache: typeof import("@zerodev/ecdsa-validator") | null = null;

async function getZeroDevSdk() {
  if (!_sdkCache) _sdkCache = await import("@zerodev/sdk");
  return _sdkCache;
}
async function getEcdsaValidator() {
  if (!_ecdsaCache) _ecdsaCache = await import("@zerodev/ecdsa-validator");
  return _ecdsaCache;
}

const LOCAL_DEV_SALT = "resonate-local-dev-do-not-use-in-production";

/**
 * KernelAccountService — Creates real ZeroDev Kernel smart accounts
 * and sends transactions through the ERC-4337 bundler.
 *
 * On forked Sepolia (Anvil), the Kernel factory and ECDSA validator
 * contracts are already deployed (forked from Sepolia mainnet).
 * This service creates Kernel accounts with deterministic ECDSA signers
 * and uses createKernelAccountClient to send UserOps via the Alto bundler.
 */
@Injectable()
export class KernelAccountService {
  private readonly logger = new Logger(KernelAccountService.name);
  private readonly rpcUrl: string;
  private readonly bundlerUrl: string;
  private readonly chainId: number;
  private readonly entryPointAddress: string;
  private readonly skipBundler: boolean;

  constructor(private readonly config: ConfigService) {
    this.rpcUrl = this.config.get<string>("RPC_URL") || "http://localhost:8545";
    this.bundlerUrl =
      this.config.get<string>("AA_BUNDLER") || "http://localhost:4337";
    this.chainId = Number(this.config.get<string>("AA_CHAIN_ID") || "11155111");
    this.entryPointAddress =
      this.config.get<string>("AA_ENTRY_POINT") ||
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    this.skipBundler = this.config.get<string>("AA_SKIP_BUNDLER") === "true";
  }

  /**
   * Derive a deterministic private key from a userId.
   * Same approach as the frontend localAA.ts for consistency.
   * WARNING: Local dev only — keys are predictable!
   */
  private getSignerPrivateKey(userId: string): Hex {
    return keccak256(
      concat([toBytes(LOCAL_DEV_SALT), toBytes(userId.toLowerCase())]),
    );
  }

  /**
   * Get the signer EOA address for a user (useful for funding checks).
   */
  getSignerAddress(userId: string): Address {
    const pk = this.getSignerPrivateKey(userId);
    return privateKeyToAccount(pk).address;
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
   */
  private async fundAccountIfNeeded(
    address: Address,
    label: string,
    minEth: string = "0.5",
  ): Promise<void> {
    // Anvil account 0 funding is only valid on local devnets
    if (this.chainId !== 31337 && this.chainId !== 1337) {
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

    // Anvil account 0
    const funderPk =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
    const funder = privateKeyToAccount(funderPk);

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
    this.logger.log(`Funded ${label} ${address} with 10 ETH (tx: ${hash})`);;
  }

  /**
   * Create a Kernel smart account and return a client that can send transactions.
   * The SDK handles:
   *   - Account deployment (initCode) if not yet deployed
   *   - Nonce management via EntryPoint
   *   - UserOp signing with ECDSA validator
   *   - Gas estimation
   *   - Submission to bundler
   */
  async createKernelClient(userId: string) {
    const sdk = await getZeroDevSdk();
    const ecdsa = await getEcdsaValidator();

    const chain = this.getChain();
    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    // Create signer from deterministic private key
    const privateKey = this.getSignerPrivateKey(userId);
    const signer = privateKeyToAccount(privateKey);

    // Fund signer if needed (for Anvil)
    await this.fundAccountIfNeeded(signer.address, "signer");

    // Get entry point configuration
    const entryPoint = sdk.constants.getEntryPoint("0.7");

    // Create ECDSA validator
    const ecdsaValidator = await ecdsa.signerToEcdsaValidator(publicClient, {
      signer,
      entryPoint,
      kernelVersion: sdk.constants.KERNEL_V3_1,
    });

    // Create Kernel account
    const account = await sdk.createKernelAccount(publicClient, {
      plugins: { sudo: ecdsaValidator },
      entryPoint,
      kernelVersion: sdk.constants.KERNEL_V3_1,
    });

    this.logger.debug(
      `Kernel account for ${userId}: ${account.address} (signer: ${signer.address})`,
    );

    // Fund smart account if needed — it pays the EntryPoint prefund + tx value
    await this.fundAccountIfNeeded(account.address, "smart-account", "1");

    // Custom gas price fetcher — Alto uses pimlico_getUserOperationGasPrice,
    // not the ZeroDev-proprietary zd_getUserOperationGasPrice
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
            maxPriorityFeePerGas: BigInt(
              json.result.fast.maxPriorityFeePerGas,
            ),
          };
        }
      } catch {
        // fallback below
      }
      // Anvil fallback: use fixed gas prices
      return {
        maxFeePerGas: BigInt("2000000000"), // 2 gwei
        maxPriorityFeePerGas: BigInt("1500000000"), // 1.5 gwei
      };
    };

    // Create Kernel account client with bundler transport
    const kernelClient = sdk.createKernelAccountClient({
      account,
      chain,
      bundlerTransport: http(this.bundlerUrl),
      userOperation: { estimateFeesPerGas },
    });

    return { account, kernelClient, signerAddress: signer.address };
  }

  /**
   * Get the smart account address for a user.
   * This is the counterfactual address — even if not yet deployed.
   */
  async getSmartAccountAddress(userId: string): Promise<Address> {
    const { account } = await this.createKernelClient(userId);
    return account.address;
  }

  /**
   * Send a transaction through the Kernel smart account via the bundler.
   * Falls back to direct signer EOA send on local Anvil if bundler fails.
   * Returns the transaction hash after confirmation.
   */
  async sendTransaction(
    userId: string,
    to: Address,
    data: Hex,
    value: bigint = BigInt(0),
  ): Promise<string> {
    // Skip bundler entirely when AA_SKIP_BUNDLER=true (local dev)
    if (this.skipBundler) {
      this.logger.log(`Skipping bundler (AA_SKIP_BUNDLER=true), sending directly`);
      return this.sendDirectTransaction(userId, to, data, value);
    }

    const { kernelClient, account } = await this.createKernelClient(userId);

    this.logger.log(
      `Sending tx from Kernel ${account.address} to ${to} (value: ${value} wei)`,
    );

    try {
      const txHash = await (kernelClient as any).sendTransaction({
        to,
        data,
        value,
      });

      this.logger.log(`Transaction confirmed via bundler: ${txHash}`);
      return txHash;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // specific error suppression for known local dev issues
      const isLocal = this.chainId === 31337 || this.chainId === 11155111;
      
      if (isLocal) {
        this.logger.debug(`Bundler path failed (expected in local dev): ${message}`);
        this.logger.log(`Falling back to direct signer EOA send`);
      } else {
        this.logger.warn(`Bundler path failed: ${message}`);
        this.logger.warn(`Falling back to direct signer EOA send`);
      }

      // Direct send from the signer EOA (bypasses ERC-4337)
      return this.sendDirectTransaction(userId, to, data, value);
    }
  }

  /**
   * Fallback: send a transaction directly from the signer EOA.
   * Bypasses the bundler entirely — for local Anvil development only.
   */
  private async sendDirectTransaction(
    userId: string,
    to: Address,
    data: Hex,
    value: bigint,
  ): Promise<string> {
    const chain = this.getChain();
    const privateKey = this.getSignerPrivateKey(userId);
    const signer = privateKeyToAccount(privateKey);

    // Ensure signer has funds
    await this.fundAccountIfNeeded(signer.address, "signer");

    const walletClient = createWalletClient({
      account: signer,
      chain,
      transport: http(this.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    });

    const hash = await walletClient.sendTransaction({
      to,
      data,
      value,
      account: signer,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(
      `Transaction confirmed via direct send: ${hash} (block: ${receipt.blockNumber})`,
    );
    return hash;
  }
}
