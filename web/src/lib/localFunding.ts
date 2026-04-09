/**
 * Local Development Funding Helpers
 * 
 * Provides auto-funding from Anvil's pre-funded accounts.
 * Used by the unified AA path to ensure smart accounts have gas on local dev.
 *
 * WARNING: These use Anvil's pre-funded account 0. Local dev only!
 */

import {
    type Address,
    type Hex,
    type PublicClient,
    createWalletClient,
    http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { getBrowserSafeRpcUrl, getRpcUrl } from "./rpc";

/**
 * Get Anvil's pre-funded account 0 (10,000 ETH)
 */
function getAnvilFunderAccount() {
    const ANVIL_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
    return privateKeyToAccount(ANVIL_PRIVATE_KEY);
}

/**
 * Fund a smart account from Anvil's pre-funded account 0.
 */
export async function fundSmartAccount(
    publicClient: PublicClient,
    smartAccountAddress: Address,
    amount: bigint = BigInt("1000000000000000000") // 1 ETH default
): Promise<void> {
    const funder = getAnvilFunderAccount();
    const rpcUrl = getBrowserSafeRpcUrl();
    const chainRpcUrl = getRpcUrl();
    const chain = publicClient.chain || foundry;

    const walletClient = createWalletClient({
        account: funder,
        chain: { ...chain, rpcUrls: { default: { http: [chainRpcUrl] }, public: { http: [chainRpcUrl] } } },
        transport: http(rpcUrl),
    });

    const hash = await walletClient.sendTransaction({
        to: smartAccountAddress,
        value: amount,
        account: funder,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[AA] Funded ${smartAccountAddress} with ${amount} wei`);
}
