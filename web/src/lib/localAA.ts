/**
 * Local Account Abstraction Helpers
 * 
 * For local development (chainId 31337), this module provides:
 * - Deterministic private keys for users (derived from address)
 * - Kernel account creation via ECDSA validator
 * - UserOperation sending through local bundler
 * 
 * WARNING: These keys are for LOCAL DEV ONLY. Never use in production!
 */

import {
    type Address,
    type Hex,
    type PublicClient,
    createWalletClient,
    http,
    keccak256,
    toBytes,
    concat,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Local AA Contract Addresses (from `make local-aa-full`)
export const LOCAL_AA_CONTRACTS = {
    entryPoint: "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address,
    kernelFactory: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9" as Address,
    kernelImplementation: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address,
    ecdsaValidator: "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9" as Address,
};

export const LOCAL_BUNDLER_URL = "http://localhost:4337";
export const LOCAL_RPC_URL = "http://localhost:8545";

// Secret salt for deterministic key derivation (LOCAL DEV ONLY)
const LOCAL_DEV_SALT = "resonate-local-dev-do-not-use-in-production";

/**
 * Derive a deterministic private key from a user's address
 * WARNING: Only for local development! Keys are predictable.
 */
export function getLocalPrivateKey(address: Address): Hex {
    // Hash the address with our salt to get a deterministic key
    console.log("[LocalAA] Deriving key for:", address);
    console.log("[LocalAA] Using salt:", LOCAL_DEV_SALT);
    const hash = keccak256(
        concat([toBytes(LOCAL_DEV_SALT), toBytes(address.toLowerCase())])
    );
    console.log("[LocalAA] Derived Hash:", hash);
    return hash;
}

/**
 * Get the EOA account for a user (for signing UserOperations)
 */
export function getLocalSignerAccount(address: Address) {
    const privateKey = getLocalPrivateKey(address);
    return privateKeyToAccount(privateKey);
}

/**
 * Create a wallet client for local AA transactions
 * Uses the user's derived private key
 */
export function createLocalWalletClient(userAddress: Address) {
    const account = getLocalSignerAccount(userAddress);

    return createWalletClient({
        account,
        chain: {
            ...foundry,
            rpcUrls: {
                default: { http: [LOCAL_RPC_URL] },
                public: { http: [LOCAL_RPC_URL] },
            },
        },
        transport: http(LOCAL_RPC_URL),
    });
}

/**
 * Get the Anvil account for funding local dev accounts
 */
export function getAnvilFunderAccount() {
    const ANVIL_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
    return privateKeyToAccount(ANVIL_PRIVATE_KEY);
}

/**
 * Fund a local dev account with ETH from Anvil
 */
export async function fundLocalAccount(
    publicClient: PublicClient,
    userAddress: Address,
    amount: bigint = BigInt("1000000000000000000") // 1 ETH default
): Promise<string> {
    const funder = getAnvilFunderAccount();
    const signerAccount = getLocalSignerAccount(userAddress);
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || LOCAL_RPC_URL;
    const chain = publicClient.chain || foundry;

    const walletClient = createWalletClient({
        account: funder,
        chain: { ...chain, rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } },
        transport: http(rpcUrl),
    });

    // Send ETH to the user's signer address
    const hash = await walletClient.sendTransaction({
        to: signerAccount.address,
        value: amount,
        account: funder,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return hash;
}

/**
 * Fund a smart account address from Anvil's pre-funded account 0
 */
async function fundSmartAccount(
    publicClient: PublicClient,
    smartAccountAddress: Address,
    amount: bigint = BigInt("1000000000000000000") // 1 ETH
): Promise<void> {
    const funder = getAnvilFunderAccount();
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || LOCAL_RPC_URL;
    const chain = publicClient.chain || foundry;

    const walletClient = createWalletClient({
        account: funder,
        chain: { ...chain, rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } },
        transport: http(rpcUrl),
    });

    const hash = await walletClient.sendTransaction({
        to: smartAccountAddress,
        value: amount,
        account: funder,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[LocalAA] Funded smart account ${smartAccountAddress} with ${amount} wei`);
}

/**
 * Send a transaction using a ZeroDev Kernel smart account via the bundler.
 * Falls back to direct EOA if the bundler is unreachable.
 */
export async function sendLocalTransaction(
    publicClient: PublicClient,
    userAddress: Address,
    to: Address,
    data: Hex,
    value: bigint = BigInt(0)
): Promise<string> {
    const signerAccount = getLocalSignerAccount(userAddress);

    // Always ensure the signer has funds (needed for prefund)
    const signerBalance = await publicClient.getBalance({ address: signerAccount.address });
    if (signerBalance < BigInt("100000000000000")) {
        console.log(`[LocalAA] Funding signer ${signerAccount.address} from Anvil...`);
        await fundLocalAccount(publicClient, userAddress);
    }

    // Try the Kernel (ERC-4337) path first
    try {
        const sdk = await import("@zerodev/sdk");
        const ecdsa = await import("@zerodev/ecdsa-validator");

        const { createKernelAccount, createKernelAccountClient, constants } = sdk;
        const { signerToEcdsaValidator } = ecdsa;

        const chain = publicClient.chain || foundry;
        const entryPoint = constants.getEntryPoint("0.7");

        // Create ECDSA validator with user's deterministic signer
        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
            signer: signerAccount,
            entryPoint,
            kernelVersion: constants.KERNEL_V3_1,
        });

        // Create Kernel account (counterfactual — deploys on first tx if needed)
        const account = await createKernelAccount(publicClient, {
            plugins: { sudo: ecdsaValidator },
            entryPoint,
            kernelVersion: constants.KERNEL_V3_1,
        });

        console.log(`[LocalAA] Kernel account: ${account.address} (signer: ${signerAccount.address})`);

        // Fund the smart account if needed
        const saBalance = await publicClient.getBalance({ address: account.address });
        const neededBalance = value + BigInt("500000000000000000"); // value + 0.5 ETH for gas
        if (saBalance < neededBalance) {
            console.log(`[LocalAA] Funding smart account ${account.address}...`);
            await fundSmartAccount(publicClient, account.address, neededBalance - saBalance + BigInt("1000000000000000000"));
        }

        // Custom gas price fetcher for Alto bundler
        const bundlerUrl = process.env.NEXT_PUBLIC_AA_BUNDLER || LOCAL_BUNDLER_URL;
        const estimateFeesPerGas = async () => {
            try {
                const response = await fetch(bundlerUrl, {
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

        // Create Kernel client with bundler
        const kernelClient = createKernelAccountClient({
            account,
            chain,
            bundlerTransport: http(bundlerUrl),
            userOperation: { estimateFeesPerGas },
        });

        // Send the transaction as a UserOp
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hash = await (kernelClient as any).sendTransaction({
            to,
            data,
            value,
        });

        console.log(`[LocalAA] UserOp tx hash: ${hash}`);
        return hash;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // If bundler is unreachable, fall back to direct EOA
        if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("bundler")) {
            console.warn(`[LocalAA] Bundler unreachable, falling back to direct EOA:`, message);
        } else {
            // For other errors, also fall back but log more prominently
            console.error(`[LocalAA] Kernel tx failed, falling back to direct EOA:`, message);
        }
    }

    // Fallback: direct EOA transaction (original behavior)
    console.log(`[LocalAA] Sending via direct EOA ${signerAccount.address}`);
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || LOCAL_RPC_URL;
    const chain = publicClient.chain || foundry;

    const walletClient = createWalletClient({
        account: signerAccount,
        chain: { ...chain, rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } },
        transport: http(rpcUrl),
    });

    const nonce = await publicClient.getTransactionCount({
        address: signerAccount.address,
        blockTag: 'pending',
    });

    const hash = await walletClient.sendTransaction({
        to,
        data,
        value,
        account: signerAccount,
        nonce,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
}

/**
 * Get the signer address for a user (where they should mint NFTs to)
 */
export function getLocalSignerAddress(userAddress: Address): Address {
    return getLocalSignerAccount(userAddress).address;
}

