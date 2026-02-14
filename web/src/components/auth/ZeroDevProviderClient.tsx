"use client";

import React, { createContext, useContext, useMemo } from "react";
import { createPublicClient, http } from "viem";
import { sepolia, foundry } from "viem/chains";

type ZeroDevState = {
    projectId: string | null;
    publicClient: import("viem").PublicClient;
    chainId: number;
};

const ZeroDevContext = createContext<ZeroDevState | null>(null);

/**
 * Get the chain configuration based on environment
 * - Local development: NEXT_PUBLIC_CHAIN_ID=31337 (Foundry/Anvil)
 * - Forked Sepolia: NEXT_PUBLIC_CHAIN_ID=11155111 + NEXT_PUBLIC_RPC_URL=http://localhost:8545
 * - Testnet: NEXT_PUBLIC_CHAIN_ID=11155111 or unset (Sepolia)
 */
function getChainConfig() {
    const chainId = process.env.NEXT_PUBLIC_CHAIN_ID;
    const rpcUrlOverride = process.env.NEXT_PUBLIC_RPC_URL;

    if (chainId === "31337") {
        return {
            chain: {
                ...foundry,
                rpcUrls: {
                    default: { http: ["http://localhost:8545"] },
                    public: { http: ["http://localhost:8545"] },
                },
            },
            bundlerUrl: "http://localhost:4337",
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
    const finalProjectId = projectId || process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID || null;
    const { chain } = CHAIN_CONFIG;

    const publicClient = useMemo(
        () => {
            const rpcUrl = chain.rpcUrls.default.http[0];
            // Only log in dev and only when actually re-creating
            if (process.env.NODE_ENV === "development") {
                console.log(`[ZeroDev] Initializing public client for chain ${chain.id} at ${rpcUrl}`);
            }
            return createPublicClient({
                chain,
                transport: http(rpcUrl),
            });
        },
        [chain.id] // Use ID to stabilize
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
