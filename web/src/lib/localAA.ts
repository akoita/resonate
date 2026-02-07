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
    encodeFunctionData,
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
    const hash = keccak256(
        concat([toBytes(LOCAL_DEV_SALT), toBytes(address.toLowerCase())])
    );
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

    const walletClient = createWalletClient({
        account: funder,
        chain: foundry,
        transport: http(LOCAL_RPC_URL),
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
 * Send a transaction using the user's local dev account
 * This uses their deterministic EOA directly (simpler than full Kernel for now)
 */
export async function sendLocalTransaction(
    publicClient: PublicClient,
    userAddress: Address,
    to: Address,
    data: Hex,
    value: bigint = BigInt(0)
): Promise<string> {
    const signerAccount = getLocalSignerAccount(userAddress);

    // Check if signer has funds
    const balance = await publicClient.getBalance({ address: signerAccount.address });

    if (balance < BigInt("100000000000000")) { // Less than 0.0001 ETH
        console.log(`[LocalAA] Funding account ${signerAccount.address} from Anvil...`);
        await fundLocalAccount(publicClient, userAddress);
    }

    const walletClient = createWalletClient({
        account: signerAccount,
        chain: {
            ...foundry,
            rpcUrls: {
                default: { http: [LOCAL_RPC_URL] },
                public: { http: [LOCAL_RPC_URL] },
            },
        },
        transport: http(LOCAL_RPC_URL),
    });

    // Explicitly fetch the latest nonce to avoid "nonce already used" errors
    // when transactions are sent in quick succession
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
