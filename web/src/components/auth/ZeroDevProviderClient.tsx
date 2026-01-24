"use client";

import React, { createContext, useContext, useMemo } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

type ZeroDevState = {
    projectId: string | null;
    publicClient: import("viem").PublicClient;
};

const ZeroDevContext = createContext<ZeroDevState | null>(null);

export default function ZeroDevProviderClient({
    children,
    projectId,
}: {
    children: React.ReactNode;
    projectId?: string;
}) {
    const finalProjectId = projectId || process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID || null;

    const publicClient = useMemo(
        () =>
            createPublicClient({
                chain: sepolia, // Defaulting to Sepolia for now
                transport: http(),
            }),
        []
    );

    const value = useMemo(
        () => ({
            projectId: finalProjectId,
            publicClient,
        }),
        [finalProjectId, publicClient]
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
