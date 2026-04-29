"use client";

import React, { createContext, useContext, useMemo } from "react";
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { baseSepolia, sepolia, foundry } from "viem/chains";
import { getBrowserSafeRpcUrl, getRpcUrl } from "../../lib/rpc";
import { getZeroDevProjectId } from "../../lib/passkeyConfig";

type ZeroDevState = {
    projectId: string | null;
    publicClient: PublicClient;
    chainId: number;
};

const ZeroDevContext = createContext<ZeroDevState | null>(null);

/**
 * Get the chain configuration based on environment
 * - Local development: NEXT_PUBLIC_CHAIN_ID=31337 (Foundry/Anvil)
 * - Forked Sepolia: NEXT_PUBLIC_CHAIN_ID=11155111 + NEXT_PUBLIC_RPC_URL=http://localhost:8545
 * - Testnet: NEXT_PUBLIC_CHAIN_ID=11155111 or unset (Sepolia)
 * - x402 staging: NEXT_PUBLIC_CHAIN_ID=84532 (Base Sepolia)
 */
function getChainConfig() {
    const chainId = process.env.NEXT_PUBLIC_CHAIN_ID;
    const rpcUrlOverride = process.env.NEXT_PUBLIC_RPC_URL;
    const rpcUrl = getRpcUrl();

    if (chainId === "31337") {
        return {
            chain: {
                ...foundry,
                rpcUrls: {
                    default: { http: [rpcUrl] },
                    public: { http: [rpcUrl] },
                },
            },
            bundlerUrl: "http://localhost:4337",
        };
    }

    if (chainId === "84532") {
        return {
            chain: {
                ...baseSepolia,
                rpcUrls: {
                    default: { http: [rpcUrl] },
                    public: { http: [rpcUrl] },
                },
            },
            bundlerUrl: undefined,
        };
    }

    // Forked Sepolia: Sepolia chain ID but local RPC
    if (rpcUrlOverride?.includes("localhost") || rpcUrlOverride?.includes("127.0.0.1")) {
        return {
            chain: {
                ...sepolia,
                rpcUrls: {
                    default: { http: [rpcUrlOverride] },
                    public: { http: [rpcUrlOverride] },
                },
            },
            bundlerUrl: undefined, // Use ZeroDev's hosted bundler
        };
    }

    // Default to Sepolia
    return {
        chain: sepolia,
        bundlerUrl: undefined, // Use ZeroDev's hosted bundler
    };
}

const CHAIN_CONFIG = getChainConfig();

export default function ZeroDevProviderClient({
    children,
    projectId,
}: {
    children: React.ReactNode;
    projectId?: string;
}) {
    const finalProjectId = getZeroDevProjectId(projectId);
    const { chain } = CHAIN_CONFIG;

    const publicClient = useMemo<PublicClient>(
        () => {
            const rpcUrl = getBrowserSafeRpcUrl();
            // Only log in dev and only when actually re-creating
            if (process.env.NODE_ENV === "development") {
                console.log(`[ZeroDev] Initializing public client for chain ${chain.id} at ${rpcUrl}`);
            }
            return createPublicClient({
                chain,
                transport: http(rpcUrl),
            }) as PublicClient;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [chain.id] // chain is module-level constant, ID used to stabilize
    );

    const value = useMemo(
        () => ({
            projectId: finalProjectId,
            publicClient,
            chainId: chain.id,
        }),
        [finalProjectId, publicClient, chain.id]
    );

    return <ZeroDevContext.Provider value={value}>{children}</ZeroDevContext.Provider>;
}

export function useZeroDev() {
    const context = useContext(ZeroDevContext);
    if (!context) {
        throw new Error("useZeroDev must be used within a ZeroDevProviderClient");
    }
    return context;
}
